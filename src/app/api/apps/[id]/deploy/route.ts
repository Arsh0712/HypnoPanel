import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import { ApiError } from "@/lib/api-error";
import { performDeploy } from "../../_lib";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/apps/[id]/deploy — deploy the staged Compose file with the live
 * Docker Engine. Honestly refuses (409 docker_unavailable) when the backend
 * is absent; the app stays staged.
 */
export const POST = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "apps:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;

  const app = await db.app.findUnique({ where: { id } });
  if (!app) throw new ApiError(404, "not_found", "App not found");

  const { version } = await performDeploy(
    { id: app.id, slug: app.slug, composeYaml: app.composeYaml },
    { actorId: ctx.userId, actorEmail: ctx.email, sourceIp: ip },
    "deploy"
  );

  return NextResponse.json({ ok: true, deployed: true, version, status: "running" });
});
