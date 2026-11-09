import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { DATABASES_DIR } from "@/lib/constants";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/databases/[id] — remove the database file + panel row. */
export const DELETE = handle(async (req: NextRequest, ctx: Ctx) => {
  const auth = await guard(req, { permission: "databases:write" });
  const { id } = await ctx.params;
  const row = await db.panelDatabase.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "not_found", "Database not found");

  const filePath = path.join(DATABASES_DIR, row.fileName);
  // remove the main file plus SQLite sidecar files (-wal / -shm)
  for (const f of [filePath, `${filePath}-wal`, `${filePath}-shm`]) {
    try {
      if (fs.existsSync(f)) fs.rmSync(f, { force: true });
    } catch {
      /* best effort — row removal below is the source of truth */
    }
  }

  await db.panelDatabase.delete({ where: { id } });

  await audit({
    actorId: auth.userId,
    actorEmail: auth.email,
    action: "database.delete",
    target: row.name,
    sourceIp: getClientIp(req),
    details: { fileName: row.fileName },
  });

  return NextResponse.json({ ok: true });
});
