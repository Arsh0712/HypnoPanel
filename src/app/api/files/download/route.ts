import { NextRequest, NextResponse } from "next/server";
import { promises as fsp } from "fs";
import path from "path";
import os from "os";
import { randomBytes } from "crypto";
import { handle } from "@/lib/api-error";
import { ApiError } from "@/lib/api-error";
import { guard } from "@/lib/auth/guard";
import { run } from "@/lib/exec";
import {
  resolveExistingPath,
  diskUsage,
  MAX_DOWNLOAD_BYTES,
} from "@/lib/file-manager";

export const runtime = "nodejs";

/** RFC 6266-safe Content-Disposition filename (ASCII only, no separators). */
function dispositionName(name: string): string {
  const safe = name.replace(/[^\w.\-() ]+/g, "_").replace(/["\\\r\n]/g, "_");
  return safe || "download";
}

function attachmentHeaders(filename: string, length?: number): HeadersInit {
  const headers: Record<string, string> = {
    "content-type": "application/octet-stream",
    "content-disposition": `attachment; filename="${dispositionName(filename)}"`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  if (length !== undefined) headers["content-length"] = String(length);
  return headers;
}

/** Buffer → zero-copy Uint8Array view accepted as a web BodyInit. */
function toBody(buf: Buffer): Uint8Array<ArrayBuffer> {
  // Buffer's backing store may be typed ArrayBufferLike; the view itself is safe.
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) as Uint8Array<ArrayBuffer>;
}

/**
 * GET /api/files/download?path=<abs>            → single file
 * GET /api/files/download?archive=1&path=<dir>  → tar.gz folder download
 * Both paths are capped at 100 MB.
 *
 * Archives are staged through `run("tar", ["-czf", …])` into a private
 * mkdtemp(0700) folder and streamed back — run() stringifies child stdout,
 * so binary tar output must never be captured via `-czf -` (it would be
 * corrupted by the utf8 round-trip).
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "files:read" });
  const url = new URL(req.url);
  const real = await resolveExistingPath(url.searchParams.get("path") || "");
  const wantArchive = url.searchParams.get("archive") === "1";
  const st = await fsp.stat(real).catch(() => null);

  if (!wantArchive) {
    if (!st?.isFile()) {
      throw new ApiError(400, "not_a_file", "Path is not a regular file (use archive=1 for folders)");
    }
    if (st.size > MAX_DOWNLOAD_BYTES) {
      throw new ApiError(
        413,
        "too_large",
        `File exceeds the 100 MB download limit (${st.size} bytes)`
      );
    }
    const buf = await fsp.readFile(real);
    return new NextResponse(toBody(buf), {
      status: 200,
      headers: attachmentHeaders(path.basename(real), buf.length),
    });
  }

  if (!st?.isDirectory()) {
    throw new ApiError(400, "not_a_directory", "Archive download requires a directory");
  }
  const bytes = await diskUsage(real);
  if (bytes > MAX_DOWNLOAD_BYTES) {
    throw new ApiError(
      413,
      "too_large",
      `Folder exceeds the 100 MB archive limit (${bytes} bytes)`
    );
  }

  const stagingDir = await fsp.mkdtemp(path.join(os.tmpdir(), `hipno-dl-${randomBytes(4).toString("hex")}-`));
  const staged = path.join(stagingDir, "archive.tar.gz");
  try {
    const res = await run("tar", ["-czf", staged, "-C", real, "."], {
      timeoutMs: 120_000,
      maxBuffer: 1024 * 1024,
    });
    if (!res.ok) {
      throw new ApiError(500, "archive_failed", `tar failed: ${(res.stderr || res.stdout).slice(0, 300)}`);
    }
    const ast = await fsp.stat(staged).catch(() => null);
    if (!ast?.isFile() || ast.size === 0) {
      throw new ApiError(500, "archive_failed", "tar produced no output");
    }
    if (ast.size > MAX_DOWNLOAD_BYTES) {
      throw new ApiError(413, "too_large", "Compressed folder exceeds the 100 MB archive limit");
    }
    const buf = await fsp.readFile(staged);
    const filename = `${path.basename(real) || "archive"}.tar.gz`;
    return new NextResponse(toBody(buf), {
      status: 200,
      headers: attachmentHeaders(filename, buf.length),
    });
  } finally {
    await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
});
