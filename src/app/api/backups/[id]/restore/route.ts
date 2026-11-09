import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { restoreBackup } from "@/lib/backup";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/backups/[id]/restore — restore from an archive (typed "RESTORE"
 * confirmation happens client-side). The engine takes a pre-restore snapshot
 * and audits backup.restore. When the panel DB is part of the scope the
 * restored file lands at db/custom.db.restored and a restart is required.
 */
export const POST = handle(async (req: NextRequest, ctx: Ctx) => {
  const auth = await guard(req, { permission: "backups:write" });
  const { id } = await ctx.params;
  const result = await restoreBackup(id, { id: auth.userId, email: auth.email });
  if (!result.ok) {
    throw new ApiError(500, "restore_failed", result.error || "Restore failed");
  }
  return NextResponse.json({
    ok: true,
    snapshotId: result.snapshotId,
    restartRequired: !!result.restartRequired,
  });
});
