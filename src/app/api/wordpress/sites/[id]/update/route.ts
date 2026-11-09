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
  snapshotsDir,
  checkPluginUpdates,
  checkCoreVersion,
  healthCheck,
  downloadToFile,
  unzipAvailable,
  unzipInto,
  extractedRoot,
  writeSnapshot,
  restoreSnapshot,
  pluginSnapshotSources,
  coreSnapshotSources,
  type WpHistoryEntry,
  type WpScanData,
} from "../../../_lib";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const CACHE_FRESH_MS = 24 * 3600_000;

/** Best-effort removal of the download + extraction scratch files (the
 *  snapshot copies under wp-snapshots/ are always kept for rollback). */
function cleanupScratch(files: string[]): void {
  for (const f of files) {
    try {
      fs.rmSync(f, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

function cachedUpdates(scan: WpScanData): { checkedAt: string; fresh: boolean } | null {
  const u = scan.updates;
  if (!u || !u.checkedAt) return null;
  const age = Date.now() - new Date(u.checkedAt).getTime();
  return { checkedAt: u.checkedAt, fresh: Number.isFinite(age) && age >= 0 && age < CACHE_FRESH_MS };
}

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

/**
 * POST /api/wordpress/sites/[id]/update — apply a real update.
 * Body: { target: "core" | "plugin:<slug>" }
 *
 * Full engineered pipeline: baseline health check → real download from
 * downloads.wordpress.org → pre-update snapshot manifest + byte-for-byte
 * copy → apply (unzip when available, otherwise honest "staged") →
 * post-update health check → automatic revert from the snapshot if the
 * site breaks.
 */
export const POST = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "wordpress:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;
  const site = await getSiteOr404(id);
  const body = (await req.json().catch(() => ({}))) as { target?: unknown };

  const target = typeof body.target === "string" ? body.target.trim() : "";
  if (target !== "core" && !/^plugin:[A-Za-z0-9_.-]+$/.test(target)) {
    throw new ApiError(400, "invalid_target", 'target must be "core" or "plugin:<slug>"');
  }

  const scan = parseScanJson(site.scanJson) as WpScanData;
  const docRoot = site.path;

  /* ---------------------------------------------------------- resolve target */

  let currentVersion: string | null = null;
  let newVersion: string | null = null;
  let packageUrl: string | null = null;
  let pluginSlug: string | null = null;
  let pluginFile: string | null = null;

  if (target === "core") {
    currentVersion = scan.core?.version ?? site.wpVersion ?? null;
    if (!currentVersion) {
      throw new ApiError(409, "not_scanned", "No core version known — run a scan first");
    }
    const live = await checkCoreVersion();
    if (live.latest) {
      newVersion = live.latest;
      packageUrl = live.downloadUrl || `https://downloads.wordpress.org/wordpress-${live.latest}.zip`;
    } else if (cachedUpdates(scan)?.fresh && scan.updates?.core?.available && scan.updates.core.latest) {
      newVersion = scan.updates.core.latest;
      packageUrl = `https://downloads.wordpress.org/wordpress-${newVersion}.zip`;
    } else {
      throw new ApiError(
        502,
        "wordpress_org_unreachable",
        `Cannot determine the latest WordPress version: ${live.error || "wordpress.org did not return an offer"}. No fresh cached update check is available.`
      );
    }
    if (newVersion === currentVersion) {
      return NextResponse.json({
        updated: false,
        reason: "up_to_date",
        target,
        current: currentVersion,
        latest: newVersion,
      });
    }
  } else {
    pluginSlug = target.slice("plugin:".length);
    const installed = (scan.plugins || []).find((p) => p.slug === pluginSlug);
    if (!installed) {
      throw new ApiError(404, "plugin_not_found", `Plugin "${pluginSlug}" is not in the last scan — rescan the site first`);
    }
    pluginFile = installed.file;
    currentVersion = installed.version;

    const live = await checkPluginUpdates([installed]);
    if (!live.error) {
      const entry = live.plugins[0];
      if (!entry || entry.unknown) {
        throw new ApiError(
          409,
          "no_update_available",
          `"${installed.name}" (${pluginSlug}) is not known to wordpress.org — no managed update is possible`
        );
      }
      if (!entry.available) {
        return NextResponse.json({
          updated: false,
          reason: "up_to_date",
          target,
          current: currentVersion,
          latest: entry.latest,
        });
      }
      newVersion = entry.latest;
      packageUrl = live.packages[pluginSlug] || `https://downloads.wordpress.org/plugin/${pluginSlug}.${newVersion}.zip`;
    } else {
      const cached = scan.updates?.plugins?.find((p) => p.slug === pluginSlug);
      if (cachedUpdates(scan)?.fresh && cached?.available && cached.latest) {
        newVersion = cached.latest;
        packageUrl = `https://downloads.wordpress.org/plugin/${pluginSlug}.${newVersion}.zip`;
      } else {
        throw new ApiError(
          502,
          "wordpress_org_unreachable",
          `${live.error}. No fresh cached update check is available for "${pluginSlug}".`
        );
      }
    }
  }

  /* ------------------------------------------------- baseline health + download */

  const healthBefore = await healthCheck(site.url);

  const tmpDir = path.join(siteDataDir(site.id), "wp-tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const safeName = (pluginSlug || "core").replace(/[^a-z0-9.-]+/gi, "-");
  const zipFile = path.join(tmpDir, `${safeName}-${newVersion}.zip`);
  let zipBytes: number;
  try {
    zipBytes = await downloadToFile(packageUrl as string, zipFile);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new ApiError(502, "download_failed", `Could not download ${packageUrl}: ${reason}`);
  }

  const history: WpHistoryEntry[] = Array.isArray(scan.history) ? [...scan.history] : [];
  const pushHistory = (entry: WpHistoryEntry) => {
    history.unshift(entry);
    scan.history = history.slice(0, 20);
  };

  /* -------------------------------------------------- no unzip → honest staged */

  if (!(await unzipAvailable())) {
    const stagedDir = path.join(snapshotsDir(site.id), `${Date.now()}-${safeName}-staged`);
    fs.mkdirSync(stagedDir, { recursive: true });
    const stagedZip = path.join(stagedDir, path.basename(zipFile));
    fs.renameSync(zipFile, stagedZip);
    const manifest = {
      siteId: site.id,
      siteName: site.name,
      target,
      previousVersion: currentVersion,
      newVersion,
      files: [],
      snapshotDir: null,
      zipFile: stagedZip,
      staged: true,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(snapshotsDir(site.id), `${Date.now()}.json`),
      JSON.stringify(manifest, null, 2)
    );
    pushHistory({
      target,
      from: currentVersion,
      to: newVersion,
      at: new Date().toISOString(),
      result: "staged",
      detail: "unzip binary not available — apply via wp-cli on the VPS",
    });
    await db.wpSite.update({ where: { id }, data: { scanJson: JSON.stringify(scan) } });
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "wp.update.apply",
      target: `${site.name}:${target}`,
      sourceIp: ip,
      details: { result: "staged", from: currentVersion, to: newVersion, zipBytes },
    });
    return NextResponse.json({
      result: "staged",
      target,
      from: currentVersion,
      to: newVersion,
      detail: `The update package (${Math.round(zipBytes / 1024)} KB) is staged at ${stagedZip} — the unzip binary is not available in this environment, so apply it on the VPS with: wp ${target === "core" ? "core update" : `plugin update ${pluginSlug}`} --version=${target === "core" ? newVersion : newVersion}`,
    });
  }

  /* ------------------------------------------------- snapshot (manifest + copy) */

  const sources =
    target === "core"
      ? coreSnapshotSources(docRoot)
      : pluginSnapshotSources(docRoot, pluginSlug as string, pluginFile as string);

  const { manifestFile, snapshotDir } = writeSnapshot(
    site,
    target,
    currentVersion,
    newVersion,
    sources.sources,
    sources.touched
  );

  /* ------------------------------------------------------------------- apply */

  const extractDir = path.join(tmpDir, `extract-${Date.now()}`);
  const extracted = await unzipInto(zipFile, extractDir);
  if (!extracted.ok) {
    cleanupScratch([extractDir, zipFile]);
    throw new ApiError(500, "extract_failed", `unzip failed: ${extracted.error} — nothing was changed (snapshot kept at ${snapshotDir})`);
  }

  const applyError: string | null = await (async () => {
    try {
      if (target === "core") {
        const root = extractedRoot(extractDir, "wordpress");
        for (const part of ["wp-includes", "wp-admin"]) {
          const src = path.join(root, part);
          if (!fs.existsSync(src)) continue;
          const dest = path.join(docRoot, part);
          fs.rmSync(dest, { recursive: true, force: true });
          fs.cpSync(src, dest, { recursive: true });
        }
        for (const e of fs.readdirSync(root, { withFileTypes: true })) {
          if (e.isFile() && e.name.endsWith(".php") && e.name !== "wp-config.php") {
            fs.copyFileSync(path.join(root, e.name), path.join(docRoot, e.name));
          }
        }
      } else {
        const slug = pluginSlug as string;
        const pluginsDir = path.join(docRoot, "wp-content", "plugins");
        fs.mkdirSync(pluginsDir, { recursive: true });
        if ((pluginFile as string).includes("/")) {
          const root = extractedRoot(extractDir, slug);
          const dest = path.join(pluginsDir, slug);
          fs.rmSync(dest, { recursive: true, force: true });
          fs.cpSync(root, dest, { recursive: true });
          // Re-detect the main file — the official package may use a different
          // main-file name than the previously installed copy (e.g. hello.php).
          const canonical = path.join(dest, `${slug}.php`);
          if (fs.existsSync(canonical)) {
            pluginFile = `${slug}/${slug}.php`;
          } else {
            for (const e of fs.readdirSync(dest, { withFileTypes: true })) {
              if (!e.isFile() || !e.name.endsWith(".php")) continue;
              const text = readFirst8k(path.join(dest, e.name));
              if (text && /^[ \t]*\*?[ \t]*Plugin Name[ \t]*:/mi.test(text)) {
                pluginFile = `${slug}/${e.name}`;
                break;
              }
            }
          }
        } else {
          // single-file plugin: locate the main file inside the extracted package
          const root = extractedRoot(extractDir, slug);
          let main: string | null = null;
          if (fs.existsSync(path.join(root, `${slug}.php`))) {
            main = path.join(root, `${slug}.php`);
          } else {
            for (const e of fs.readdirSync(root, { withFileTypes: true })) {
              if (!e.isFile() || !e.name.endsWith(".php")) continue;
              const text = readFirst8k(path.join(root, e.name));
              if (text && /^[ \t]*\*?[ \t]*Plugin Name[ \t]*:/mi.test(text)) {
                main = path.join(root, e.name);
                break;
              }
            }
          }
          if (!main) return "extracted package contains no plugin main file";
          fs.copyFileSync(main, path.join(pluginsDir, pluginFile as string));
        }
      }
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  })();

  if (applyError !== null) {
    // Apply failed midway — restore from the snapshot before answering.
    restoreSnapshot(snapshotDir, sources.sources);
    cleanupScratch([extractDir, zipFile]);
    pushHistory({
      target,
      from: currentVersion,
      to: newVersion,
      at: new Date().toISOString(),
      result: "rolled_back",
      detail: `apply failed: ${applyError}`,
    });
    await db.wpSite.update({ where: { id }, data: { scanJson: JSON.stringify(scan) } });
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "wp.update.apply",
      target: `${site.name}:${target}`,
      sourceIp: ip,
      result: "failure",
      details: { result: "rolled_back", reason: applyError },
    });
    return NextResponse.json(
      { result: "rolled_back", target, from: currentVersion, to: newVersion, detail: `Apply failed (${applyError}) — restored from snapshot ${snapshotDir}` },
      { status: 500 }
    );
  }

  /* ----------------------------------------------------------- health check */

  const healthAfter = await healthCheck(site.url);
  const siteBroken = healthAfter !== null && healthAfter >= 500;
  const wentDark = healthAfter === null && healthBefore !== null;

  if (siteBroken || wentDark) {
    restoreSnapshot(snapshotDir, sources.sources);
    cleanupScratch([extractDir, zipFile]);
    pushHistory({
      target,
      from: currentVersion,
      to: newVersion,
      at: new Date().toISOString(),
      result: "rolled_back",
      detail: siteBroken ? `site returned HTTP ${healthAfter}` : "site became unreachable after the update",
    });
    // scanJson keeps the previous (restored) versions; only history is added.
    await db.wpSite.update({ where: { id }, data: { scanJson: JSON.stringify(scan) } });
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "wp.update.apply",
      target: `${site.name}:${target}`,
      sourceIp: ip,
      result: "failure",
      details: {
        result: "rolled_back",
        from: currentVersion,
        to: newVersion,
        healthBefore,
        healthAfter,
      },
    });
    return NextResponse.json({
      result: "rolled_back",
      target,
      from: currentVersion,
      to: newVersion,
      healthCheck: { before: healthBefore, after: healthAfter },
      detail: siteBroken
        ? `Health check failed after the update (HTTP ${healthAfter}) — the site was restored from snapshot ${snapshotDir} and reported as rolled back.`
        : `The site became unreachable after the update — it was restored from snapshot ${snapshotDir} and reported as rolled back.`,
    });
  }

  /* ------------------------------------------------------------ applied ✔ */

  cleanupScratch([extractDir, zipFile]);

  if (target === "core") {
    scan.core = { version: newVersion };
  } else {
    scan.plugins = (scan.plugins || []).map((p) =>
      p.slug === pluginSlug ? { ...p, version: newVersion as string, file: pluginFile || p.file } : p
    );
  }
  pushHistory({
    target,
    from: currentVersion,
    to: newVersion,
    at: new Date().toISOString(),
    result: "applied",
  });

  const updated = await db.wpSite.update({
    where: { id },
    data: {
      scanJson: JSON.stringify(scan),
      ...(target === "core" ? { wpVersion: newVersion } : {}),
    },
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "wp.update.apply",
    target: `${site.name}:${target}`,
    sourceIp: ip,
    details: {
      result: "applied",
      from: currentVersion,
      to: newVersion,
      healthBefore,
      healthAfter,
      filesTouched: sources.touched.length,
      snapshotDir,
    },
  });

  const healthNote =
    healthAfter === null && healthBefore === null
      ? "The site URL was unreachable before and after the update, so the post-update health check could not verify it — the update is applied on disk; verify the site manually."
      : healthAfter === null
        ? `Health check returned HTTP ${healthBefore} before the update; the post-update check timed out (kept applied — the URL is now unreachable).`
        : `Health check passed (HTTP ${healthAfter} after the update).`;

  return NextResponse.json({
    result: "applied",
    target,
    from: currentVersion,
    to: newVersion,
    healthCheck: { before: healthBefore, after: healthAfter },
    detail: healthNote,
    site: { id: updated.id, wpVersion: updated.wpVersion, status: updated.status },
    manifest: { file: manifestFile, snapshotDir, filesTouched: sources.touched.length },
  });
});
