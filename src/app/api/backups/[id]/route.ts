import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import { BACKUPS_DIR } from "@/lib/constants";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/backups/[id] — delete the archive file and its row. */
export const DELETE = handle(async (req: NextRequest, ctx: Ctx) => {
  const auth = await guard(req, { permission: "backups:write" });
  const { id } = await ctx.params;
  const row = await db.backup.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "not_found", "Backup not found");

  // Path-safety: the resolved path must stay inside the backups directory.
  const target = path.resolve(BACKUPS_DIR, row.fileName);
  if (!target.startsWith(path.resolve(BACKUPS_DIR) + path.sep)) {
    throw new ApiError(403, "unsafe_path", "Refusing to delete a file outside the backups directory");
  }
  try {
    fs.unlinkSync(target);
  } catch {
    /* file already gone — still remove the row */
  }

  await db.backup.delete({ where: { id } });
  await audit({
    actorId: auth.userId,
    actorEmail: auth.email,
    action: "backup.delete",
    target: row.fileName,
    sourceIp: getClientIp(req),
    details: { id, sizeBytes: row.sizeBytes },
  });
  return NextResponse.json({ ok: true });
});
