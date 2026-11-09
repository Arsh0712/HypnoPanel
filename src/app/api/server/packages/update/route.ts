import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import { ApiError } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import { run, binaryExists } from "@/lib/exec";
import { parseAptSim } from "../../_shared";

export const runtime = "nodejs";

function permissionDenied(stderr: string): boolean {
  return /permission denied|are you root|lock file|could not open|EACCES|EPERM/i.test(stderr);
}

/**
 * POST /api/server/packages/update — attempt the REAL apt transaction
 * ({mode: "all"} or "security"}). In a non-root session apt refuses with a
 * lock error; we report that honestly with the hypno CLI command.
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "server:write" });
  const body = (await req.json().catch(() => ({}))) as { mode?: string };
  const mode = body.mode === "security" ? "security" : body.mode === "all" ? "all" : null;
  if (!mode) throw new ApiError(400, "invalid_input", "mode must be all or security");

  if (!(await binaryExists("apt-get"))) {
    throw new ApiError(400, "unavailable", "apt-get is not present on this host — updates apply on the VPS deployment");
  }

  // Fresh simulation so the security list is accurate at apply time.
  const sim = await run("apt-get", ["-s", "-q", "upgrade"], { timeoutMs: 30_000 });
  const updates = sim.ok ? parseAptSim(sim.stdout) : [];
  if (updates.length === 0) {
    throw new ApiError(400, "nothing_to_do", "No updates are pending");
  }

  let args: string[];
  if (mode === "security") {
    const securityPkgs = updates.filter((u) => u.security).map((u) => u.pkg);
    if (securityPkgs.length === 0) {
      throw new ApiError(400, "nothing_to_do", "No security updates are pending");
    }
    args = ["-y", "-q", "install", "--only-upgrade", ...securityPkgs];
  } else {
    args = ["-y", "-q", "upgrade"];
  }

  // Real attempt — succeeds only when the panel process runs as root.
  const res = await run("apt-get", args, { timeoutMs: 120_000 });
  const denied = !res.ok && permissionDenied(res.stderr + res.stdout);

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "server.packages.update",
    target: mode,
    result: res.ok ? "success" : "failure",
    details: {
      mode,
      packages: updates.length,
      command: `apt-get ${args.join(" ")}`,
      stderr: res.stderr.slice(0, 300),
      requiresRoot: denied,
    },
  });

  if (res.ok) {
    return NextResponse.json({
      ok: true,
      message: `apt-get ${mode === "security" ? "security" : "full"} upgrade completed.`,
      output: res.stdout.split("\n").slice(-12).join("\n").trim(),
    });
  }

  if (denied) {
    return NextResponse.json({
      ok: false,
      requiresRoot: true,
      message: `Installing updates requires root — run \`${mode === "security" ? "hypno update apply --security" : "hypno update apply"}\` on the server.`,
      cliCommand: mode === "security" ? "hypno update apply --security" : "hypno update apply",
      output: res.stderr.split("\n")[0] || "",
    });
  }

  return NextResponse.json({
    ok: false,
    message: `apt-get failed: ${(res.stderr || res.stdout || "").trim().split("\n")[0] || "unknown error"}`,
  });
});
