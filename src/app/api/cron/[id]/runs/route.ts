import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/cron/[id]/runs?limit=20 — run history (newest first). */
export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  await guard(req, { permission: "cron:read" });
  const { id } = await ctx.params;
  const job = await db.cronJob.findUnique({ where: { id } });
  if (!job) throw new ApiError(404, "not_found", "Cron job not found");

  const limitRaw = Number(new URL(req.url).searchParams.get("limit") || 20);
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 100 ? limitRaw : 20;

  const runs = await db.cronRun.findMany({
    where: { jobId: id },
    orderBy: { startedAt: "desc" },
    take: limit,
  });
  return NextResponse.json({ runs });
});
