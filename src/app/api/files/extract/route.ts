import { NextRequest, NextResponse } from "next/server";
import { promises as fsp } from "fs";
import path from "path";
import { handle } from "@/lib/api-error";
import { ApiError } from "@/lib/api-error";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { run } from "@/lib/exec";
import {
  resolveExistingPath,
  resolveTargetPath,
  assertMutableTarget,
  isArchivePath,
} from "@/lib/file-manager";

export const runtime = "nodejs";

const MAX_LIST_ENTRIES = 20_000;

type Kind = "tar" | "tgz" | "tbz2" | "txz" | "zip";

function archiveKind(p: string): Kind | null {
  const b = path.basename(p).toLowerCase();
  if (b.endsWith(".zip")) return "zip";
  if (b.endsWith(".tar.gz") || b.endsWith(".tgz")) return "tgz";
  if (b.endsWith(".tar.bz2") || b.endsWith(".tbz2")) return "tbz2";
  if (b.endsWith(".tar.xz") || b.endsWith(".txz")) return "txz";
  if (b.endsWith(".tar")) return "tar";
  return null;
}

function tarFlag(kind: Kind): string {
  switch (kind) {
    case "tgz": return "-z";
    case "tbz2": return "-j";
    case "txz": return "-J";
    default: return "";
  }
}

/**
 * Inspect one listing line; returns the entry name or throws when the entry is
 * unsafe (absolute, '..' escape, symlink/hardlink, malformed line).
 */
function checkListingLine(line: string, maxFields: number): string {
  const parts = line.trim().split(/\s+/, maxFields);
  if (parts.length < maxFields) {
    throw new ApiError(400, "unsafe_archive", `Archive listing is malformed: "${line.slice(0, 120)}"`);
  }
  const mode = parts[0];
  const name = parts[maxFields - 1];
  if (/^[lh]/.test(mode)) {
    throw new ApiError(
      400,
      "unsafe_archive",
      "Archive contains symlink/hardlink entries, which are not allowed"
    );
  }
  if (!name || name.includes("\0")) {
    throw new ApiError(400, "unsafe_archive", "Archive contains an empty or invalid entry name");
  }
  if (name.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(name)) {
    throw new ApiError(400, "unsafe_archive", `Archive contains an absolute path: ${name.slice(0, 120)}`);
  }
  if (name.includes("\\")) {
    throw new ApiError(400, "unsafe_archive", `Archive contains an unsafe entry name: ${name.slice(0, 120)}`);
  }
  const segs = name.split("/");
  if (segs.includes("..")) {
    throw new ApiError(400, "unsafe_archive", `Archive entry escapes the destination: ${name.slice(0, 120)}`);
  }
  return name;
}

/**
 * POST /api/files/extract { path, destDir }
 * 1. list entries (tar -tvf / unzip -Z) and reject absolute paths, '..' and
 *    symlink/hardlink entries;
 * 2. extract (tar -xzf / unzip -q) into destDir (within roots, not protected).
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "files:write" });
  const body = (await req.json().catch(() => null)) as
    | { path?: unknown; destDir?: unknown }
    | null;
  if (!body || typeof body.path !== "string" || typeof body.destDir !== "string") {
    throw new ApiError(400, "invalid_body", "Request must be JSON with 'path' and 'destDir'");
  }

  const archive = await resolveExistingPath(body.path);
  const st = await fsp.stat(archive).catch(() => null);
  if (!st?.isFile() || !isArchivePath(archive)) {
    throw new ApiError(400, "not_an_archive", "Path is not a supported archive (.tar.gz/.tgz/.tar.bz2/.tar.xz/.tar/.zip)");
  }
  const kind = archiveKind(archive);
  if (!kind) {
    throw new ApiError(400, "not_an_archive", "Unsupported archive type");
  }

  const destDir = await resolveTargetPath(body.destDir);
  assertMutableTarget(destDir);

  // ---- step 1: safe listing ----
  const listRes =
    kind === "zip"
      ? await run("unzip", ["-Z", archive], { timeoutMs: 30_000, maxBuffer: 16 * 1024 * 1024 })
      : await run(
          "tar",
          ["-tvf", archive, tarFlag(kind)].filter((a) => a !== ""),
          { timeoutMs: 30_000, maxBuffer: 16 * 1024 * 1024 }
        );
  if (!listRes.ok) {
    throw new ApiError(400, "archive_failed", `Could not list archive: ${(listRes.stderr || listRes.stdout).slice(0, 300)}`);
  }
  const lines = listRes.stdout.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    throw new ApiError(400, "archive_failed", "Archive is empty or unreadable");
  }
  if (lines.length > MAX_LIST_ENTRIES) {
    throw new ApiError(413, "too_large", `Archive has too many entries (${lines.length}, max ${MAX_LIST_ENTRIES})`);
  }
  const maxFields = kind === "zip" ? 8 : 6;
  const names: string[] = [];
  for (const line of lines) {
    names.push(checkListingLine(line, maxFields));
  }

  // ---- step 2: extract ----
  await fsp.mkdir(destDir, { recursive: true });
  const exRes =
    kind === "zip"
      ? await run("unzip", ["-q", "-o", archive, "-d", destDir], { timeoutMs: 120_000, maxBuffer: 8 * 1024 * 1024 })
      : await run(
          "tar",
          ["-xf", archive, tarFlag(kind), "-C", destDir, "--no-same-owner", "--no-same-permissions"]
            .filter((a) => a !== ""),
          { timeoutMs: 120_000, maxBuffer: 8 * 1024 * 1024 }
        );
  if (!exRes.ok) {
    await fsp.rm(destDir, { recursive: true, force: true }).catch(() => {});
    throw new ApiError(500, "extract_failed", `Extraction failed: ${(exRes.stderr || exRes.stdout).slice(0, 300)}`);
  }

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "files.extract",
    target: destDir,
    sourceIp: getClientIp(req),
    details: { archive, entries: names.length },
  });
  return NextResponse.json({ ok: true, path: destDir, entries: names.length });
});
