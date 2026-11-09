import { NextRequest, NextResponse } from "next/server";
import { CronExpressionParser } from "cron-parser";
import { guard } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";

export const runtime = "nodejs";

/** Human summary for common cron patterns (spec §5.9). */
function humanSchedule(schedule: string): string {
  const t = schedule.trim().replace(/\s+/g, " ");
  switch (t) {
    case "* * * * *":
      return "Every minute";
    case "0 * * * *":
      return "Hourly";
    case "0 0 * * *":
      return "Daily at 00:00";
    case "0 0 * * 0":
      return "Weekly on Sunday";
    case "0 0 1 * *":
      return "Monthly on the 1st";
    default:
      return "Custom";
  }
}

/** Validate a 5-field cron schedule; returns null when valid. */
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

/** GET /api/cron/preview?schedule=… — next 3 runs + human summary. */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "cron:read" });
  const schedule = new URL(req.url).searchParams.get("schedule") || "";
  const error = validateScheduleError(schedule);
  if (error) throw new ApiError(400, "invalid_schedule", error);

  const iter = CronExpressionParser.parse(schedule.trim());
  const next = [iter.next().toISOString(), iter.next().toISOString(), iter.next().toISOString()];
  return NextResponse.json({ next, human: humanSchedule(schedule) });
});
