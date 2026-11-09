import { NextRequest, NextResponse } from "next/server";
import { CronExpressionParser } from "cron-parser";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

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

/** PUT /api/cron/[id] — edit a job (full payload). */
export const PUT = handle(async (req: NextRequest, ctx: Ctx) => {
  const auth = await guard(req, { permission: "cron:write" });
  const { id } = await ctx.params;
  const existing = await db.cronJob.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "not_found", "Cron job not found");

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

  const enabled = body.enabled === undefined ? existing.enabled : !!body.enabled;

  const job = await db.cronJob.update({
    where: { id },
    data: { name, schedule, command, enabled },
  });

  await audit({
    actorId: auth.userId,
    actorEmail: auth.email,
    action: "cron.job.update",
    target: job.id,
    sourceIp: getClientIp(req),
    details: { name: job.name, schedule: job.schedule, enabled: job.enabled },
  });

  let nextRuns: string[] = [];
  try {
    const iter = CronExpressionParser.parse(job.schedule);
    nextRuns = [iter.next(), iter.next(), iter.next()].map((d) => d.toDate().toISOString());
  } catch {
    nextRuns = [];
  }
  return NextResponse.json({ job, nextRuns });
});

/** PATCH /api/cron/[id] — toggle { enabled }. */
export const PATCH = handle(async (req: NextRequest, ctx: Ctx) => {
  const auth = await guard(req, { permission: "cron:write" });
  const { id } = await ctx.params;
  const existing = await db.cronJob.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "not_found", "Cron job not found");

  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    throw new ApiError(400, "invalid_input", "enabled must be a boolean");
  }

  const job = await db.cronJob.update({ where: { id }, data: { enabled: body.enabled } });
  await audit({
    actorId: auth.userId,
    actorEmail: auth.email,
    action: "cron.job.toggle",
    target: job.id,
    sourceIp: getClientIp(req),
    details: { enabled: job.enabled },
  });
  return NextResponse.json({ job });
});

/** DELETE /api/cron/[id] — remove a job (runs cascade). */
export const DELETE = handle(async (req: NextRequest, ctx: Ctx) => {
  const auth = await guard(req, { permission: "cron:write" });
  const { id } = await ctx.params;
  const existing = await db.cronJob.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "not_found", "Cron job not found");

  await db.cronJob.delete({ where: { id } });
  await audit({
    actorId: auth.userId,
    actorEmail: auth.email,
    action: "cron.job.delete",
    target: id,
    sourceIp: getClientIp(req),
    details: { name: existing.name, schedule: existing.schedule },
  });
  return NextResponse.json({ ok: true });
});
