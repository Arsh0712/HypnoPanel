import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { verifyCloudflareToken } from "@/lib/cloudflare";

export const runtime = "nodejs";

/**
 * POST /api/dns/verify-token {token, zoneName?} — REAL Cloudflare check
 * (spec FIX#2 §3.1) WITHOUT storing anything: token verify → visible zones
 * (paginated) → optional write probe via a temporary TXT `_hipno-permtest`.
 * The token is never logged, never echoed back, never persisted by this route.
 */
export const POST = handle(async (req: NextRequest) => {
  await guard(req, { permission: "dns:write" });
  const body = (await req.json().catch(() => ({}))) as { token?: string; zoneName?: string };
  const token = String(body.token || "").trim();
  if (!token) throw new ApiError(400, "missing_token", "Paste the Cloudflare API token first.");

  const zoneName = String(body.zoneName || "").trim().toLowerCase().replace(/\.$/, "") || null;
  const result = await verifyCloudflareToken(token, zoneName);

  return NextResponse.json({
    verification: {
      valid: result.valid,
      tokenStatus: result.tokenStatus,
      zoneCount: result.zones.length,
      zones: result.zones.slice(0, 50).map((z) => ({ name: z.name, status: z.status })),
      zoneFound: result.zoneFound,
      writeProbe: result.writeProbe,
      writeProbeDetail: result.writeProbeDetail,
    },
  });
});
