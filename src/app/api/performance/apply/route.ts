import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { guard } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import { ApiError } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import {
  validatePhpTuning,
  savePhpTuning,
  readNetSysctls,
  setSettingJson,
  type PhpTuning,
} from "../_shared";

export const runtime = "nodejs";

interface ApplyBody {
  section?: string;
  values?: Record<string, unknown>;
}

const CC_SYSCTL = "/proc/sys/net/ipv4/tcp_congestion_control";

function isPermissionError(e: unknown): boolean {
  const err = e as NodeJS.ErrnoException;
  return err?.code === "EACCES" || err?.code === "EPERM" || err?.code === "EROFS";
}

/**
 * POST /api/performance/apply — store a tuning section (php | http) in the
 * panel config, or attempt the REAL sysctl write (net). Privileged failures
 * return an honest structured error with the hypno CLI command.
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "performance:write" });
  const body = (await req.json().catch(() => ({}))) as ApplyBody;
  const { section, values } = body;
  if (!section || typeof values !== "object" || values === null) {
    throw new ApiError(400, "invalid_input", "section and values are required");
  }

  if (section === "php") {
    const tuning = validatePhpTuning(values);
    if (!tuning) {
      throw new ApiError(400, "invalid_input", "PHP tuning values failed validation");
    }
    await savePhpTuning(tuning);
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "performance.advisor.apply",
      target: "php",
      details: { values: tuning },
    });
    return NextResponse.json({
      ok: true,
      message: "PHP-FPM tuning stored in the panel config (pools are generated per site on the VPS deployment).",
      applied: tuning as PhpTuning,
    });
  }

  if (section === "net") {
    const cc = values.congestionControl;
    if (typeof cc !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/i.test(cc)) {
      throw new ApiError(400, "invalid_input", "congestionControl must be an algorithm name");
    }
    const net = await readNetSysctls();
    if (net.available && !net.availableAlgorithms.includes(cc)) {
      throw new ApiError(400, "invalid_input", `Kernel does not offer ${cc} (available: ${net.availableAlgorithms.join(", ")})`);
    }
    // Attempt the REAL /proc write — succeeds only when the panel runs as root.
    try {
      await fs.promises.writeFile(CC_SYSCTL, cc);
      const after = fs.readFileSync(CC_SYSCTL, "utf8").trim();
      if (after !== cc) throw new Error("write did not stick");
      await setSettingJson("perf.net", { congestionControl: cc });
      await audit({
        actorId: ctx.userId,
        actorEmail: ctx.email,
        action: "performance.net.apply",
        target: "net.ipv4.tcp_congestion_control",
        details: { from: net.congestionControl, to: cc },
      });
      return NextResponse.json({
        ok: true,
        message: `Congestion control switched to ${cc}.`,
      });
    } catch (e) {
      if (isPermissionError(e) || !net.available) {
        await audit({
          actorId: ctx.userId,
          actorEmail: ctx.email,
          action: "performance.net.apply",
          target: "net.ipv4.tcp_congestion_control",
          result: "failure",
          details: { from: net.congestionControl, to: cc, reason: "requires root" },
        });
        return NextResponse.json({
          ok: false,
          requiresRoot: true,
          message: `Switching the congestion control algorithm requires root — run \`hypno perf set net.ipv4.tcp_congestion_control=${cc}\` on the server.`,
          cliCommand: `hypno perf set net.ipv4.tcp_congestion_control=${cc}`,
        });
      }
      return NextResponse.json({
        ok: false,
        message: "The sysctl write failed unexpectedly — no changes were made.",
      });
    }
  }

  if (section === "http") {
    const brotli = values.brotli;
    const staticCache = values.staticCache;
    if (typeof brotli !== "boolean" || typeof staticCache !== "boolean") {
      throw new ApiError(400, "invalid_input", "http toggles must be booleans");
    }
    await setSettingJson("perf.http", { brotli, staticCache });
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "performance.http.apply",
      target: "caddy-features",
      details: { brotli, staticCache },
    });
    return NextResponse.json({
      ok: true,
      message: "HTTP feature toggles stored in the panel config (fed into per-site Caddyfile generation on the VPS deployment).",
    });
  }

  throw new ApiError(400, "invalid_input", "section must be php, net or http");
});
