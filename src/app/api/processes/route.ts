import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { run } from "@/lib/exec";
import { ApiError, handle } from "@/lib/api-error";

export const runtime = "nodejs";

/**
 * GET /api/processes?search=&sort=cpu|mem|pid&limit=100
 * Real `ps` output from this server (processes:read).
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "processes:read" });

  const url = new URL(req.url);
  const search = (url.searchParams.get("search") || "").trim().toLowerCase();
  const sortParam = url.searchParams.get("sort") || "cpu";
  const sortKey = sortParam === "mem" ? "pmem" : sortParam === "pid" ? "pid" : "pcpu";
  let limit = Number(url.searchParams.get("limit") || 100);
  if (!Number.isInteger(limit) || limit < 1) limit = 100;
  if (limit > 300) limit = 300;

  const res = await run(
    "ps",
    ["-eo", "pid,user,pcpu,pmem,rss,stat,time,comm", `--sort=-${sortKey}`, "--no-headers"],
    { timeoutMs: 10_000 }
  );
  if (!res.ok) {
    // Honest failure: ps must exist on a Linux host
    throw new ApiError(500, "ps_failed", `ps failed: ${res.stderr.trim().slice(0, 300) || `exit ${res.code}`}`);
  }

  const processes = res.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(/\s+/);
      if (parts.length < 8) return null;
      const pid = Number(parts[0]);
      const cpu = Number(parts[2]);
      const mem = Number(parts[3]);
      const rss = Number(parts[4]);
      if (!Number.isInteger(pid)) return null;
      return {
        pid,
        user: parts[1],
        cpu: Number.isFinite(cpu) ? cpu : 0,
        mem: Number.isFinite(mem) ? mem : 0,
        rss: Number.isFinite(rss) ? Math.round(rss * 1024) : 0, // ps RSS is in KB
        stat: parts[5],
        time: parts[6],
        command: parts.slice(7).join(" "),
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .filter((p) => {
      if (!search) return true;
      return (
        p.command.toLowerCase().includes(search) ||
        p.user.toLowerCase().includes(search) ||
        String(p.pid).includes(search)
      );
    })
    .slice(0, limit);

  return NextResponse.json({ processes, total: processes.length });
});
