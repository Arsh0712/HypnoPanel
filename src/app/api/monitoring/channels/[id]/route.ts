import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";
import { parseRuleChannelIds } from "../../_lib";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * DELETE /api/monitoring/channels/[id] — deletes the channel and strips its
 * id from every rule that referenced it.
 */
export const DELETE = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "monitoring:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;

  const channel = await db.notificationChannel.findUnique({ where: { id } });
  if (!channel) throw new ApiError(404, "not_found", "Channel not found");

  // Detach from rules first so no rule keeps a dangling reference.
  const rules = await db.monitorRule.findMany({
    where: { channelIds: { not: null } },
  });
  for (const rule of rules) {
    const ids = parseRuleChannelIds(rule.channelIds);
    if (ids.includes(id)) {
      const remaining = ids.filter((c) => c !== id);
      await db.monitorRule.update({
        where: { id: rule.id },
        data: { channelIds: remaining.length ? JSON.stringify(remaining) : null },
      });
    }
  }

  await db.notificationChannel.delete({ where: { id } });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "monitor.channel.delete",
    target: channel.name,
    sourceIp: ip,
    details: { type: channel.type },
  });

  return NextResponse.json({ ok: true });
});
