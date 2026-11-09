import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getHostInfo } from "@/lib/sysinfo";
import { handle } from "@/lib/api-error";

export const runtime = "nodejs";

/** GET /api/system/info — real host information. */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "dashboard:read" });
  const info = await getHostInfo();
  return NextResponse.json({ host: info });
});
