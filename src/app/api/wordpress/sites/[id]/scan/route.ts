import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";
import {
  getSiteOr404,
  parseScanJson,
  mergeScanData,
  scanWpInstall,
  checkPluginUpdates,
  checkCoreVersion,
  type WpUpdateInfo,
  type WpScanData,
} from "../../../_lib";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/wordpress/sites/[id]/scan — REAL file scan of the docroot:
 * wp-includes/version.php, plugin headers, theme headers, wp-config/salt
 * booleans. Optionally checks updates against api.wordpress.org (default on,
 * graceful offline fallback). Stores scanJson + lastScanAt on the row.
 * Body: { checkUpdates?: boolean }
 */
export const POST = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "wordpress:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;
  const site = await getSiteOr404(id);
  const body = (await req.json().catch(() => ({}))) as { checkUpdates?: unknown };
  const checkUpdates = body.checkUpdates === undefined ? true : body.checkUpdates === true;

  const outcome = scanWpInstall(site.path);
  if (!outcome.ok) {
    await db.wpSite.update({ where: { id }, data: { status: "error" } });
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "wp.site.scan",
      target: site.name,
      sourceIp: ip,
      result: "failure",
      details: { path: site.path, reason: outcome.message },
    });
    throw new ApiError(422, "not_a_wordpress_install", outcome.message);
  }

  const scanned = outcome.result;
  const prev = parseScanJson(site.scanJson) as WpScanData;

  // Real update checks against wordpress.org (graceful offline fallback).
  let updates: WpUpdateInfo | null = null;
  if (checkUpdates) {
    const [pluginCheck, coreCheck] = await Promise.all([
      checkPluginUpdates(scanned.plugins),
      checkCoreVersion(),
    ]);
    const current = scanned.core.version;
    const errors = [pluginCheck.error, coreCheck.error].filter(Boolean) as string[];
    updates = {
      checkedAt: new Date().toISOString(),
      core: {
        current,
        latest: coreCheck.latest,
        available: !!(current && coreCheck.latest && coreCheck.latest !== current),
      },
      plugins: pluginCheck.plugins,
      ...(errors.length ? { error: errors.join("; ") } : {}),
    };
  } else if (prev.updates) {
    updates = prev.updates;
  }

  const nextScan = mergeScanData(prev, {
    ...scanned,
    ...(updates ? { updates } : {}),
  });

  const updated = await db.wpSite.update({
    where: { id },
    data: {
      scanJson: JSON.stringify(nextScan),
      lastScanAt: new Date(),
      wpVersion: scanned.core.version,
      status: "active",
    },
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "wp.site.scan",
    target: site.name,
    sourceIp: ip,
    details: {
      core: scanned.core.version,
      plugins: scanned.plugins.length,
      themes: scanned.themes.length,
      wpConfig: scanned.wpConfig,
      salts: scanned.saltsPresent,
      updateCheck: checkUpdates ? (updates?.error ? "offline" : "ok") : "skipped",
    },
  });

  const { scanJson: _omit, ...row } = updated;
  void _omit;
  return NextResponse.json({
    site: { ...row, lastScanAt: updated.lastScanAt },
    scan: {
      core: scanned.core,
      plugins: scanned.plugins,
      themes: scanned.themes,
      wpConfig: scanned.wpConfig,
      saltsPresent: scanned.saltsPresent,
      updates,
      history: nextScan.history ?? [],
      scannedAt: updated.lastScanAt,
    },
  });
});
