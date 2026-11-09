import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { normalizeDomain } from "@/lib/dns-verify";
import { isHostname } from "../_lib/records";
import { zoneToDetail, zoneToSummary } from "../_lib/serialize";
import { verifyCloudflareToken } from "@/lib/cloudflare";

export const runtime = "nodejs";

const PROVIDERS = ["cloudflare"];

/** GET /api/dns/zones — all zones with live record counts. */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "dns:read" });
  const zones = await db.dnsZone.findMany({
    orderBy: { name: "asc" },
    include: { records: { select: { id: true } } },
  });
  return NextResponse.json({
    zones: zones.map((z) => zoneToSummary(z, z.records.length)),
  });
});

/**
 * POST /api/dns/zones — create a zone (local or provider). Provider API
 * tokens are verified against Cloudflare BEFORE they are stored (spec
 * FIX#2 §3.1): a token that fails verification is rejected, so the panel can
 * never show "linked" for a token Cloudflare doesn't accept. Tokens are
 * stored AES-256-GCM encrypted and only ever returned masked.
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "dns:write" });
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    mode?: string;
    provider?: string;
    apiToken?: string;
    primary?: string;
  };

  const norm = normalizeDomain(body.name || "");
  if (!norm.ok || !norm.domain) {
    throw new ApiError(400, "invalid_zone", norm.error || "Enter a valid zone name, e.g. example.com");
  }

  const mode = body.mode === "provider" ? "provider" : body.mode === "local" || !body.mode ? "local" : "";
  if (!mode) throw new ApiError(400, "invalid_mode", "Mode must be local or provider.");
  const provider = body.provider ?? null;
  if (mode === "provider" && (!provider || !PROVIDERS.includes(provider))) {
    throw new ApiError(400, "invalid_provider", `Provider zones currently support: ${PROVIDERS.join(", ")}.`);
  }

  let primary: string | null = null;
  if (body.primary && body.primary.trim()) {
    const p = body.primary.trim().toLowerCase().replace(/\.$/, "");
    if (!isHostname(p)) throw new ApiError(400, "invalid_primary", "Primary nameserver must be a valid hostname.");
    primary = p;
  }

  // REAL verification before anything is stored — invalid tokens are rejected,
  // so "linked" can only ever mean Cloudflare accepted it (FIX#2 §3.1).
  const token = body.apiToken?.trim() || null;
  let tokenEnc: string | null = null;
  let tokenStatus: string | null = null;
  let tokenVerifiedAt: Date | null = null;
  let verificationSummary: { writeProbe: string; writeProbeDetail: string | null; zoneFound: boolean } | null = null;
  let cfZoneId: string | null = null;

  if (token && mode === "provider" && provider === "cloudflare") {
    const verification = await verifyCloudflareToken(token, norm.domain);
    if (!verification.zoneFound) {
      throw new ApiError(
        400,
        "zone_not_found",
        `The token works, but Cloudflare does not list ${norm.domain} under it — the zone must exist in the same Cloudflare account the token belongs to (and the token must include it in its zone scope).`
      );
    }
    if (verification.writeProbe === "denied") {
      throw new ApiError(
        400,
        "no_write_permission",
        `The token can read ${norm.domain} but not write to it. ${verification.writeProbeDetail || ""} Edit the token in Cloudflare → add DNS · Edit for this zone, then paste it again.`
      );
    }
    const { encrypt } = await import("@/lib/crypto");
    tokenEnc = encrypt(token);
    tokenStatus = verification.writeProbe === "granted" ? "verified" : "verified_read_only";
    tokenVerifiedAt = new Date();
    verificationSummary = {
      writeProbe: verification.writeProbe,
      writeProbeDetail: verification.writeProbeDetail,
      zoneFound: verification.zoneFound,
    };
    const cfZone = verification.zones.find((z) => z.name.toLowerCase() === norm.domain!.toLowerCase());
    cfZoneId = cfZone?.id ?? null;
  } else if (token) {
    // local zone with a token pasted — store encrypted but mark untested
    const { encrypt } = await import("@/lib/crypto");
    tokenEnc = encrypt(token);
    tokenStatus = "unverified";
  }
  // provider zone without a token is allowed — the UI explains the next step

  const existing = await db.dnsZone.findUnique({ where: { name: norm.domain } });
  if (existing) throw new ApiError(409, "zone_exists", `A zone for ${norm.domain} already exists.`);

  const zone = await db.dnsZone.create({
    data: {
      name: norm.domain,
      mode,
      provider: mode === "provider" ? provider : null,
      tokenEnc,
      tokenStatus,
      tokenVerifiedAt,
      cfZoneId,
      primary,
    },
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "dns.zone.create",
    target: zone.name,
    sourceIp: getClientIp(req),
    details: { mode, provider, withToken: !!tokenEnc, tokenStatus, verified: tokenStatus?.startsWith("verified") ?? false },
  });

  return NextResponse.json(
    { zone: zoneToDetail(zone, []), verification: verificationSummary },
    { status: 201 }
  );
});
