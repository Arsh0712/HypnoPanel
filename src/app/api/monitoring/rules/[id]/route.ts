import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";
import { parseRuleChannelIds, validateRuleInput } from "../../_lib";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

async function getRuleOr404(id: string) {
  const rule = await db.monitorRule.findUnique({ where: { id } });
  if (!rule) throw new ApiError(404, "not_found", "Rule not found");
  return rule;
}

/** PUT /api/monitoring/rules/[id] — full update of a rule. */
export const PUT = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "monitoring:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;
  const rule = await getRuleOr404(id);

  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const input = validateRuleInput(raw);

  if (input.channelIds.length) {
    const found = await db.notificationChannel.findMany({
      where: { id: { in: input.channelIds } },
      select: { id: true },
    });
    if (found.length !== input.channelIds.length) {
      throw new ApiError(400, "invalid_channels", "One or more channels do not exist");
    }
  }

  const updated = await db.monitorRule.update({
    where: { id },
    data: {
      name: input.name,
      metric: input.metric,
      operator: input.operator,
      threshold: input.threshold,
      durationMin: input.durationMin,
      severity: input.severity,
      channelIds: input.channelIds.length ? JSON.stringify(input.channelIds) : null,
    },
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "monitor.rule.update",
    target: updated.name,
    sourceIp: ip,
    details: {
      before: { metric: rule.metric, operator: rule.operator, threshold: rule.threshold },
      after: {
        metric: input.metric,
        operator: input.operator,
        threshold: input.threshold,
        durationMin: input.durationMin,
        severity: input.severity,
      },
    },
  });

  return NextResponse.json({
    rule: {
      id: updated.id,
      name: updated.name,
      metric: updated.metric,
      operator: updated.operator,
      threshold: updated.threshold,
      durationMin: updated.durationMin,
      severity: updated.severity,
      channelIds: input.channelIds,
      enabled: updated.enabled,
    },
  });
});

/** PATCH /api/monitoring/rules/[id] — toggle enabled. */
export const PATCH = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "monitoring:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;
  const rule = await getRuleOr404(id);

  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    throw new ApiError(400, "invalid_input", "enabled must be a boolean");
  }

  const updated = await db.monitorRule.update({
    where: { id },
    data: { enabled: body.enabled },
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "monitor.rule.toggle",
    target: updated.name,
    sourceIp: ip,
    details: { enabled: body.enabled },
  });

  return NextResponse.json({
    rule: {
      id: updated.id,
      name: updated.name,
      metric: updated.metric,
      operator: updated.operator,
      threshold: updated.threshold,
      durationMin: updated.durationMin,
      severity: updated.severity,
      channelIds: parseRuleChannelIds(updated.channelIds),
      enabled: updated.enabled,
    },
  });
});

/** DELETE /api/monitoring/rules/[id] — delete a rule. */
export const DELETE = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "monitoring:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;
  const rule = await getRuleOr404(id);

  await db.monitorRule.delete({ where: { id } });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "monitor.rule.delete",
    target: rule.name,
    sourceIp: ip,
    details: { metric: rule.metric, threshold: rule.threshold },
  });

  return NextResponse.json({ ok: true });
});
