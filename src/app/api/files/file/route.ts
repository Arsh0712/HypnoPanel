import { NextRequest, NextResponse } from "next/server";
import { promises as fsp } from "fs";
import path from "path";
import { handle } from "@/lib/api-error";
import { ApiError } from "@/lib/api-error";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import {
  resolveExistingPath,
  resolveTargetPath,
  assertMutableTarget,
  MAX_READ_BYTES,
  languageForPath,
  looksBinaryByExt,
  isBinaryContent,
} from "@/lib/file-manager";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

/** GET /api/files/file?path=<abs> → content + metadata (2 MB cap). */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "files:read" });
  const url = new URL(req.url);
  const real = await resolveExistingPath(url.searchParams.get("path") || "");
  const st = await fsp.stat(real).catch(() => null);
  if (!st?.isFile()) {
    throw new ApiError(400, "not_a_file", "Path is not a regular file");
  }
  if (st.size > MAX_READ_BYTES) {
    throw new ApiError(
      413,
      "too_large",
      `File is too large to open in the editor (${st.size} bytes, max ${MAX_READ_BYTES} bytes / 2 MB)`
    );
  }
  const binary = (await isBinaryContent(real)) || looksBinaryByExt(real);
  if (binary) {
    return NextResponse.json({
      path: real,
      size: st.size,
      binary: true,
      language: languageForPath(real),
      content: "",
    });
  }
  const content = await fsp.readFile(real, "utf8");
  return NextResponse.json({
    path: real,
    size: st.size,
    mtimeMs: Math.round(st.mtimeMs),
    binary: false,
    language: languageForPath(real),
    content,
  });
});

/** PUT /api/files/file { path, content, expectedMtimeMs? } → atomic write
 * (temp file + rename) with optimistic-concurrency: when expectedMtimeMs is
 * given and the file changed on disk since it was loaded, the write is
 * refused with 409 file_conflict (FIX#2 §5 — IDE-grade save safety). */
export const PUT = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "files:write" });
  const body = (await req.json().catch(() => null)) as {
    path?: string;
    content?: string;
    expectedMtimeMs?: number;
  } | null;
  if (!body || typeof body.path !== "string" || typeof body.content !== "string") {
    throw new ApiError(400, "invalid_body", "Request must be JSON with 'path' and 'content'");
  }
  if (Buffer.byteLength(body.content, "utf8") > MAX_READ_BYTES) {
    throw new ApiError(413, "too_large", "Content exceeds the 2 MB editor limit");
  }
  const target = await resolveTargetPath(body.path);
  assertMutableTarget(target);

  const existed = await fsp.stat(target).catch(() => null);
  if (existed && !existed.isFile()) {
    throw new ApiError(400, "not_a_file", "Target exists and is not a regular file");
  }

  // Optimistic concurrency — refuse silent overwrites of external changes.
  if (
    body.expectedMtimeMs !== undefined &&
    existed &&
    Math.round(existed.mtimeMs) !== Math.round(body.expectedMtimeMs)
  ) {
    throw new ApiError(
      409,
      "file_conflict",
      "The file changed on disk after you opened it (another editor, terminal command or deploy). Reload it and re-apply your edit, or save anyway to overwrite."
    );
  }

  // preserve the previous mode on overwrite
  const mode = existed ? existed.mode & 0o7777 : 0o644;

  const dir = path.dirname(target);
  const tmp = path.join(dir, `.hipno-tmp-${randomBytes(6).toString("hex")}-${path.basename(target)}`);
  await fsp.writeFile(tmp, body.content, { encoding: "utf8", mode });
  const st = await fsp.stat(tmp);
  try {
    await fsp.rename(tmp, target);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  const size = Buffer.byteLength(body.content, "utf8");
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: existed ? "files.write" : "files.create",
    target,
    sourceIp: getClientIp(req),
    details: { size, overwrite: !!existed },
  });
  return NextResponse.json({ path: target, size, mtimeMs: Math.round(st.mtimeMs) });
});
