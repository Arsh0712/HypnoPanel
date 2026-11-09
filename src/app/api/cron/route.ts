import { NextRequest, NextResponse } from "next/server";
import { CronExpressionParser } from "cron-parser";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

/** Validate a 5-field cron schedule (spec §5.9); returns null when valid. */
function validateScheduleError(schedule: string): string | null {
  const s = schedule.trim();
  if (!s) return "Schedule is required";
  if (s.startsWith("@")) {
    return "Named schedules (@daily, @hourly, …) are not supported — use a 5-field cron expression";
  }
  if (s.split(/\s+/).length !== 5) {
    return "Schedule must be exactly 5 fields (minute hour day-of-month month day-of-week)";
  }
  try {
    CronExpressionParser.parse(s);
    return null;
  } catch (e) {
    return `Invalid cron expression: ${(e as Error).message}`;
  }
}

/** Next N run dates (ISO) for a valid 5-field schedule. */
function nextRuns(schedule: string, count = 3): string[] {
  const iter = CronExpressionParser.parse(schedule.trim());
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(iter.next().toDate().toISOString());
  }
  return out;
}

/** GET /api/cron — all jobs with their last 3 runs. */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "cron:read" });
  const jobs = await db.cronJob.findMany({
    orderBy: { createdAt: "asc" },
    include: { runs: { orderBy: { startedAt: "desc" }, take: 3 } },
  });
  return NextResponse.json({ jobs });
});

/** POST /api/cron — create a job { name, schedule, command, enabled }. */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "cron:write" });
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    schedule?: string;
    command?: string;
    enabled?: boolean;
  };

  const name = (body.name || "").trim();
  if (!name) throw new ApiError(400, "invalid_input", "Name is required");
  if (name.length > 100) throw new ApiError(400, "invalid_input", "Name must be at most 100 characters");

  const schedule = (body.schedule || "").trim();
  const scheduleError = validateScheduleError(schedule);
  if (scheduleError) throw new ApiError(400, "invalid_schedule", scheduleError);

  const command = (body.command || "").trim();
  if (!command) throw new ApiError(400, "invalid_input", "Command is required");
  if (command.length > 500) throw new ApiError(400, "invalid_input", "Command must be at most 500 characters");

  const job = await db.cronJob.create({
    data: {
      name,
      schedule,
      command,
      enabled: body.enabled === undefined ? true : !!body.enabled,
    },
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "cron.job.create",
    target: job.id,
    sourceIp: getClientIp(req),
    details: { name: job.name, schedule: job.schedule },
  });

  return NextResponse.json({ job, nextRuns: nextRuns(job.schedule) }, { status: 201 });
});
