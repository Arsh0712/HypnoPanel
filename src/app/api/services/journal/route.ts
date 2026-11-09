import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { run } from "@/lib/exec";
import { ApiError, handle } from "@/lib/api-error";
import { detectSystemd } from "../_systemd";

export const runtime = "nodejs";

const UNIT_RE = /^[A-Za-z0-9_.@-]+$/;

/**
 * GET /api/services/journal?unit=&lines=200 — real `journalctl -u <unit>`
 * (systemd environments only; validated unit name, capped line count).
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "services:read" });

  const url = new URL(req.url);
  const unit = (url.searchParams.get("unit") || "").trim();
  let lines = Number(url.searchParams.get("lines") || 200);
  if (!Number.isInteger(lines) || lines < 1) lines = 200;
  if (lines > 1000) lines = 1000;

  if (!UNIT_RE.test(unit)) {
    throw new ApiError(400, "invalid_unit", "Invalid unit name");
  }

  const systemd = await detectSystemd();
  if (!systemd) {
    throw new ApiError(
      409,
      "no_systemd",
      "systemd is not the init system in this environment (container) — the journal applies to the VPS deployment"
    );
  }

  const res = await run("journalctl", ["-u", unit, "-n", String(lines), "--no-pager"], {
    timeoutMs: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (!res.ok) {
    throw new ApiError(
      500,
      "journalctl_failed",
      `journalctl failed: ${(res.stderr || res.stdout).trim().slice(0, 300) || `exit ${res.code}`}`
    );
  }
  return NextResponse.json({ unit, lines, output: res.stdout || "" });
});
