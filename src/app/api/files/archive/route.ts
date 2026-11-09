import { NextRequest, NextResponse } from "next/server";
import { promises as fsp } from "fs";
import path from "path";
import { handle } from "@/lib/api-error";
import { ApiError } from "@/lib/api-error";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { run } from "@/lib/exec";
import { resolveExistingPath, resolveTargetPath, assertMutableTarget, isInsideTrash } from "@/lib/file-manager";

export const runtime = "nodejs";

const MAX_PATHS = 64;

/**
 * POST /api/files/archive { paths: string[], dest: string }
 * Creates a tar.gz at `dest` (must end with .tar.gz) via
 * run("tar", ["-czf", dest, "-C", parentDir, ...names]) with one -C pair per
 * source so multi-directory selections work.
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "files:write" });
  const body = (await req.json().catch(() => null)) as
    | { paths?: unknown; dest?: unknown }
    | null;
  if (
    !body ||
    !Array.isArray(body.paths) ||
    body.paths.length === 0 ||
    body.paths.length > MAX_PATHS ||
    typeof body.dest !== "string"
  ) {
    throw new ApiError(
      400,
      "invalid_body",
      `Request must be JSON with 'paths' (1–${MAX_PATHS} absolute paths) and 'dest'`
    );
  }

  const dest = await resolveTargetPath(body.dest);
  if (!path.basename(dest).toLowerCase().endsWith(".tar.gz")) {
    throw new ApiError(400, "invalid_dest", "Destination must end with .tar.gz");
  }
  assertMutableTarget(dest);

  const sources: string[] = [];
  const tarArgs: string[] = ["-czf", dest];
  for (const raw of body.paths) {
    const src = await resolveExistingPath(raw);
    if (isInsideTrash(src)) {
      throw new ApiError(403, "protected_path", "Cannot archive trash entries");
    }
    // the archive output must not live inside a folder being archived
    if (dest === src || dest.startsWith(src + path.sep)) {
      throw new ApiError(400, "invalid_dest", "Destination cannot be inside an archived path");
    }
    if (sources.includes(src)) continue;
    sources.push(src);
    tarArgs.push("-C", path.dirname(src), `./${path.basename(src)}`);
  }

  const res = await run("tar", tarArgs, { timeoutMs: 120_000, maxBuffer: 1024 * 1024 });
  if (!res.ok) {
    await fsp.rm(dest, { force: true }).catch(() => {});
    throw new ApiError(500, "archive_failed", `tar failed: ${(res.stderr || "").slice(0, 300)}`);
  }
  const st = await fsp.stat(dest).catch(() => null);

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "files.archive",
    target: dest,
    sourceIp: getClientIp(req),
    details: { sources, size: st?.size ?? 0 },
  });
  return NextResponse.json({ ok: true, path: dest, size: st?.size ?? 0 });
});
