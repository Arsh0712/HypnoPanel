import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import {
  applyRuleset,
  findNftBinary,
  getRollbackRules,
  clearRollbackRules,
  clearPendingConfirm,
  setLastAppliedRules,
} from "@/lib/firewall";

export const runtime = "nodejs";

/**
 * POST /api/firewall/rollback — immediately restore the pre-apply snapshot
 * and clear any pending confirm window.
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "firewall:write" });
  const snapshot = await getRollbackRules();
  if (!snapshot) {
    throw new ApiError(409, "no_snapshot", "No rollback snapshot is available");
  }
  const nftBinary = await findNftBinary();
  if (!nftBinary) {
    // Nothing can have been applied without the backend — stay honest.
    await clearPendingConfirm();
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "firewall.rollback",
      target: "firewall",
      sourceIp: getClientIp(req),
      details: { note: "nft binary not available — nothing was applied" },
    });
    return NextResponse.json({
      applied: false,
      error: "nftables backend not available — nothing was applied, nothing to roll back",
    });
  }

  const res = await applyRuleset(nftBinary, snapshot);
  if (!res.applied) {
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "firewall.rollback",
      target: "firewall",
      sourceIp: getClientIp(req),
      result: "failure",
      details: { error: res.error?.slice(0, 300) },
    });
    throw new ApiError(500, "rollback_failed", res.error || "Rollback failed");
  }

  await setLastAppliedRules(snapshot);
  await clearPendingConfirm();
  await clearRollbackRules();
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "firewall.rollback",
    target: "firewall",
    sourceIp: getClientIp(req),
    details: { restored: true },
  });
  return NextResponse.json({ applied: true, rolledBack: true });
});
