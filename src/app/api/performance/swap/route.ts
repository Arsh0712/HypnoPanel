import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import { ApiError } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import { run } from "@/lib/exec";
import { readSwapStatus } from "../_shared";

export const runtime = "nodejs";

interface SwapBody {
  action?: string;
  sizeGB?: number;
}

const SWAP_FILE = "/swapfile";
const VALID_SIZES = [1, 2, 4];

function permissionDenied(stderr: string): boolean {
  return /permission denied|operation not permitted|read-only|are you root|EACCES|EPERM/i.test(stderr);
}

/**
 * GET  /api/performance/swap — real swap state (/proc/meminfo + /proc/swaps).
 * POST /api/performance/swap — attempt a REAL swap create/off. Non-root
 * sessions get an honest "requires root" answer with the hypno CLI command.
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "performance:read" });
  return NextResponse.json(await readSwapStatus());
});

export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "performance:write" });
  const body = (await req.json().catch(() => ({}))) as SwapBody;
  const action = body.action;

  if (action === "create") {
    const size = body.sizeGB;
    if (!VALID_SIZES.includes(Number(size))) {
      throw new ApiError(400, "invalid_input", "sizeGB must be 1, 2 or 4");
    }
    const gb = Number(size);
    const steps: { step: string; ok: boolean; detail: string }[] = [];
    // Real privileged sequence — each step runs and is reported honestly.
    const seq: { label: string; cmd: string; args: string[] }[] = [
      { label: "fallocate", cmd: "fallocate", args: ["-l", `${gb}G`, SWAP_FILE] },
      { label: "chmod 600", cmd: "chmod", args: ["600", SWAP_FILE] },
      { label: "mkswap", cmd: "mkswap", args: [SWAP_FILE] },
      { label: "swapon", cmd: "swapon", args: [SWAP_FILE] },
    ];
    for (const s of seq) {
      const res = await run(s.cmd, s.args, { timeoutMs: 20_000 });
      steps.push({ step: s.label, ok: res.ok, detail: (res.stderr || res.stdout).trim().split("\n")[0] });
      if (!res.ok) {
        const denied = permissionDenied(res.stderr);
        await audit({
          actorId: ctx.userId,
          actorEmail: ctx.email,
          action: "performance.swap.create",
          target: SWAP_FILE,
          result: "failure",
          details: { sizeGB: gb, failedStep: s.label, stderr: res.stderr.slice(0, 300) },
        });
        return NextResponse.json({
          ok: false,
          requiresRoot: denied,
          message: denied
            ? `Swap creation requires root — run \`hypno swap create ${gb}G\` on the server.`
            : `Step ${s.label} failed: ${steps[steps.length - 1].detail || "unknown error"}`,
          cliCommand: denied ? `hypno swap create ${gb}G` : undefined,
          steps,
        });
      }
    }
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "performance.swap.create",
      target: SWAP_FILE,
      details: { sizeGB: gb, steps: steps.map((s) => s.step) },
    });
    return NextResponse.json({
      ok: true,
      message: `${gb} GB swap file ${SWAP_FILE} activated.`,
      steps,
    });
  }

  if (action === "off") {
    const status = await readSwapStatus();
    if (status.devices.length === 0) {
      throw new ApiError(400, "no_swap", "No swap devices are currently active");
    }
    const res = await run("swapoff", ["-a"], { timeoutMs: 30_000 });
    if (!res.ok) {
      const denied = permissionDenied(res.stderr);
      await audit({
        actorId: ctx.userId,
        actorEmail: ctx.email,
        action: "performance.swap.off",
        target: "all",
        result: "failure",
        details: { stderr: res.stderr.slice(0, 300) },
      });
      return NextResponse.json({
        ok: false,
        requiresRoot: denied,
        message: denied
          ? "Disabling swap requires root — run `hypno swap off` on the server."
          : `swapoff failed: ${(res.stderr || "").trim().split("\n")[0] || "unknown error"}`,
        cliCommand: denied ? "hypno swap off" : undefined,
      });
    }
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "performance.swap.off",
      target: "all",
    });
    return NextResponse.json({ ok: true, message: "All swap devices disabled." });
  }

  throw new ApiError(400, "invalid_input", "action must be create or off");
});
