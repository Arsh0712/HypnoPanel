import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import { run, binaryExists } from "@/lib/exec";
import { parseAptSim } from "../_shared";

export const runtime = "nodejs";

/**
 * GET /api/server/packages — real apt state: simulated upgrade list, held
 * packages and reboot-required banner. If apt-get is absent the response is
 * an honest unavailable object, never fake data.
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "server:read" });

  if (!(await binaryExists("apt-get"))) {
    return NextResponse.json({
      available: false,
      manager: "none",
      updates: [],
      securityCount: 0,
      held: [],
      rebootRequired: false,
      note: "No apt-get on this host — package management applies to the VPS deployment (Debian/Ubuntu).",
    });
  }

  const sim = await run("apt-get", ["-s", "-q", "upgrade"], { timeoutMs: 30_000 });
  const updates = sim.ok ? parseAptSim(sim.stdout) : [];
  const hold = await run("apt-mark", ["showhold"], { timeoutMs: 10_000 });
  const held = hold.ok
    ? hold.stdout.split("\n").map((l) => l.trim()).filter(Boolean)
    : [];

  return NextResponse.json({
    available: true,
    manager: "apt",
    updates,
    securityCount: updates.filter((u) => u.security).length,
    held,
    rebootRequired: fs.existsSync("/var/run/reboot-required"),
    note: sim.ok ? undefined : "apt-get simulation failed — the list below may be incomplete.",
  });
});
