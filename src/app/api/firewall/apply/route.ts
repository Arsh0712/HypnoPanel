import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { PANEL_PORT } from "@/lib/constants";
import {
  generateRuleset,
  applyRuleset,
  findNftBinary,
  findBlockingRule,
  getPendingConfirm,
  setPendingConfirm,
  clearPendingConfirm,
  getRollbackRules,
  setRollbackRules,
  getLastAppliedRules,
  setLastAppliedRules,
  FIREWALL_CONFIRM_WINDOW_MS,
} from "@/lib/firewall";

export const runtime = "nodejs";

/**
 * POST /api/firewall/apply — apply the generated ruleset (spec §5.8).
 * Flow: typed confirm → safety check (never block SSH/panel) → snapshot
 * rollback state → apply → enter 60s confirm window with auto-rollback.
 * When the nft backend is unavailable the ruleset is only staged and the
 * response says so honestly.
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "firewall:write" });
  const body = (await req.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm !== "APPLY") {
    throw new ApiError(400, "confirm_required", 'Type "APPLY" to confirm firewall changes');
  }

  const [rules, sshPort, nftBinary] = await Promise.all([
    db.firewallRule.findMany({ orderBy: { createdAt: "asc" } }),
    getSetting("network.sshPort", 22),
    findNftBinary(),
  ]);

  // Safety (spec §5.8): never apply a ruleset that would cut off SSH or the panel.
  const blocking = findBlockingRule(rules, [sshPort, PANEL_PORT]);
  if (blocking) {
    throw new ApiError(
      409,
      "unsafe_ruleset",
      "This ruleset would block the SSH/panel port — refine the rule"
    );
  }

  const text = generateRuleset(rules);

  // No nft backend → stage only, stay honest, do NOT enter pending-confirm mode.
  if (!nftBinary) {
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "firewall.apply.staged",
      target: "firewall",
      sourceIp: getClientIp(req),
      details: { rules: rules.length, reason: "nft binary not available" },
    });
    return NextResponse.json({
      applied: false,
      staged: true,
      error:
        "nftables backend not available in this environment — ruleset is staged (see generated config)",
    });
  }

  // Snapshot the previously applied ruleset for rollback (safe baseline on first apply).
  const prevText = (await getLastAppliedRules()) ?? generateRuleset([]);
  await setRollbackRules(prevText);

  const res = await applyRuleset(nftBinary, text);
  if (!res.applied) {
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "firewall.apply",
      target: "firewall",
      sourceIp: getClientIp(req),
      result: "failure",
      details: { error: res.error?.slice(0, 300) },
    });
    return NextResponse.json({ applied: false, error: res.error });
  }

  await setLastAppliedRules(text);
  const pendingConfirm = {
    deadline: Date.now() + FIREWALL_CONFIRM_WINDOW_MS,
    appliedAt: new Date().toISOString(),
  };
  await setPendingConfirm(pendingConfirm);

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "firewall.apply",
    target: "firewall",
    sourceIp: getClientIp(req),
    details: { rules: rules.length, confirmWindowMs: FIREWALL_CONFIRM_WINDOW_MS },
  });

  // Auto-rollback timer: if not confirmed within the window, restore the snapshot.
  const timer = setTimeout(async () => {
    try {
      const stillPending = await getPendingConfirm();
      if (!stillPending) return; // confirmed in time — keep the rules
      const snapshot = await getRollbackRules();
      const nft = await findNftBinary();
      if (snapshot && nft) {
        const rollback = await applyRuleset(nft, snapshot);
        if (rollback.applied) await setLastAppliedRules(snapshot);
        await audit({
          action: "firewall.auto_rollback",
          target: "firewall",
          source: "system",
          result: rollback.applied ? "success" : "failure",
          details: { reason: "confirm timeout", error: rollback.error?.slice(0, 300) },
        });
      } else {
        await audit({
          action: "firewall.auto_rollback",
          target: "firewall",
          source: "system",
          details: { reason: "confirm timeout", restored: false, note: "no snapshot or backend" },
        });
      }
      await clearPendingConfirm();
    } catch (e) {
      console.error("[firewall] auto-rollback failed:", e);
    }
  }, FIREWALL_CONFIRM_WINDOW_MS) as unknown as NodeJS.Timeout;
  timer.unref?.();

  return NextResponse.json({ applied: true, pendingConfirm });
});
