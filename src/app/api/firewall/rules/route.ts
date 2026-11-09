import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import { validateRuleInput } from "@/lib/firewall";

export const runtime = "nodejs";

/** GET /api/firewall/rules — list all rules (creation order). */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "firewall:read" });
  const rules = await db.firewallRule.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json({ rules });
});

/** POST /api/firewall/rules — create a rule { action, protocol, portStart, portEnd, source, note }. */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "firewall:write" });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = validateRuleInput(body);
  if (!parsed.ok) throw new ApiError(400, "invalid_rule", parsed.error);

  const rule = await db.firewallRule.create({ data: parsed.value });
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "firewall.rule.create",
    target: rule.id,
    sourceIp: getClientIp(req),
    details: {
      action: rule.action,
      protocol: rule.protocol,
      ports: `${rule.portStart}-${rule.portEnd}`,
      source: rule.source,
    },
  });
  return NextResponse.json({ rule }, { status: 201 });
});
