import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";
import {
  parseScanJson,
  validateDocRoot,
  validatePhpVersion,
  validateSiteUrl,
  type WpScanData,
} from "../_lib";

export const runtime = "nodejs";

function readFirst8k(file: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, 8192, 0);
    return buf.subarray(0, n).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* best effort */
      }
    }
  }
}

/** Quick, non-throwing detection used at creation time (honest status). */
function detectWpVersion(docRoot: string): string | null {
  const text = readFirst8k(path.join(docRoot, "wp-includes", "version.php"));
  if (!text) return null;
  const m = text.match(/\$wp_version\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

function serialize(site: {
  id: string;
  name: string;
  url: string;
  path: string;
  phpVersion: string;
  wpVersion: string | null;
  autoCore: string;
  autoPlugins: boolean;
  autoThemes: boolean;
  stagingPath: string | null;
  status: string;
  lastScanAt: Date | null;
  scanJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const scan = parseScanJson(site.scanJson) as WpScanData;
  const pluginUpdates = (scan.updates?.plugins || []).filter((p) => p.available).length;
  const coreUpdate = scan.updates?.core?.available ? 1 : 0;
  return {
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
    pluginCount: scan.plugins?.length ?? 0,
    themeCount: scan.themes?.length ?? 0,
    updatesAvailable: pluginUpdates + coreUpdate,
  };
}

/** GET /api/wordpress/sites — list all managed WordPress sites. */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "wordpress:read" });
  const sites = await db.wpSite.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ sites: sites.map(serialize) });
});

/**
 * POST /api/wordpress/sites — register a WordPress site.
 * { name, url, path, phpVersion }
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "wordpress:write" });
  const ip = getClientIp(req);
  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    url?: unknown;
    path?: unknown;
    phpVersion?: unknown;
  };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 64) {
    throw new ApiError(400, "invalid_name", "Name is required (max 64 characters)");
  }
  const url = validateSiteUrl(body.url);
  const docRoot = validateDocRoot(body.path);
  const phpVersion = validatePhpVersion(body.phpVersion ?? "8.3");

  const dupPath = await db.wpSite.findFirst({ where: { path: docRoot } });
  if (dupPath) {
    throw new ApiError(409, "path_taken", `"${dupPath.name}" already manages ${docRoot}`);
  }

  const detected = detectWpVersion(docRoot);
  const site = await db.wpSite.create({
    data: {
      name,
      url,
      path: docRoot,
      phpVersion,
      wpVersion: detected,
      status: detected ? "active" : "error",
      scanJson: JSON.stringify({ core: { version: detected } }),
    },
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "wp.site.create",
    target: name,
    sourceIp: ip,
    details: { url, path: docRoot, phpVersion, wpDetected: detected !== null },
  });

  return NextResponse.json({ site: serialize(site) }, { status: 201 });
});
