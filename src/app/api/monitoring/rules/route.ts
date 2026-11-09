import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";
import { parseRuleChannelIds, validateRuleInput } from "../_lib";

export const runtime = "nodejs";

/** GET /api/monitoring/rules — all rules (channelIds parsed to an array). */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "monitoring:read" });
  const rules = await db.monitorRule.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({
    rules: rules.map((r) => ({
      id: r.id,
      name: r.name,
      metric: r.metric,
      operator: r.operator,
      threshold: r.threshold,
      durationMin: r.durationMin,
      severity: r.severity,
      channelIds: parseRuleChannelIds(r.channelIds),
      enabled: r.enabled,
    })),
  });
});

/**
 * POST /api/monitoring/rules — create a threshold rule.
 * { name, metric, operator, threshold, durationMin, severity, channelIds }
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "monitoring:write" });
  const ip = getClientIp(req);
  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const input = validateRuleInput(raw);

  // Channel ids must reference existing channels.
  if (input.channelIds.length) {
    const found = await db.notificationChannel.findMany({
      where: { id: { in: input.channelIds } },
      select: { id: true },
    });
    if (found.length !== input.channelIds.length) {
      throw new ApiError(400, "invalid_channels", "One or more channels do not exist");
    }
  }

  const rule = await db.monitorRule.create({
    data: {
      name: input.name,
      metric: input.metric,
      operator: input.operator,
      threshold: input.threshold,
      durationMin: input.durationMin,
      severity: input.severity,
      channelIds: input.channelIds.length ? JSON.stringify(input.channelIds) : null,
      enabled: raw.enabled === false ? false : true,
    },
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "monitor.rule.create",
    target: input.name,
    sourceIp: ip,
    details: {
      metric: input.metric,
      operator: input.operator,
      threshold: input.threshold,
      durationMin: input.durationMin,
      severity: input.severity,
      channelCount: input.channelIds.length,
    },
  });

  return NextResponse.json(
    {
      rule: {
        id: rule.id,
        name: rule.name,
        metric: rule.metric,
        operator: rule.operator,
        threshold: rule.threshold,
        durationMin: rule.durationMin,
        severity: rule.severity,
        channelIds: input.channelIds,
        enabled: rule.enabled,
      },
    },
    { status: 201 }
  );
});
