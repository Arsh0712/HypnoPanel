import fsp from "fs/promises";
import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import { ApiError } from "@/lib/api-error";
import { isWithinRoots } from "@/lib/validation";
import { parseMounts, statfsPath, type MountInfo } from "../_shared";

export const runtime = "nodejs";

/**
 * GET  /api/server/disk — statfs of /, /home and /var (only when they exist),
 *        with device/fstype names from /proc/mounts.
 * POST /api/server/disk — real async du-style walk {path} with depth limit,
 *        symlink skipping and a 5s budget; partial results are flagged.
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "server:read" });
  const mountMap = parseMounts();
  const mounts: MountInfo[] = [];
  for (const p of ["/", "/home", "/var"]) {
    if (!fs.existsSync(p)) continue;
    const st = statfsPath(p);
    if (!st) continue;
    const meta = mountMap.get(p) || mountMap.get("/") || { device: "unknown", fstype: "unknown" };
    mounts.push({ ...st, device: meta.device, fstype: meta.fstype });
  }
  return NextResponse.json({ mounts });
});

const MAX_DEPTH = 6;
const BUDGET_MS = 5_000;
const MAX_FILES = 60_000;

interface WalkTotals {
  bytes: number;
  files: number;
  dirs: number;
}

export const POST = handle(async (req: NextRequest) => {
  await guard(req, { permission: "server:read" });
  const body = (await req.json().catch(() => ({}))) as { path?: string };
  const root = body.path;

  if (typeof root !== "string" || !root.startsWith("/")) {
    throw new ApiError(400, "invalid_input", "path must be an absolute path");
  }
  const normalized = path.normalize(root).replace(/\/+$/, "") || "/";
  if (!isWithinRoots(normalized)) {
    throw new ApiError(400, "invalid_input", "Path is outside the panel's allowed roots");
  }
  let st;
  try {
    st = fs.statSync(normalized);
  } catch {
    throw new ApiError(400, "invalid_input", "Path does not exist");
  }
  if (!st.isDirectory()) {
    throw new ApiError(400, "invalid_input", "Path is not a directory");
  }

  const startedAt = Date.now();
  const deadline = startedAt + BUDGET_MS;
  let partial = false;
  let partialReason: string | null = null;
  let skipped = 0;
  let totalFiles = 0;

  async function measure(dir: string, depth: number): Promise<WalkTotals> {
    const totals: WalkTotals = { bytes: 0, files: 0, dirs: 0 };
    if (Date.now() > deadline) {
      partial = true;
      partialReason = "walk hit the 5s time budget";
      return totals;
    }
    let dirents;
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      skipped++;
      return totals;
    }
    for (const d of dirents) {
      if (Date.now() > deadline) {
        partial = true;
        partialReason = "walk hit the 5s time budget";
        break;
      }
      if (totalFiles > MAX_FILES) {
        partial = true;
        partialReason = `file cap reached (${MAX_FILES} files)`;
        break;
      }
      if (d.isSymbolicLink()) continue; // never follow symlinks
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (depth >= MAX_DEPTH) {
          partial = true;
          partialReason = `depth limit reached (${MAX_DEPTH} levels)`;
          continue;
        }
        const sub = await measure(full, depth + 1);
        totals.bytes += sub.bytes;
        totals.files += sub.files;
        totals.dirs += sub.dirs + 1;
      } else if (d.isFile()) {
        try {
          const s = await fsp.stat(full);
          totals.bytes += s.size;
          totals.files++;
          totalFiles++;
        } catch {
          skipped++;
        }
      }
    }
    return totals;
  }

  const entries: (WalkTotals & { name: string; path: string })[] = [];
  let rootFiles = 0;
  let rootBytes = 0;
  let rootDirs = 0;
  let dirents;
  try {
    dirents = await fsp.readdir(normalized, { withFileTypes: true });
  } catch {
    throw new ApiError(400, "invalid_input", "Directory is not readable by the panel process");
  }
  for (const d of dirents) {
    if (Date.now() > deadline) {
      partial = true;
      partialReason = "walk hit the 5s time budget";
      break;
    }
    if (d.isSymbolicLink()) continue;
    const full = path.join(normalized, d.name);
    if (d.isDirectory()) {
      const sub = await measure(full, 1);
      entries.push({ ...sub, name: d.name, path: full });
      rootDirs++;
    } else if (d.isFile()) {
      try {
        const s = await fsp.stat(full);
        rootBytes += s.size;
        rootFiles++;
        totalFiles++;
      } catch {
        skipped++;
      }
    }
  }

  entries.sort((a, b) => b.bytes - a.bytes);
  const rootTotal = rootBytes + entries.reduce((a, e) => a + e.bytes, 0);

  return NextResponse.json({
    path: normalized,
    rootBytes: rootTotal,
    entries: entries.slice(0, 12).map((e) => ({
      name: e.name,
      path: e.path,
      bytes: e.bytes,
      files: e.files,
      dirs: e.dirs,
    })),
    fileCount: rootFiles + entries.reduce((a, e) => a + e.files, 0),
    dirCount: rootDirs + entries.reduce((a, e) => a + e.dirs, 0),
    skipped,
    partial,
    partialReason,
    elapsedMs: Date.now() - startedAt,
  });
});
