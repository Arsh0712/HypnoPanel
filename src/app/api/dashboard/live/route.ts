import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getMetricsEngine } from "@/lib/metrics";
import { getHostInfo, getServiceHealth, getTopProcesses } from "@/lib/sysinfo";
import { getTunnelStatus } from "@/lib/tunnel-client";
import { db } from "@/lib/db";
import { handle } from "@/lib/api-error";
import { PANEL_VERSION } from "@/lib/constants";

export const runtime = "nodejs";

/**
 * GET /api/dashboard/live — live snapshot: metrics, host, service health,
 * tunnel status, top processes, recent audit, disk mounts, uptime.
 */
export const GET = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "dashboard:read" });
  const engine = getMetricsEngine();
  if (engine.ring.length === 0) engine.sample();
  const snap = engine.latest();
  const [host, services, processes, recentAudit, tunnel] = await Promise.all([
    getHostInfo(),
    getServiceHealth(),
    getTopProcesses(12),
    db.auditEntry.findMany({
      orderBy: { ts: "desc" },
      take: 8,
      select: { ts: true, actorEmail: true, action: true, target: true, result: true },
    }),
    Promise.resolve(getTunnelStatus()),
  ]);
  return NextResponse.json({
    metrics: snap,
    ring: engine.ring.slice(-90), // last ~15 min of live samples
    host,
    services,
    processes,
    tunnel,
    recentAudit,
    viewer: { role: ctx.role, email: ctx.email },
    panelVersion: PANEL_VERSION,
  });
});
