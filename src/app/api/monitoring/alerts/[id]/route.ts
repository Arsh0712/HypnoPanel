import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const ACTIONS = ["silence", "unsilence", "resolve"] as const;
type AlertAction = (typeof ACTIONS)[number];

/**
 * PATCH /api/monitoring/alerts/[id] — { action: silence|unsilence|resolve }.
 * State machine: firing ⇄ silenced, firing|silenced → resolved.
 */
export const PATCH = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "monitoring:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;

  const alert = await db.alert.findUnique({ where: { id } });
  if (!alert) throw new ApiError(404, "not_found", "Alert not found");

  const body = (await req.json().catch(() => ({}))) as { action?: unknown };
  const action = body.action as AlertAction;
  if (!ACTIONS.includes(action)) {
    throw new ApiError(400, "invalid_action", "action must be silence, unsilence or resolve");
  }

  let nextState: string;
  switch (action) {
    case "silence":
      if (alert.state !== "firing") {
        throw new ApiError(409, "invalid_transition", "Only firing alerts can be silenced");
      }
      nextState = "silenced";
      break;
    case "unsilence":
      if (alert.state !== "silenced") {
        throw new ApiError(409, "invalid_transition", "Only silenced alerts can be unsilenced");
      }
      nextState = "firing";
      break;
    case "resolve":
      if (alert.state === "resolved") {
        throw new ApiError(409, "invalid_transition", "Alert is already resolved");
      }
      nextState = "resolved";
      break;
  }

  const updated = await db.alert.update({
    where: { id },
    data: { state: nextState, resolvedAt: nextState === "resolved" ? new Date() : null },
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: `monitor.alert.${action}`,
    target: alert.ruleName,
    sourceIp: ip,
    details: { alertId: id, from: alert.state, to: nextState },
  });

  return NextResponse.json({ alert: updated });
});
