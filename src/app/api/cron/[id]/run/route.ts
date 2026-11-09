import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import { executeCronJob } from "@/lib/background";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/cron/[id]/run — trigger an immediate manual run. The executor is
 * fire-and-forget (executeCronJob records the run and captures output); this
 * endpoint returns { started: true } right away and the run shows up in the
 * job's history.
 */
export const POST = handle(async (req: NextRequest, ctx: Ctx) => {
  const auth = await guard(req, { permission: "cron:write" });
  const { id } = await ctx.params;
  const job = await db.cronJob.findUnique({ where: { id } });
  if (!job) throw new ApiError(404, "not_found", "Cron job not found");

  void executeCronJob(job.id, job.command, "manual").catch((e) =>
    console.error("[cron] manual run failed:", e)
  );

  await audit({
    actorId: auth.userId,
    actorEmail: auth.email,
    action: "cron.run",
    target: job.id,
    sourceIp: getClientIp(req),
    details: { name: job.name, trigger: "manual" },
  });

  return NextResponse.json({ started: true });
});
