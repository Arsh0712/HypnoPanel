import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";

export const runtime = "nodejs";

const STATES = ["firing", "resolved", "silenced"] as const;

/**
 * GET /api/monitoring/alerts?state=firing|resolved|silenced|all
 * Default: all. Newest first, capped at 200.
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "monitoring:read" });
  const state = req.nextUrl.searchParams.get("state") || "all";
  if (state !== "all" && !(STATES as readonly string[]).includes(state)) {
    throw new ApiError(400, "invalid_state", "state must be firing, resolved, silenced or all");
  }
  const alerts = await db.alert.findMany({
    where: state === "all" ? {} : { state },
    orderBy: { startedAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ alerts });
});
