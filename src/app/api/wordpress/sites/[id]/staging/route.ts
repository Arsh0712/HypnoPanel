import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";
import { getSiteOr404, dirStats, resolveStagingPath, siteDataDir } from "../../../_lib";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Safety: a staging path we are allowed to delete must never be the docroot
 *  or live inside it. */
function assertSafeStagingPath(stagingPath: string, docRoot: string): void {
  if (stagingPath === docRoot || stagingPath.startsWith(docRoot + path.sep) || stagingPath === "/") {
    throw new ApiError(400, "unsafe_staging_path", "Refusing to operate on an unsafe staging path");
  }
}

/**
 * GET /api/wordpress/sites/[id]/staging — staging status: real file counts +
 * bytes for staging and production, plus the size diff for push/pull preview.
 */
export const GET = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  await guard(req, { permission: "wordpress:read" });
  const { id } = await routeCtx.params;
  const site = await getSiteOr404(id);

  const production = dirStats(site.path);
  if (!site.stagingPath || !isDirectory(site.stagingPath)) {
    return NextResponse.json({
      staging: { exists: false, path: site.stagingPath, fallback: site.stagingPath?.startsWith(siteDataDir(site.id)) ?? null },
      production,
      diff: null,
    });
  }
  const stagingStats = dirStats(site.stagingPath);
  return NextResponse.json({
    staging: {
      exists: true,
      path: site.stagingPath,
      fallback: site.stagingPath.startsWith(siteDataDir(site.id)),
      files: stagingStats?.files ?? null,
      bytes: stagingStats?.bytes ?? null,
    },
    production,
    diff: production && stagingStats
      ? { files: stagingStats.files - production.files, bytes: stagingStats.bytes - production.bytes }
      : null,
  });
});

/**
 * POST /api/wordpress/sites/[id]/staging — staging lifecycle.
 * Body: { action: "create" (default) | "push" | "pull" }
 *  create — real fs.cp(docRoot → stagingPath), falling back to
 *           data/sites/<id>/staging when the docroot parent isn't writable.
 *  push   — overlay-copy staging over production (preview the diff via GET).
 *  pull   — refresh staging from production.
 */
export const POST = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "wordpress:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;
  const site = await getSiteOr404(id);
  const body = (await req.json().catch(() => ({}))) as { action?: unknown };
  const action = typeof body.action === "string" ? body.action : "create";
  if (!["create", "push", "pull"].includes(action)) {
    throw new ApiError(400, "invalid_action", 'action must be "create", "push" or "pull"');
  }

  if (!isDirectory(site.path)) {
    throw new ApiError(422, "docroot_missing", `Document root ${site.path} does not exist — nothing to copy`);
  }

  if (action === "create") {
    if (site.stagingPath && isDirectory(site.stagingPath)) {
      throw new ApiError(409, "staging_exists", `Staging already exists at ${site.stagingPath}`);
    }
    const { stagingPath, fallback } = resolveStagingPath(site);
    assertSafeStagingPath(stagingPath, site.path);
    if (fs.existsSync(stagingPath)) {
      throw new ApiError(409, "staging_path_occupied", `${stagingPath} already exists on disk`);
    }
    try {
      fs.cpSync(site.path, stagingPath, { recursive: true });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new ApiError(500, "staging_copy_failed", `Could not copy ${site.path} to ${stagingPath}: ${reason}`);
    }
    await db.wpSite.update({ where: { id }, data: { stagingPath } });
    const stats = dirStats(stagingPath);
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "wp.staging.create",
      target: site.name,
      sourceIp: ip,
      details: { stagingPath, fallback, files: stats?.files ?? null, bytes: stats?.bytes ?? null },
    });
    return NextResponse.json({
      staging: {
        exists: true,
        path: stagingPath,
        fallback,
        files: stats?.files ?? null,
        bytes: stats?.bytes ?? null,
      },
    });
  }

  // push / pull both need an existing staging copy
  if (!site.stagingPath || !isDirectory(site.stagingPath)) {
    throw new ApiError(404, "no_staging", "No staging copy exists — create one first");
  }
  assertSafeStagingPath(site.stagingPath, site.path);

  const beforeStaging = dirStats(site.stagingPath);
  const beforeProduction = dirStats(site.path);

  if (action === "push") {
    try {
      // Overlay copy: changed/new files overwrite production; files deleted
      // only in staging stay (documented honestly in the UI).
      fs.cpSync(site.stagingPath, site.path, { recursive: true, force: true });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new ApiError(500, "push_failed", `Push to production failed: ${reason}`);
    }
    const after = dirStats(site.path);
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "wp.staging.push",
      target: site.name,
      sourceIp: ip,
      details: {
        stagingPath: site.stagingPath,
        preview: { staging: beforeStaging, production: beforeProduction },
        after,
      },
    });
    return NextResponse.json({
      result: "pushed",
      preview: { staging: beforeStaging, production: beforeProduction },
      production: after,
      note: "Staging files were overlay-copied onto production. Files that were deleted only in staging are not removed from production — verify the site.",
    });
  }

  // pull
  try {
    fs.rmSync(site.stagingPath, { recursive: true, force: true });
    fs.cpSync(site.path, site.stagingPath, { recursive: true });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new ApiError(500, "pull_failed", `Pull from production failed: ${reason}`);
  }
  const after = dirStats(site.stagingPath);
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "wp.staging.pull",
    target: site.name,
    sourceIp: ip,
    details: { stagingPath: site.stagingPath, after },
  });
  return NextResponse.json({
    result: "pulled",
    staging: { exists: true, path: site.stagingPath, files: after?.files ?? null, bytes: after?.bytes ?? null },
    note: "Staging was replaced with a fresh copy of production.",
  });
});

/** DELETE /api/wordpress/sites/[id]/staging — remove the staging copy. */
export const DELETE = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "wordpress:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;
  const site = await getSiteOr404(id);

  if (!site.stagingPath) {
    throw new ApiError(404, "no_staging", "No staging copy is registered for this site");
  }
  assertSafeStagingPath(site.stagingPath, site.path);
  let removed = false;
  if (isDirectory(site.stagingPath)) {
    try {
      fs.rmSync(site.stagingPath, { recursive: true, force: true });
      removed = true;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new ApiError(500, "delete_failed", `Could not remove ${site.stagingPath}: ${reason}`);
    }
  }
  await db.wpSite.update({ where: { id }, data: { stagingPath: null } });
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "wp.staging.delete",
    target: site.name,
    sourceIp: ip,
    details: { stagingPath: site.stagingPath, removed },
  });
  return NextResponse.json({ ok: true, removed, path: site.stagingPath });
});
