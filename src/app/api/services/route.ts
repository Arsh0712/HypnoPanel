import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { run } from "@/lib/exec";
import { ApiError, handle } from "@/lib/api-error";
import { detectSystemd, parseListUnits, findPanelProcesses } from "./_systemd";

export const runtime = "nodejs";

/**
 * GET /api/services — systemd service list (VPS) or, honestly, a
 * "not available" state with panel-related processes (container preview).
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "services:read" });

  const systemd = await detectSystemd();
  if (!systemd) {
    const processMap = await findPanelProcesses();
    return NextResponse.json({
      systemd: false,
      note: "systemd is not the init system in this environment (container) — service management applies to the VPS deployment. Detected panel-related processes are shown below.",
      units: [],
      processMap,
    });
  }

  const res = await run(
    "systemctl",
    ["list-units", "--type=service", "--no-legend", "--no-pager", "--all"],
    { timeoutMs: 15_000, maxBuffer: 4 * 1024 * 1024 }
  );
  if (!res.ok) {
    throw new ApiError(
      500,
      "systemctl_failed",
      `systemctl list-units failed: ${res.stderr.trim().slice(0, 300) || `exit ${res.code}`}`
    );
  }
  const units = parseListUnits(res.stdout);
  return NextResponse.json({
    systemd: true,
    note: null,
    units,
    processMap: [],
  });
});
