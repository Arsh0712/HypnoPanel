import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";
import {
  DOCKER_UNAVAILABLE_MESSAGE,
  composeAction,
  composeFileFor,
  performDeploy,
  probeDocker,
} from "../../_lib";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const ACTIONS = ["start", "stop", "restart", "redeploy"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * POST /api/apps/[id]/action — { action: start|stop|restart|redeploy }.
 * Docker-gated: without the backend the honest 409 is returned.
 */
export const POST = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "apps:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;

  const body = (await req.json().catch(() => ({}))) as { action?: unknown };
  const action = body.action as Action;
  if (!ACTIONS.includes(action)) {
    throw new ApiError(400, "invalid_action", "action must be one of start, stop, restart, redeploy");
  }

  const app = await db.app.findUnique({ where: { id } });
  if (!app) throw new ApiError(404, "not_found", "App not found");

  if (action === "redeploy") {
    const { version } = await performDeploy(
      { id: app.id, slug: app.slug, composeYaml: app.composeYaml },
      { actorId: ctx.userId, actorEmail: ctx.email, sourceIp: ip },
      "redeploy"
    );
    return NextResponse.json({ ok: true, action, version, status: "running" });
  }

  // start / stop / restart — gated on the Docker backend.
  if (!app.composeYaml) {
    throw new ApiError(409, "no_compose", "This app has no Compose file");
  }
  const docker = await probeDocker();
  if (!docker.available) {
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: `app.${action}`,
      target: app.slug,
      sourceIp: ip,
      result: "failure",
      details: { reason: "docker_unavailable" },
    });
    throw new ApiError(409, "docker_unavailable", DOCKER_UNAVAILABLE_MESSAGE);
  }

  // Ensure the compose file exists on disk before acting on it.
  const file = composeFileFor(app.slug);
  fs.writeFileSync(file, app.composeYaml, { mode: 0o600 });

  const res = await composeAction(
    { id: app.id, slug: app.slug, composeYaml: app.composeYaml },
    action
  );
  if (!res.ok) {
    await db.app.update({ where: { id }, data: { status: "error" } });
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: `app.${action}`,
      target: app.slug,
      sourceIp: ip,
      result: "failure",
      details: { error: res.error.slice(0, 200) },
    });
    throw new ApiError(500, "action_failed", `docker compose ${action} failed: ${res.error}`);
  }

  const status = action === "stop" ? "stopped" : "running";
  await db.app.update({
    where: { id },
    data: { status, ...(action === "stop" ? {} : { lastDeployAt: new Date() }) },
  });
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: `app.${action}`,
    target: app.slug,
    sourceIp: ip,
    details: { status },
  });
  return NextResponse.json({ ok: true, action, status });
});
