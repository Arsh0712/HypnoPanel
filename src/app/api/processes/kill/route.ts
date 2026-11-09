import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";

export const runtime = "nodejs";

/**
 * POST /api/processes/kill — { pid, signal?: 'SIGTERM'|'SIGKILL' }
 * Real signal via process.kill(); honest EPERM/ESRCH reporting (processes:write).
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "processes:write" });
  const ip = getClientIp(req);
  const body = (await req.json().catch(() => ({}))) as { pid?: unknown; signal?: string };
  const pid = Number(body.pid);
  const signal = body.signal === "SIGKILL" ? "SIGKILL" : "SIGTERM";

  if (!Number.isInteger(pid) || pid <= 0) {
    throw new ApiError(400, "invalid_pid", "pid must be a positive integer");
  }
  if (pid === 1) {
    throw new ApiError(403, "refused", "Refusing to kill PID 1");
  }
  if (pid === process.pid) {
    throw new ApiError(403, "refused", "Refusing to kill the panel's own process");
  }

  try {
    process.kill(pid, signal);
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "processes.kill",
      target: String(pid),
      sourceIp: ip,
      result: "success",
      details: { pid, signal },
    });
    return NextResponse.json({ ok: true, pid, signal });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "processes.kill",
      target: String(pid),
      sourceIp: ip,
      result: "failure",
      details: { pid, signal, error: e.message },
    });
    if (e.code === "ESRCH") {
      throw new ApiError(404, "no_such_process", `No such process: ${pid} (it may have already exited)`);
    }
    if (e.code === "EPERM") {
      throw new ApiError(403, "permission", `Operation not permitted for PID ${pid}: ${e.message}`);
    }
    throw new ApiError(500, "kill_failed", `Could not send ${signal} to PID ${pid}: ${e.message}`);
  }
});
