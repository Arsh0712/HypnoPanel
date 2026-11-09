import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import { isValidDomain } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * POST /api/settings/access-mode — { mode: 'relay'|'direct', domain? }
 * Direct mode requires the VPS deployment (own IPv4 + domain; Caddy obtains
 * a Let's Encrypt certificate). Honest note returned for this preview.
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "settings:write" });
  const body = (await req.json().catch(() => ({}))) as { mode?: string; domain?: string };
  if (body.mode !== "relay" && body.mode !== "direct") {
    throw new ApiError(400, "invalid_mode", "mode must be relay or direct");
  }
  if (body.mode === "direct") {
    if (!body.domain || !isValidDomain(body.domain)) {
      throw new ApiError(400, "invalid_domain", "A valid domain is required for direct mode");
    }
  }
  await db.setting.upsert({
    where: { key: "access.mode" },
    update: { value: JSON.stringify(body.mode) },
    create: { key: "access.mode", value: JSON.stringify(body.mode) },
  });
  await db.setting.upsert({
    where: { key: "access.domain" },
    update: { value: JSON.stringify(body.mode === "direct" ? body.domain : null) },
    create: { key: "access.domain", value: JSON.stringify(null) },
  });
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "settings.access_mode",
    target: body.mode,
    sourceIp: getClientIp(req),
    details: { domain: body.mode === "direct" ? body.domain : null },
  });
  return NextResponse.json({
    ok: true,
    note:
      body.mode === "direct"
        ? "Direct mode requires the VPS deployment with its own IPv4 + domain — Caddy obtains a Let's Encrypt certificate and serves the panel on 443 under the same secret path. In this preview the relay tunnel keeps serving."
        : "Relay mode active — access URL routes through the HipnoType Relay tunnel.",
  });
});
