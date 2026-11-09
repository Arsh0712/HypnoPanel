import { NextRequest, NextResponse } from "next/server";
import os from "os";
import { guard } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import { db } from "@/lib/db";
import { getMetricsEngine } from "@/lib/metrics";
import { psTop, type ProcRow } from "../_shared";

export const runtime = "nodejs";

interface SlowProcess extends ProcRow {
  matched: { kind: "website" | "app"; label: string } | null;
}

/**
 * GET /api/performance/slow — "Why is my server slow?" triage. Ranks the real
 * top CPU / memory consumers (full ps args), matches each command against
 * Website docRoots/linuxUsers and App names, and gives a load-vs-cores verdict.
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "performance:read" });

  const engine = getMetricsEngine();
  if (engine.ring.length === 0) engine.sample();
  const snap = engine.latest();

  const [topCpu, topMem, sites, apps] = await Promise.all([
    psTop("cpu", 12),
    psTop("mem", 12),
    db.website.findMany({ select: { name: true, domain: true, docRoot: true, linuxUser: true } }),
    db.app.findMany({ select: { name: true, slug: true } }),
  ]);

  const match = (cmd: string): { kind: "website" | "app"; label: string } | null => {
    const c = cmd.toLowerCase();
    for (const s of sites) {
      if (s.docRoot && c.includes(s.docRoot.toLowerCase())) return { kind: "website", label: s.name || s.domain };
      if (s.linuxUser && c.includes(s.linuxUser.toLowerCase())) return { kind: "website", label: s.name || s.domain };
    }
    for (const a of apps) {
      if (c.includes(a.slug.toLowerCase())) return { kind: "app", label: a.name };
      if (a.name && c.includes(a.name.toLowerCase())) return { kind: "app", label: a.name };
    }
    return null;
  };

  const decorate = (rows: ProcRow[]): SlowProcess[] =>
    rows.map((p) => ({ ...p, matched: match(p.command) }));

  const cores = (snap?.cpuPerCore.length || 0) || os.cpus().length;
  const load1 = snap?.load1 ?? 0;
  const ratio = cores > 0 ? load1 / cores : 0;
  const saturation = Math.round(ratio * 100);
  let verdict: string;
  let verdictLevel: "ok" | "warn" | "fail";
  if (ratio < 0.75) {
    verdict = `Load ${load1.toFixed(2)} on ${cores} cores (${saturation}% saturation) — the server is comfortably within capacity; if things feel slow, look at per-process memory or disk I/O below.`;
    verdictLevel = "ok";
  } else if (ratio < 1) {
    verdict = `Load ${load1.toFixed(2)} on ${cores} cores (${saturation}% saturation) — the server is busy but not yet saturated; the top consumers below are the place to look.`;
    verdictLevel = "warn";
  } else {
    verdict = `Load ${load1.toFixed(2)} on ${cores} cores (${saturation}% saturation) — demand exceeds capacity and work is queueing; the top consumers below are keeping the CPU busy.`;
    verdictLevel = "fail";
  }

  const rankedCpu = decorate(topCpu);
  const rankedMem = decorate(topMem);
  const untrackedCount = [...rankedCpu, ...rankedMem].filter((p) => !p.matched).length;

  return NextResponse.json({
    cores,
    load1,
    verdict,
    verdictLevel,
    topCpu: rankedCpu,
    topMem: rankedMem,
    untrackedCount,
  });
});
