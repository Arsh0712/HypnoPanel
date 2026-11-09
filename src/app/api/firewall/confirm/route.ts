import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import { getPendingConfirm, clearPendingConfirm, getRollbackRules } from "@/lib/firewall";

export const runtime = "nodejs";

/**
 * POST /api/firewall/confirm — keep the applied ruleset (clears the pending
 * confirm window so the auto-rollback timer will not fire).
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "firewall:write" });
  const pending = await getPendingConfirm();
  await clearPendingConfirm();
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "firewall.confirm",
    target: "firewall",
    sourceIp: getClientIp(req),
    details: pending ? { appliedAt: pending.appliedAt } : { note: "no pending window" },
  });
  return NextResponse.json({ ok: true, kept: true });
});
