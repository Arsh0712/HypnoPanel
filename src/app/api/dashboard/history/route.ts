import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getMetricsEngine } from "@/lib/metrics";
import { handle } from "@/lib/api-error";

export const runtime = "nodejs";

/** GET /api/dashboard/history?hours=24 — downsampled metric history. */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "dashboard:read" });
  const hours = Math.min(
    24,
    Math.max(1, Number(new URL(req.url).searchParams.get("hours") || 24))
  );
  const history = await getMetricsEngine().history(hours);
  return NextResponse.json({ history, hours });
});
