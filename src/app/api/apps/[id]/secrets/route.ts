import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";
import { parseAppEnv } from "../../_lib";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/apps/[id]/secrets — decrypt and reveal the app's generated
 * secrets. Requires apps:write; every reveal is audited (app.secrets.view).
 */
export const GET = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "apps:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;

  const app = await db.app.findUnique({ where: { id } });
  if (!app) throw new ApiError(404, "not_found", "App not found");

  const { secrets } = parseAppEnv(app.envJson, app.secretsEnc);

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "app.secrets.view",
    target: app.slug,
    sourceIp: ip,
    details: { keys: Object.keys(secrets) },
  });

  return NextResponse.json({ secrets });
});
