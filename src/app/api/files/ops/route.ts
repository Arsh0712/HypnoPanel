import { NextRequest, NextResponse } from "next/server";
import { promises as fsp } from "fs";
import path from "path";
import { handle } from "@/lib/api-error";
import { ApiError } from "@/lib/api-error";
import { guard, getClientIp } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { TRASH_DIR } from "@/lib/constants";
import {
  resolveExistingPath,
  resolveTargetPath,
  assertMutableTarget,
  isInsideTrash,
  isRootItself,
  resolveTrashEntry,
  moveToTrash,
  movePath,
  parseModeString,
  validateNameSegment,
  parseTrashName,
  ensureTrashDir,
  diskUsage,
} from "@/lib/file-manager";

export const runtime = "nodejs";

interface OpBody {
  op?: string;
  path?: string;
  from?: string;
  to?: string;
  toDir?: string;
  trashName?: string;
  mode?: string;
}

/** Ensure the caller may perform mutations (ops endpoint is read-guarded for `du`). */
function requireWrite(role: string): void {
  if (!hasPermission(role, "files:write")) {
    throw new ApiError(403, "forbidden", "You do not have permission for this action");
  }
}

async function assertIsDirectory(p: string): Promise<void> {
  const st = await fsp.stat(p).catch(() => null);
  if (!st?.isDirectory()) {
    throw new ApiError(400, "not_a_directory", `Not a directory: ${p}`);
  }
}

async function assertNoCollision(dest: string, label: string): Promise<void> {
  if (await fsp.lstat(dest).catch(() => null)) {
    throw new ApiError(409, "already_exists", `${label} already exists at the destination`);
  }
}

/** POST /api/files/ops — all file operations (spec §5.7). */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "files:read" });
  const body = (await req.json().catch(() => null)) as OpBody | null;
  if (!body || typeof body.op !== "string") {
    throw new ApiError(400, "invalid_body", "Request must be JSON with an 'op' field");
  }
  const op = body.op;
  const ip = getClientIp(req);
  const actor = { actorId: ctx.userId, actorEmail: ctx.email, sourceIp: ip };

  switch (op) {
    // ---------------------------------------------------------------- create
    case "mkdir": {
      requireWrite(ctx.role);
      const target = await resolveTargetPath(body.path);
      assertMutableTarget(target);
      await assertNoCollision(target, "Directory");
      await fsp.mkdir(target, { recursive: false });
      await audit({ ...actor, action: "files.mkdir", target, details: {} });
      return NextResponse.json({ ok: true, path: target });
    }

    case "touch": {
      requireWrite(ctx.role);
      const target = await resolveTargetPath(body.path);
      assertMutableTarget(target);
      if (await fsp.lstat(target).catch(() => null)) {
        // existing file: refresh mtime only (no overwrite of content)
        await fsp.utimes(target, new Date(), new Date());
      } else {
        await fsp.writeFile(target, "", { mode: 0o644 });
      }
      await audit({ ...actor, action: "files.touch", target, details: {} });
      return NextResponse.json({ ok: true, path: target });
    }

    // ---------------------------------------------------------------- modify
    case "rename": {
      requireWrite(ctx.role);
      const from = await resolveExistingPath(body.from);
      const to = await resolveTargetPath(body.to);
      if (from === to) {
        throw new ApiError(400, "invalid_move", "Source and destination are the same");
      }
      // renaming moves the entry OUT of `from` (destructive) and INTO `to`
      assertMutableTarget(from);
      assertMutableTarget(to);
      if (isInsideTrash(from) || isInsideTrash(to)) {
        throw new ApiError(403, "protected_path", "Use restore/purge for trash entries");
      }
      await assertIsDirectory(path.dirname(to));
      await assertNoCollision(to, "Destination");
      await movePath(from, to);
      await audit({
        ...actor,
        action: "files.rename",
        target: to,
        details: { from, to },
      });
      return NextResponse.json({ ok: true, path: to });
    }

    case "move": {
      requireWrite(ctx.role);
      const from = await resolveExistingPath(body.from);
      const toDir = await resolveExistingPath(body.toDir);
      if (isInsideTrash(from)) {
        throw new ApiError(403, "protected_path", "Use restore/purge for trash entries");
      }
      await assertIsDirectory(toDir);
      const dest = path.join(toDir, path.basename(from));
      if (dest === from) {
        throw new ApiError(400, "invalid_move", "Source and destination are the same");
      }
      assertMutableTarget(from); // moving out of `from`
      assertMutableTarget(dest); // creating under toDir
      await assertNoCollision(dest, "Destination");
      await movePath(from, dest);
      await audit({
        ...actor,
        action: "files.move",
        target: dest,
        details: { from, toDir },
      });
      return NextResponse.json({ ok: true, path: dest });
    }

    case "copy": {
      requireWrite(ctx.role);
      const from = await resolveExistingPath(body.from);
      const toDir = await resolveExistingPath(body.toDir);
      await assertIsDirectory(toDir);
      const dest = path.join(toDir, path.basename(from));
      if (dest === from) {
        throw new ApiError(400, "invalid_move", "Cannot copy a path onto itself");
      }
      assertMutableTarget(dest);
      await assertNoCollision(dest, "Destination");
      await fsp.cp(from, dest, { recursive: true, force: false, dereference: false });
      await audit({
        ...actor,
        action: "files.copy",
        target: dest,
        details: { from, toDir },
      });
      return NextResponse.json({ ok: true, path: dest });
    }

    // ---------------------------------------------------------------- delete
    case "delete": {
      requireWrite(ctx.role);
      const target = await resolveExistingPath(body.path);
      assertMutableTarget(target); // protected trees + roots themselves
      if (isInsideTrash(target)) {
        throw new ApiError(400, "in_trash", "Use permanent delete for trash entries");
      }
      if (isRootItself(target)) {
        throw new ApiError(403, "protected_path", "Allowed root directories cannot be deleted");
      }
      const trashName = await moveToTrash(target);
      await audit({
        ...actor,
        action: "files.delete",
        target,
        details: { trashName },
      });
      return NextResponse.json({ ok: true, trashName, path: target });
    }

    // ---------------------------------------------------------------- trash
    case "restore": {
      requireWrite(ctx.role);
      const trashEntry = await resolveTrashEntry(body.trashName);
      const toDir = await resolveExistingPath(body.toDir);
      await assertIsDirectory(toDir);
      const { original } = parseTrashName(path.basename(trashEntry));
      const dest = path.join(toDir, validateNameSegment(original));
      assertMutableTarget(dest);
      await assertNoCollision(dest, "Restored item");
      await movePath(trashEntry, dest);
      await audit({
        ...actor,
        action: "files.restore",
        target: dest,
        details: { trashName: path.basename(trashEntry), toDir },
      });
      return NextResponse.json({ ok: true, path: dest, name: path.basename(dest) });
    }

    case "purge": {
      requireWrite(ctx.role);
      const trashEntry = await resolveTrashEntry(body.trashName);
      await fsp.rm(trashEntry, { recursive: true, force: true });
      await audit({
        ...actor,
        action: "files.purge",
        target: trashEntry,
        details: { trashName: path.basename(trashEntry) },
      });
      return NextResponse.json({ ok: true });
    }

    case "purge-all":
    case "purgeAll": {
      requireWrite(ctx.role);
      await ensureTrashDir();
      const names = await fsp.readdir(TRASH_DIR).catch(() => []);
      let count = 0;
      for (const name of names) {
        const st = await fsp.lstat(path.join(TRASH_DIR, name)).catch(() => null);
        if (!st) continue;
        await fsp.rm(path.join(TRASH_DIR, name), { recursive: true, force: true });
        count++;
      }
      await audit({
        ...actor,
        action: "files.purge_all",
        target: TRASH_DIR,
        details: { count },
      });
      return NextResponse.json({ ok: true, count });
    }

    // ---------------------------------------------------------------- mode
    case "chmod": {
      requireWrite(ctx.role);
      const target = await resolveExistingPath(body.path);
      assertMutableTarget(target);
      if (isInsideTrash(target)) {
        throw new ApiError(400, "in_trash", "Cannot change permissions of trash entries");
      }
      const mode = parseModeString(body.mode);
      await fsp.chmod(target, mode);
      await audit({
        ...actor,
        action: "files.chmod",
        target,
        details: { mode: mode.toString(8).padStart(4, "0") },
      });
      return NextResponse.json({ ok: true, path: target, mode: mode.toString(8).padStart(4, "0") });
    }

    // ---------------------------------------------------------------- info
    case "du": {
      const target = await resolveExistingPath(body.path);
      const bytes = await diskUsage(target);
      return NextResponse.json({ ok: true, path: target, bytes });
    }

    default:
      throw new ApiError(400, "invalid_op", `Unsupported operation: ${op}`);
  }
});
