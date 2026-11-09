import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";
import {
  getSiteOr404,
  parseScanJson,
  siteDataDir,
  validateDocRoot,
  validatePhpVersion,
  validateSiteUrl,
  AUTO_CORE_POLICIES,
  type WpScanData,
} from "../../_lib";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/** GET /api/wordpress/sites/[id] — site detail incl. parsed scanJson. */
export const GET = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  await guard(req, { permission: "wordpress:read" });
  const { id } = await routeCtx.params;
  const site = await getSiteOr404(id);
  const scan = parseScanJson(site.scanJson) as WpScanData;
  const stagingExists = !!site.stagingPath && fs.existsSync(site.stagingPath);
  return NextResponse.json({
    site: {
      id: site.id,
      name: site.name,
      url: site.url,
      path: site.path,
      phpVersion: site.phpVersion,
      wpVersion: site.wpVersion,
      autoCore: site.autoCore,
      autoPlugins: site.autoPlugins,
      autoThemes: site.autoThemes,
      stagingPath: site.stagingPath,
      status: site.status,
      lastScanAt: site.lastScanAt,
      createdAt: site.createdAt,
      updatedAt: site.updatedAt,
    },
    scan: site.lastScanAt
      ? {
          core: scan.core ?? null,
          plugins: scan.plugins ?? [],
          themes: scan.themes ?? [],
          wpConfig: scan.wpConfig ?? null,
          saltsPresent: scan.saltsPresent ?? null,
          updates: scan.updates ?? null,
          history: scan.history ?? [],
          scannedAt: site.lastScanAt,
        }
      : null,
    staging: { exists: stagingExists, path: site.stagingPath },
  });
});

/**
 * PATCH /api/wordpress/sites/[id] — settings updates.
 * { name?, url?, path?, phpVersion?, autoCore?, autoPlugins?, autoThemes? }
 */
export const PATCH = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "wordpress:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;
  const site = await getSiteOr404(id);
  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    url?: unknown;
    path?: unknown;
    phpVersion?: unknown;
    autoCore?: unknown;
    autoPlugins?: unknown;
    autoThemes?: unknown;
  };

  const data: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 64) throw new ApiError(400, "invalid_name", "Name must be 1–64 characters");
    data.name = name;
  }
  if (body.url !== undefined) {
    data.url = validateSiteUrl(body.url);
  }
  if (body.path !== undefined) {
    const docRoot = validateDocRoot(body.path);
    const dup = await db.wpSite.findFirst({ where: { path: docRoot, id: { not: id } } });
    if (dup) throw new ApiError(409, "path_taken", `"${dup.name}" already manages ${docRoot}`);
    data.path = docRoot;
  }
  if (body.phpVersion !== undefined) {
    data.phpVersion = validatePhpVersion(body.phpVersion);
  }
  if (body.autoCore !== undefined) {
    if (typeof body.autoCore !== "string" || !(AUTO_CORE_POLICIES as readonly string[]).includes(body.autoCore)) {
      throw new ApiError(400, "invalid_auto_core", "Core auto-update policy must be off, minor or major");
    }
    data.autoCore = body.autoCore;
  }
  if (body.autoPlugins !== undefined) {
    if (typeof body.autoPlugins !== "boolean") throw new ApiError(400, "invalid_auto_plugins", "autoPlugins must be a boolean");
    data.autoPlugins = body.autoPlugins;
  }
  if (body.autoThemes !== undefined) {
    if (typeof body.autoThemes !== "boolean") throw new ApiError(400, "invalid_auto_themes", "autoThemes must be a boolean");
    data.autoThemes = body.autoThemes;
  }

  if (!Object.keys(data).length) {
    throw new ApiError(400, "nothing_to_update", "Nothing to update");
  }

  const updated = await db.wpSite.update({ where: { id }, data });
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "wp.site.update",
    target: updated.name,
    sourceIp: ip,
    details: { fields: Object.keys(data) },
  });

  return NextResponse.json({
    site: {
      id: updated.id,
      name: updated.name,
      url: updated.url,
      path: updated.path,
      phpVersion: updated.phpVersion,
      autoCore: updated.autoCore,
      autoPlugins: updated.autoPlugins,
      autoThemes: updated.autoThemes,
      status: updated.status,
    },
  });
});

/** DELETE /api/wordpress/sites/[id] — remove the site from the panel.
 *  The docroot itself is NEVER touched; only panel-owned data (snapshots,
 *  staging fallback, tmp downloads under data/sites/<id>) is cleaned up. */
export const DELETE = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "wordpress:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;
  const site = await getSiteOr404(id);

  // Clean up the panel-owned working directory (never the docroot).
  const ownDir = siteDataDir(site.id);
  let cleanup = false;
  try {
    if (fs.existsSync(ownDir)) {
      fs.rmSync(ownDir, { recursive: true, force: true });
      cleanup = true;
    }
  } catch {
    cleanup = false;
  }

  // If staging lives next to the docroot (sibling "-staging" dir the panel
  // created), remove that copy too — but only the exact recorded path.
  if (site.stagingPath && site.stagingPath !== site.path && !site.stagingPath.startsWith(path.dirname(siteDataDir(site.id)))) {
    try {
      if (site.stagingPath === path.join(path.dirname(site.path), `${path.basename(site.path)}-staging`)) {
        fs.rmSync(site.stagingPath, { recursive: true, force: true });
      }
    } catch {
      /* best effort */
    }
  }

  await db.wpSite.delete({ where: { id } });
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "wp.site.delete",
    target: site.name,
    sourceIp: ip,
    details: { path: site.path, dataDirCleaned: cleanup },
  });
  return NextResponse.json({ ok: true, dataDirCleaned: cleanup });
});
