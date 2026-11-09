import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import { ApiError } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import { setSetting } from "@/lib/settings";
import { run } from "@/lib/exec";
import { setSettingJson, getSettingJson, deleteSetting } from "../_shared";

export const runtime = "nodejs";

const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function permissionDenied(stderr: string): boolean {
  return /permission denied|operation not permitted|read-only|not booted with systemd|are you root|must be root|EACCES|EPERM/i.test(
    stderr
  );
}

interface ActionBody {
  action?: string;
  hostname?: string;
  timezone?: string;
  at?: string;
}

/**
 * POST /api/server/actions — hostname change, timezone change (both attempt
 * the REAL command and honestly report EPERM with the hypno CLI fallback),
 * scheduled reboot (stored + audited; the on-server agent performs it).
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "server:write" });
  const body = (await req.json().catch(() => ({}))) as ActionBody;

  /* ————— hostname ————— */
  if (body.action === "hostname") {
    const hostname = body.hostname;
    if (
      typeof hostname !== "string" ||
      hostname.length === 0 ||
      hostname.length > 253 ||
      !HOSTNAME_RE.test(hostname)
    ) {
      throw new ApiError(400, "invalid_input", "Not a valid RFC 1123 hostname");
    }
    const res = await run("hostname", [hostname], { timeoutMs: 5000 });
    if (res.ok) {
      await setSetting("server.hostname", hostname);
      await audit({
        actorId: ctx.userId,
        actorEmail: ctx.email,
        action: "server.hostname.set",
        target: hostname,
        details: { via: "hostname command" },
      });
      return NextResponse.json({ ok: true, message: `Hostname set to ${hostname}.` });
    }
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "server.hostname.set",
      target: hostname,
      result: "failure",
      details: { stderr: res.stderr.slice(0, 300), requiresRoot: true },
    });
    return NextResponse.json({
      ok: false,
      requiresRoot: permissionDenied(res.stderr),
      message: `Setting the hostname requires root — run \`hypno config set server.hostname ${hostname}\` on the server.`,
      cliCommand: `hypno config set server.hostname ${hostname}`,
    });
  }

  /* ————— timezone ————— */
  if (body.action === "timezone") {
    const tz = body.timezone;
    if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) {
      throw new ApiError(400, "invalid_input", "timezone must be an IANA identifier");
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch {
      throw new ApiError(400, "invalid_input", "Unknown IANA timezone");
    }
    const res = await run("timedatectl", ["set-timezone", tz], { timeoutMs: 8000 });
    if (res.ok) {
      await setSetting("server.timezone", tz);
      await audit({
        actorId: ctx.userId,
        actorEmail: ctx.email,
        action: "server.timezone.set",
        target: tz,
        details: { via: "timedatectl" },
      });
      return NextResponse.json({ ok: true, message: `System timezone set to ${tz}.` });
    }
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "server.timezone.set",
      target: tz,
      result: "failure",
      details: { stderr: res.stderr.slice(0, 300), requiresRoot: true },
    });
    return NextResponse.json({
      ok: false,
      requiresRoot: true,
      message: `Changing the system timezone requires root (or systemd) — run \`hypno config set server.timezone ${tz}\` on the server.`,
      cliCommand: `hypno config set server.timezone ${tz}`,
    });
  }

  /* ————— scheduled reboot ————— */
  if (body.action === "reboot_schedule") {
    const at = body.at;
    const when = typeof at === "string" ? new Date(at) : null;
    if (!when || Number.isNaN(when.getTime())) {
      throw new ApiError(400, "invalid_input", "at must be a valid ISO datetime");
    }
    if (when.getTime() <= Date.now()) {
      throw new ApiError(400, "invalid_input", "Scheduled time must be in the future");
    }
    if (when.getTime() > Date.now() + 30 * 24 * 3600_000) {
      throw new ApiError(400, "invalid_input", "Scheduled time must be within 30 days");
    }
    const iso = when.toISOString();
    await setSettingJson("server.reboot.at", iso);
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "server.reboot.schedule",
      target: iso,
      details: { at: iso },
    });
    return NextResponse.json({
      ok: true,
      message: "Reboot scheduled — the on-server hipno agent performs the reboot at the scheduled time.",
      scheduledAt: iso,
    });
  }

  if (body.action === "reboot_cancel") {
    const existing = await getSettingJson<string>("server.reboot.at");
    await deleteSetting("server.reboot.at");
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "server.reboot.cancel",
      target: existing,
    });
    return NextResponse.json({ ok: true, message: "Scheduled reboot cancelled." });
  }

  throw new ApiError(400, "invalid_input", "action must be hostname, timezone, reboot_schedule or reboot_cancel");
});
