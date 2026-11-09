import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { inspectBackup } from "@/lib/backup";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/backups/[id]/inspect — list archive entries (capped at 200). */
export const POST = handle(async (req: NextRequest, ctx: Ctx) => {
  await guard(req, { permission: "backups:read" });
  const { id } = await ctx.params;
  const row = await db.backup.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "not_found", "Backup not found");

  const result = await inspectBackup(id);
  return NextResponse.json({ entries: result.entries.slice(0, 200) });
});
