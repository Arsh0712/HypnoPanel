import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import { verifyBackup } from "@/lib/backup";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/backups/[id]/verify — SHA-256 integrity check (honest result payload). */
export const POST = handle(async (req: NextRequest, ctx: Ctx) => {
  const auth = await guard(req, { permission: "backups:write" });
  const { id } = await ctx.params;
  const result = await verifyBackup(id);
  await audit({
    actorId: auth.userId,
    actorEmail: auth.email,
    action: "backup.verify",
    target: id,
    sourceIp: getClientIp(req),
    result: result.ok ? "success" : "failure",
    details: { status: result.status, error: result.error },
  });
  return NextResponse.json(result);
});
