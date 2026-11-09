import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";
import { encrypt } from "@/lib/crypto";
import { findTemplate } from "@/lib/app-templates";
import {
  GIT_TEMPLATE_ID,
  buildEnvFromSpec,
  composeFileFor,
  envSpecFor,
  gitComposeTemplate,
  nextReleaseVersion,
  parseAppEnv,
  performDeploy,
  probeDocker,
  renderCompose,
} from "../_lib";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

async function getAppOr404(id: string) {
  const app = await db.app.findUnique({ where: { id } });
  if (!app) throw new ApiError(404, "not_found", "App not found");
  return app;
}

function safeParseArray(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

/** GET /api/apps/[id] — app detail + releases (desc) + live docker probe. */
export const GET = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  await guard(req, { permission: "apps:read" });
  const { id } = await routeCtx.params;
  const app = await getAppOr404(id);
  const [releases, docker] = await Promise.all([
    db.appRelease.findMany({ where: { appId: id }, orderBy: { version: "desc" } }),
    probeDocker(),
  ]);
  const { plain } = parseAppEnv(app.envJson, app.secretsEnc);
  return NextResponse.json({
    app: {
      id: app.id,
      name: app.name,
      slug: app.slug,
      templateId: app.templateId,
      templateName: app.templateName,
      status: app.status,
      env: plain,
      domains: safeParseArray(app.domains),
      note: app.note,
      composeYaml: app.composeYaml,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
      lastDeployAt: app.lastDeployAt,
    },
    envSpec: envSpecFor(app.templateId),
    releases: releases.map((r) => ({
      id: r.id,
      version: r.version,
      status: r.status,
      note: r.note,
      composeYaml: r.composeYaml,
      createdAt: r.createdAt,
    })),
    docker,
  });
});

/**
 * PATCH /api/apps/[id] — { env?, domains?, note? }. Env changes re-render the
 * Compose file and record a new release version.
 */
export const PATCH = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "apps:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;
  const app = await getAppOr404(id);
  const body = (await req.json().catch(() => ({}))) as {
    env?: unknown;
    domains?: unknown;
    note?: unknown;
  };

  const data: Record<string, unknown> = {};
  let composeChanged = false;

  if (body.env !== undefined) {
    if (typeof body.env !== "object" || body.env === null || Array.isArray(body.env)) {
      throw new ApiError(400, "invalid_env", "env must be an object");
    }
    const spec = envSpecFor(app.templateId);
    if (!spec.length) {
      throw new ApiError(400, "no_env_schema", "This app has no editable environment schema");
    }
    const existing = parseAppEnv(app.envJson, app.secretsEnc);
    const { values, plain, secrets } = buildEnvFromSpec(
      spec,
      body.env as Record<string, unknown>,
      existing
    );
    const tpl =
      app.templateId === GIT_TEMPLATE_ID
        ? gitComposeTemplate(app.slug)
        : findTemplate(app.templateId || "")?.compose;
    if (!tpl) throw new ApiError(409, "no_template", "The original template is no longer available");
    data.envJson = JSON.stringify(plain);
    if (Object.keys(secrets).length) {
      data.secretsEnc = encrypt(JSON.stringify(secrets));
    }
    data.composeYaml = renderCompose(tpl, values);
    composeChanged = true;
  }

  if (body.domains !== undefined) {
    if (!Array.isArray(body.domains)) {
      throw new ApiError(400, "invalid_domains", "domains must be an array");
    }
    const domains = (body.domains as unknown[])
      .map((d) => (typeof d === "string" ? d.trim().toLowerCase() : ""))
      .filter((d): d is string => !!d && d.length <= 253);
    if (domains.length > 10) {
      throw new ApiError(400, "invalid_domains", "At most 10 domains per app");
    }
    data.domains = domains.length ? JSON.stringify(domains) : null;
  }

  if (body.note !== undefined) {
    if (typeof body.note !== "string") {
      throw new ApiError(400, "invalid_note", "note must be a string");
    }
    data.note = body.note.slice(0, 1000);
  }

  if (!Object.keys(data).length) {
    throw new ApiError(400, "nothing_to_update", "Nothing to update (env, domains, note)");
  }

  let newVersion: number | null = null;
  let deployment: { attempted: boolean; ok: boolean; dockerAvailable: boolean; version?: number; error?: string } | null = null;
  if (composeChanged) {
    newVersion = await nextReleaseVersion(id);
    await db.appRelease.create({
      data: {
        appId: id,
        version: newVersion,
        composeYaml: data.composeYaml as string,
        status: "configured",
        note: "Environment updated",
      },
    });
    // FIX#2 §4.2 — env edits REDEPLOY for real when Docker is present
    // (containers are recreated with the new values). Without Docker the
    // release stays "configured" and the response says so honestly.
    const docker = await probeDocker();
    if (docker.available) {
      try {
        const dep = await performDeploy(
          { id: app.id, slug: app.slug, composeYaml: data.composeYaml as string },
          { actorId: ctx.userId, actorEmail: ctx.email, sourceIp: ip },
          "redeploy"
        );
        deployment = { attempted: true, ok: true, dockerAvailable: true, version: dep.version };
      } catch (e) {
        deployment = {
          attempted: true,
          ok: false,
          dockerAvailable: true,
          error: e instanceof ApiError ? e.message : "docker compose failed",
        };
      }
    } else {
      deployment = {
        attempted: false,
        ok: false,
        dockerAvailable: false,
        error: "New configuration saved but NOT applied: Docker Engine is unavailable on this server. Press Deploy after installing Docker.",
      };
    }
  }

  await db.app.update({ where: { id }, data });
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "app.update",
    target: app.slug,
    sourceIp: ip,
    details: { fields: Object.keys(data), newVersion },
  });

  const updated = await db.app.findUnique({ where: { id } });
  return NextResponse.json({
    app: {
      id: updated!.id,
      name: updated!.name,
      slug: updated!.slug,
      status: updated!.status,
      domains: safeParseArray(updated!.domains),
      note: updated!.note,
      composeYaml: updated!.composeYaml,
    },
    newVersion,
    deployment,
  });
});

/**
 * DELETE /api/apps/[id] — deletes the app. If it is running and Docker is
 * available, `docker compose down` is attempted best-effort first.
 */
export const DELETE = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "apps:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;
  const app = await getAppOr404(id);

  let teardown: { attempted: boolean; ok: boolean; error?: string } = {
    attempted: false,
    ok: false,
  };
  if (app.status === "running" && app.composeYaml) {
    const docker = await probeDocker();
    if (docker.available) {
      try {
        const file = composeFileFor(app.slug);
        fs.writeFileSync(file, app.composeYaml, { mode: 0o600 });
        const { run } = await import("@/lib/exec");
        const res = await run("docker", ["compose", "-f", file, "down", "--remove-orphans"], {
          timeoutMs: 120_000,
        });
        teardown = res.ok
          ? { attempted: true, ok: true }
          : { attempted: true, ok: false, error: (res.stderr || res.stdout).trim().slice(0, 300) };
      } catch {
        teardown = { attempted: true, ok: false, error: "teardown error" };
      }
    }
  }

  await db.app.delete({ where: { id } });
  // Remove the staged compose directory best-effort (keeps other apps intact).
  try {
    const dir = composeFileFor(app.slug);
    fs.rmSync(dir, { force: true });
    fs.rmSync(dir.slice(0, dir.lastIndexOf("/")), { force: true });
  } catch {
    /* best effort */
  }

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "app.delete",
    target: app.slug,
    sourceIp: ip,
    details: { status: app.status, teardownAttempted: teardown.attempted, teardownOk: teardown.ok },
  });
  return NextResponse.json({ ok: true, teardown });
});
