import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { composeFileFor, DOCKER_UNAVAILABLE_MESSAGE, probeDocker } from "../../_lib";
import { run } from "@/lib/exec";

export const runtime = "nodejs";

/**
 * GET /api/apps/[id]/logs?tail=200 — REAL container logs via
 * `docker compose logs --tail N --no-log-prefix`. Honest 409 when the Docker
 * backend is absent (nothing is faked). Tails are capped at 1000 lines.
 */
export const GET = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await guard(req, { permission: "apps:read" });
  const { id } = await params;
  const app = await db.app.findUnique({ where: { id } });
  if (!app) throw new ApiError(404, "not_found", "App not found");
  if (!app.composeYaml) throw new ApiError(409, "no_compose", "This app has no Compose file");

  const url = new URL(req.url);
  const tailRaw = Number(url.searchParams.get("tail") ?? 200);
  const tail = Number.isInteger(tailRaw) && tailRaw > 0 ? Math.min(tailRaw, 1000) : 200;

  const docker = await probeDocker();
  if (!docker.available) {
    throw new ApiError(409, "docker_unavailable", DOCKER_UNAVAILABLE_MESSAGE);
  }

  const file = composeFileFor(app.slug);
  fs.writeFileSync(file, app.composeYaml, { mode: 0o600 });
  const res = await run("docker", ["compose", "-f", file, "logs", "--tail", String(tail), "--no-color"], {
    timeoutMs: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (!res.ok && !res.stdout.trim()) {
    throw new ApiError(
      500,
      "logs_failed",
      `docker compose logs failed: ${(res.stderr || `exit code ${res.code}`).trim().slice(0, 300)}`
    );
  }
  return NextResponse.json({
    slug: app.slug,
    tail,
    logs: (res.stdout || res.stderr || "").split("\n").slice(-tail),
  });
});
