import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { run } from "@/lib/exec";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";
import { detectSystemd, isCriticalUnit } from "../_systemd";

export const runtime = "nodejs";

const ACTIONS = ["start", "stop", "restart", "enable", "disable"] as const;
type Action = (typeof ACTIONS)[number];
const UNIT_RE = /^[A-Za-z0-9_.@-]+$/;

/**
 * POST /api/services/action — { unit, action, confirm? }
 * Real `systemctl <action> <unit>`; critical units require an explicit
 * confirmation flag (the UI asks the user to type the unit name).
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "services:write" });
  const ip = getClientIp(req);
  const body = (await req.json().catch(() => ({}))) as {
    unit?: string;
    action?: string;
    confirm?: boolean;
  };

  const unit = (body.unit || "").trim();
  const action = body.action as Action;

  if (!UNIT_RE.test(unit)) {
    throw new ApiError(400, "invalid_unit", "Invalid unit name");
  }
  if (!ACTIONS.includes(action)) {
    throw new ApiError(400, "invalid_action", `action must be one of: ${ACTIONS.join(", ")}`);
  }

  const systemd = await detectSystemd();
  if (!systemd) {
    throw new ApiError(
      409,
      "no_systemd",
      "systemd is not the init system in this environment (container) — service management applies to the VPS deployment"
    );
  }

  if (isCriticalUnit(unit) && body.confirm !== true) {
    throw new ApiError(
      409,
      "confirm_required",
      `"${unit}" is a critical unit — confirm the action to proceed`
    );
  }

  const res = await run("systemctl", [action, unit], { timeoutMs: 30_000 });
  const output = (res.stdout + (res.stderr ? `\n${res.stderr}` : "")).trim();

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "services.action",
    target: unit,
    sourceIp: ip,
    result: res.ok ? "success" : "failure",
    details: { unit, action, exitCode: res.code, output: output.slice(0, 300) || null },
  });

  if (!res.ok) {
    throw new ApiError(500, "systemctl_failed", output || `systemctl ${action} ${unit} exited with code ${res.code}`);
  }
  return NextResponse.json({ ok: true, unit, action, output: output || null });
});
