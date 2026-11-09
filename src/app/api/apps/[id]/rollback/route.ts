import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";
import { run } from "@/lib/exec";
import { composeFileFor, probeDocker } from "../../_lib";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/apps/[id]/rollback — { releaseId }. Marks the release active
 * (status "rolled-back"), points the app at that release's Compose and
 * applies it when the Docker backend is available. The rollback itself is
 * always recorded; the live apply is honestly reported.
 */
export const POST = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "apps:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;

  const app = await db.app.findUnique({ where: { id } });
  if (!app) throw new ApiError(404, "not_found", "App not found");

  const body = (await req.json().catch(() => ({}))) as { releaseId?: unknown };
  const releaseId = typeof body.releaseId === "string" ? body.releaseId : "";
  if (!releaseId) {
    throw new ApiError(400, "invalid_release", "releaseId is required");
  }

  const release = await db.appRelease.findUnique({ where: { id: releaseId } });
  if (!release || release.appId !== id) {
    throw new ApiError(404, "release_not_found", "Release not found for this app");
  }
  if (!release.composeYaml) {
    throw new ApiError(409, "no_compose", "That release has no Compose file");
  }

  // DB-level rollback: only one release stays marked as the rolled-back target.
  await db.appRelease.updateMany({
    where: { appId: id, status: "rolled-back" },
    data: { status: "deployed" },
  });
  await db.appRelease.update({
    where: { id: release.id },
    data: {
      status: "rolled-back",
      note: `${release.note ? release.note + " — " : ""}active (rolled back)`,
    },
  });
  await db.app.update({
    where: { id },
    data: { composeYaml: release.composeYaml, status: "configured" },
  });

  // Docker-gated apply.
  const docker = await probeDocker();
  let applied = false;
  let applyError: string | null = null;
  if (docker.available) {
    try {
      const file = composeFileFor(app.slug);
      fs.writeFileSync(file, release.composeYaml, { mode: 0o600 });
      const res = await run("docker", ["compose", "-f", file, "up", "-d"], {
        timeoutMs: 180_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (res.ok) {
        applied = true;
        await db.app.update({
          where: { id },
          data: { status: "running", lastDeployAt: new Date() },
        });
      } else {
        applyError = (res.stderr || res.stdout || `exit ${res.code}`).trim().slice(0, 300);
        await db.app.update({ where: { id }, data: { status: "error" } });
      }
    } catch (e) {
      applyError = e instanceof Error ? e.message : "apply error";
    }
  }

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "app.rollback",
    target: app.slug,
    sourceIp: ip,
    result: applied ? "success" : "failure",
    details: { version: release.version, applied, reason: applied ? null : "docker_unavailable" },
  });

  return NextResponse.json({
    ok: true,
    rolledBackTo: release.version,
    applied,
    dockerAvailable: docker.available,
    message: applied
      ? `Rolled back to release v${release.version} and redeployed`
      : docker.available
        ? `Rollback recorded to v${release.version}, but the live apply failed: ${applyError}`
        : `Rollback recorded to v${release.version} but NOT applied: Docker Engine is unavailable on this server. The previous containers keep running until you press Deploy.`,
  });
});
