import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import { getSetting } from "@/lib/settings";
import { PANEL_PORT } from "@/lib/constants";
import { generateRuleset, getPendingConfirm, findNftBinary } from "@/lib/firewall";

export const runtime = "nodejs";

/** GET /api/firewall/status — backend availability, generated ruleset, pending confirm window. */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "firewall:read" });
  const [rules, nftBinary, pendingConfirm, sshPort] = await Promise.all([
    db.firewallRule.findMany({ orderBy: { createdAt: "asc" } }),
    findNftBinary(),
    getPendingConfirm(),
    getSetting("network.sshPort", 22),
  ]);
  return NextResponse.json({
    nftAvailable: !!nftBinary,
    ruleset: generateRuleset(rules),
    pendingConfirm,
    sshPort,
    panelPort: PANEL_PORT,
  });
});
