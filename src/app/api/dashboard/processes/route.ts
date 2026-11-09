import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getTopProcesses } from "@/lib/sysinfo";
import { handle } from "@/lib/api-error";

export const runtime = "nodejs";

/** GET /api/dashboard/processes — top processes by CPU. */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "processes:read" });
  const limit = Math.min(50, Math.max(5, Number(new URL(req.url).searchParams.get("limit") || 20)));
  const processes = await getTopProcesses(limit);
  return NextResponse.json({ processes });
});
