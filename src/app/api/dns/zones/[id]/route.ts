import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { isHostname } from "../../_lib/records";
import { zoneToDetail } from "../../_lib/serialize";
import { verifyCloudflareToken } from "@/lib/cloudflare";

export const runtime = "nodejs";

const PROVIDERS = ["cloudflare"];

/** GET /api/dns/zones/[id] — zone detail incl. all records. */
export const GET = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await guard(req, { permission: "dns:read" });
  const { id } = await params;
  const zone = await db.dnsZone.findUnique({ where: { id }, include: { records: true } });
  if (!zone) throw new ApiError(404, "not_found", "Zone not found");
  return NextResponse.json({ zone: zoneToDetail(zone, zone.records) });
});

/**
 * PATCH /api/dns/zones/[id] — mode, provider, token (replaced when given),
 * primary NS. A newly pasted Cloudflare token is verified against the real
 * API BEFORE it replaces the stored one (FIX#2 §3.1): invalid or read-only
 * tokens are rejected with the Cloudflare reason, never silently "linked".
 */
export const PATCH = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await guard(req, { permission: "dns:write" });
  const { id } = await params;
  const zone = await db.dnsZone.findUnique({ where: { id } });
  if (!zone) throw new ApiError(404, "not_found", "Zone not found");

  const body = (await req.json().catch(() => ({}))) as {
    mode?: string;
    provider?: string | null;
    apiToken?: string;
    primary?: string | null;
  };

  const data: {
    mode?: string;
    provider?: string | null;
    tokenEnc?: string | null;
    primary?: string | null;
    tokenStatus?: string | null;
    tokenVerifiedAt?: Date | null;
    cfZoneId?: string | null;
    lastSyncAt?: Date | null;
  } = {};

  let newProvider = zone.provider;
  let newMode = zone.mode;

  if (body.mode !== undefined) {
    if (!["local", "provider"].includes(body.mode)) {
      throw new ApiError(400, "invalid_mode", "Mode must be local or provider.");
    }
    data.mode = body.mode;
    newMode = body.mode;
  }
  if (body.provider !== undefined) {
    if (body.provider === null || body.provider === "") {
      data.provider = null;
      data.mode = data.mode ?? "local";
      newProvider = null;
      newMode = data.mode;
    } else {
      if (!PROVIDERS.includes(body.provider)) {
        throw new ApiError(400, "invalid_provider", `Provider zones currently support: ${PROVIDERS.join(", ")}.`);
      }
      data.provider = body.provider;
      newProvider = body.provider;
    }
  }

  const isCloudflareProvider = newMode === "provider" && newProvider === "cloudflare";

  if (body.apiToken !== undefined && body.apiToken !== null && String(body.apiToken).trim() !== "") {
    const token = String(body.apiToken).trim();
    if (isCloudflareProvider) {
      // REAL verification before replacing the stored token (FIX#2 §3.1)
      const verification = await verifyCloudflareToken(token, zone.name);
      if (!verification.zoneFound) {
        throw new ApiError(
          400,
          "zone_not_found",
          `The token works, but Cloudflare does not list ${zone.name} under it — the zone must exist in the same Cloudflare account the token belongs to (and the token must include it in its zone scope).`
        );
      }
      if (verification.writeProbe === "denied") {
        throw new ApiError(
          400,
          "no_write_permission",
          `The token can read ${zone.name} but not write to it. ${verification.writeProbeDetail || ""} Edit the token in Cloudflare → add DNS · Edit for this zone, then paste it again.`
        );
      }
      const { encrypt } = await import("@/lib/crypto");
      data.tokenEnc = encrypt(token);
      data.tokenStatus = verification.writeProbe === "granted" ? "verified" : "verified_read_only";
      data.tokenVerifiedAt = new Date();
      const cfZone = verification.zones.find((z) => z.name.toLowerCase() === zone.name.toLowerCase());
      if (cfZone) data.cfZoneId = cfZone.id;
      // a new token invalidates previous record linkage
      data.lastSyncAt = null;
    } else {
      const { encrypt } = await import("@/lib/crypto");
      data.tokenEnc = encrypt(token);
      data.tokenStatus = "unverified";
      data.tokenVerifiedAt = null;
    }
  }

  // switching to local — record linkage no longer applies
  if (newMode === "local") {
    if (data.tokenStatus === undefined && zone.tokenStatus && zone.tokenStatus !== "unverified") {
      data.tokenStatus = "unverified";
    }
  }

  if (body.primary !== undefined) {
    if (body.primary === null || body.primary.trim() === "") {
      data.primary = null;
    } else {
      const p = body.primary.trim().toLowerCase().replace(/\.$/, "");
      if (!isHostname(p)) throw new ApiError(400, "invalid_primary", "Primary nameserver must be a valid hostname.");
      data.primary = p;
    }
  }

  const updated = await db.dnsZone.update({
    where: { id: zone.id },
    data,
    include: { records: true },
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "dns.zone.update",
    target: zone.name,
    sourceIp: getClientIp(req),
    details: {
      changed: Object.keys(data),
      tokenReplaced: data.tokenEnc !== undefined,
      tokenStatus: data.tokenStatus ?? zone.tokenStatus,
      verified: (data.tokenStatus ?? zone.tokenStatus)?.startsWith("verified") ?? false,
    },
  });

  return NextResponse.json({ zone: zoneToDetail(updated, updated.records) });
});

/** DELETE /api/dns/zones/[id] — removes the zone and (cascade) all records. */
export const DELETE = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await guard(req, { permission: "dns:write" });
  const { id } = await params;
  const zone = await db.dnsZone.findUnique({ where: { id }, include: { records: { select: { id: true } } } });
  if (!zone) throw new ApiError(404, "not_found", "Zone not found");

  await db.dnsZone.delete({ where: { id } });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "dns.zone.delete",
    target: zone.name,
    sourceIp: getClientIp(req),
    details: { recordsRemoved: zone.records.length },
  });

  return NextResponse.json({ ok: true });
});
