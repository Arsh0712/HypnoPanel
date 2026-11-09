import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { BACKUPS_DIR } from "@/lib/constants";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/backups/[id]/download — stream the .tar.gz archive as an attachment. */
export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  await guard(req, { permission: "backups:read" });
  const { id } = await ctx.params;
  const row = await db.backup.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "not_found", "Backup not found");

  // Path-safety: the resolved path must stay inside the backups directory.
  const target = path.resolve(BACKUPS_DIR, row.fileName);
  if (!target.startsWith(path.resolve(BACKUPS_DIR) + path.sep)) {
    throw new ApiError(403, "unsafe_path", "Refusing to serve a file outside the backups directory");
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new ApiError(404, "file_missing", "Archive file missing on disk");
  }

  const stat = fs.statSync(target);
  const stream = Readable.toWeb(fs.createReadStream(target)) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      "content-type": "application/gzip",
      "content-length": String(stat.size),
      "content-disposition": `attachment; filename="${row.fileName}"`,
      "x-backup-sha256": row.sha256,
    },
  });
});
