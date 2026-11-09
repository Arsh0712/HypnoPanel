import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import { getMetricsEngine } from "@/lib/metrics";
import { getSettingJson, getPhpTuning } from "../_shared";

export const runtime = "nodejs";

/**
 * GET /api/performance/overview — live metrics + 30-minute ring + the panel's
 * persisted tuning preferences (for diff previews and "applied" chips).
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "performance:read" });
  const engine = getMetricsEngine();
  if (engine.ring.length === 0) engine.sample();
  const since = Date.now() - 30 * 60_000;
  const ring = engine.ring.filter((s) => s.ts >= since);
  const [php, net, http] = await Promise.all([
    getPhpTuning(),
    getSettingJson<{ congestionControl: string }>("perf.net"),
    getSettingJson<{ brotli: boolean; staticCache: boolean }>("perf.http"),
  ]);
  return NextResponse.json({
    metrics: engine.latest(),
    ring: ring.length ? ring : engine.ring.slice(-12),
    applied: { php, net, http },
  });
});
