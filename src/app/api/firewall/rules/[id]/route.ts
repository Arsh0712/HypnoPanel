import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import { validateRuleInput } from "@/lib/firewall";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/firewall/rules/[id] — edit a rule (full payload, same validation as create). */
export const PUT = handle(async (req: NextRequest, ctx: Ctx) => {
  const auth = await guard(req, { permission: "firewall:write" });
  const { id } = await ctx.params;
  const existing = await db.firewallRule.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "not_found", "Firewall rule not found");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = validateRuleInput(body);
  if (!parsed.ok) throw new ApiError(400, "invalid_rule", parsed.error);

  const rule = await db.firewallRule.update({ where: { id }, data: parsed.value });
  await audit({
    actorId: auth.userId,
    actorEmail: auth.email,
    action: "firewall.rule.update",
    target: rule.id,
    sourceIp: getClientIp(req),
    details: {
      action: rule.action,
      protocol: rule.protocol,
      ports: `${rule.portStart}-${rule.portEnd}`,
      source: rule.source,
    },
  });
  return NextResponse.json({ rule });
});

/** PATCH /api/firewall/rules/[id] — toggle { enabled }. */
export const PATCH = handle(async (req: NextRequest, ctx: Ctx) => {
  const auth = await guard(req, { permission: "firewall:write" });
  const { id } = await ctx.params;
  const existing = await db.firewallRule.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "not_found", "Firewall rule not found");

  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    throw new ApiError(400, "invalid_input", "enabled must be a boolean");
  }

  const rule = await db.firewallRule.update({ where: { id }, data: { enabled: body.enabled } });
  await audit({
    actorId: auth.userId,
    actorEmail: auth.email,
    action: "firewall.rule.toggle",
    target: rule.id,
    sourceIp: getClientIp(req),
    details: { enabled: rule.enabled },
  });
  return NextResponse.json({ rule });
});

/** DELETE /api/firewall/rules/[id] — remove a rule. */
export const DELETE = handle(async (req: NextRequest, ctx: Ctx) => {
  const auth = await guard(req, { permission: "firewall:write" });
  const { id } = await ctx.params;
  const existing = await db.firewallRule.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "not_found", "Firewall rule not found");

  await db.firewallRule.delete({ where: { id } });
  await audit({
    actorId: auth.userId,
    actorEmail: auth.email,
    action: "firewall.rule.delete",
    target: id,
    sourceIp: getClientIp(req),
    details: {
      action: existing.action,
      ports: `${existing.portStart}-${existing.portEnd}`,
      source: existing.source,
    },
  });
  return NextResponse.json({ ok: true });
});
