import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { run } from "@/lib/exec";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";

export const runtime = "nodejs";

/**
 * POST /api/processes/renice — { pid, nice: -20..19 }
 * Runs the real `renice` binary with an argument array; the honest result
 * (including permission errors for other users' processes) is returned.
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "processes:write" });
  const ip = getClientIp(req);
  const body = (await req.json().catch(() => ({}))) as { pid?: unknown; nice?: unknown };
  const pid = Number(body.pid);
  const nice = Number(body.nice);

  if (!Number.isInteger(pid) || pid <= 0) {
    throw new ApiError(400, "invalid_pid", "pid must be a positive integer");
  }
  if (!Number.isInteger(nice) || nice < -20 || nice > 19) {
    throw new ApiError(400, "invalid_nice", "nice must be an integer between -20 and 19");
  }

  const res = await run("renice", ["-n", String(nice), "-p", String(pid)], { timeoutMs: 10_000 });
  const output = (res.stdout + (res.stderr ? `\n${res.stderr}` : "")).trim();

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "processes.renice",
    target: String(pid),
    sourceIp: ip,
    result: res.ok ? "success" : "failure",
    details: { pid, nice, exitCode: res.code, output: output.slice(0, 300) || null },
  });

  if (!res.ok) {
    // Honest error from the OS (e.g. EPERM when raising priority without privileges)
    throw new ApiError(409, "renice_failed", output || `renice exited with code ${res.code}`);
  }
  return NextResponse.json({ ok: true, pid, nice, output: output || null });
});
