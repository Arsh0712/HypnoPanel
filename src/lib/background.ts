import { getMetricsEngine } from "@/lib/metrics";
import { evaluateMonitors } from "@/lib/monitor-eval";
import { createBackup } from "@/lib/backup";
import { getSetting } from "@/lib/settings";
import { db } from "@/lib/db";
import { run } from "@/lib/exec";
import { audit } from "@/lib/audit";

/**
 * Background jobs (started once via src/instrumentation.ts):
 *  - metrics sampler (10s) + 24h history persistence
 *  - monitor rule evaluation (30s)
 *  - cron scheduler (30s) — executes due jobs with output capture
 *  - backup schedule (60s check)
 *  - relay tunnel client (auto-reconnect)
 */

const g = globalThis as unknown as { __hipnoBgStarted?: boolean; __hipnoCronLast?: Map<string, number> };

function cronState(): Map<string, number> {
  if (!g.__hipnoCronLast) g.__hipnoCronLast = new Map();
  return g.__hipnoCronLast;
}

function parseField(field: string, min: number, max: number): number[] {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const stepM = part.match(/^(\*|\d+-\d+)\/(\d+)$/);
    const rangeM = part.match(/^(\d+)-(\d+)$/);
    if (part === "*") {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (stepM) {
      const [, base, step] = stepM;
      const stepN = Number(step);
      if (base === "*") {
        for (let i = min; i <= max; i += stepN) values.add(i);
      } else {
        const [a, b] = base.split("-").map(Number);
        for (let i = a; i <= b; i += stepN) values.add(i);
      }
    } else if (rangeM) {
      const a = Number(rangeM[1]);
      const b = Number(rangeM[2]);
      for (let i = a; i <= b; i++) values.add(i);
    } else {
      const n = Number(part);
      if (!Number.isNaN(n)) values.add(n);
    }
  }
  return [...values];
}

function cronMatches(schedule: string, d: Date): boolean {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, mon, dow] = parts;
  return (
    parseField(min, 0, 59).includes(d.getMinutes()) &&
    parseField(hour, 0, 23).includes(d.getHours()) &&
    parseField(dom, 1, 31).includes(d.getDate()) &&
    parseField(mon, 1, 12).includes(d.getMonth() + 1) &&
    parseField(dow, 0, 7).includes(d.getDay())
  );
}

async function executeCronJob(jobId: string, command: string, trigger: "manual" | "scheduler") {
  const run = await db.cronRun.create({ data: { jobId, trigger } });
  const res = await run2();
  async function run2() {
    // execFile with bash -c: the command string IS the job payload (admin-defined,
    // admin-only permission, audit-logged) — timeouts prevent runaways.
    const { execFile } = await import("child_process");
    return new Promise<{ code: number | null; output: string }>((resolve) => {
      execFile("bash", ["-c", command], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
        resolve({
          code: e ? (typeof e.code === "number" ? e.code : 1) : 0,
          output: `${stdout || ""}${stderr ? (stdout ? "\n" : "") + stderr : ""}`.slice(0, 200_000),
        });
      });
    });
  }
  await db.cronRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), exitCode: res.code, output: res.output },
  });
  await db.cronJob.update({ where: { id: jobId }, data: { lastRunAt: new Date() } });
  if (res.code !== 0) {
    await audit({
      action: "cron.run.failed",
      target: jobId,
      source: "system",
      result: "failure",
      details: { exitCode: res.code, trigger, tail: res.output.slice(-400) },
    });
  }
}

export { executeCronJob, cronMatches };

export async function startBackgroundJobs(): Promise<void> {
  if (g.__hipnoBgStarted) return;
  g.__hipnoBgStarted = true;

  // Prime the metrics engine
  const engine = getMetricsEngine();
  engine.sample();
  setTimeout(() => engine.sample(), 1500);

  // Metrics: sample every 10s, persist every 10s
  setInterval(() => {
    const snap = engine.sample();
    void engine.persist(snap);
  }, 10_000);

  // Monitor rules: evaluate every 30s (also picks up SSL-expiry alerts via cert-watch)
  setInterval(() => {
    void evaluateMonitors().catch((e) => console.error("[monitor]", e));
    void import("@/lib/cert-watch")
      .then((m) => m.checkCertExpiries())
      .catch((e) => console.error("[cert-watch]", e));
  }, 30_000);

  // Cron scheduler: check every 30s (minute granularity)
  setInterval(() => {
    void (async () => {
      const jobs = await db.cronJob.findMany({ where: { enabled: true } });
      const now = new Date();
      const minuteKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}-${now.getUTCMinutes()}`;
      for (const job of jobs) {
        if (!cronMatches(job.schedule, now)) continue;
        const last = cronState().get(job.id);
        if (last === now.getTime()) continue;
        cronState().set(job.id, now.getTime());
        void executeCronJob(job.id, job.command, "scheduler").catch((e) =>
          console.error("[cron]", job.id, e)
        );
      }
      // keep the map small
      if (cronState().size > 500) cronState().clear();
      void minuteKey;
    })().catch((e) => console.error("[cron]", e));
  }, 30_000);

  // Backup schedule: check every 60s
  setInterval(() => {
    void (async () => {
      const schedule = await getSetting("backup.schedule", "0 3 * * *");
      const lastState = cronState();
      const now = new Date();
      if (!cronMatches(schedule, now)) return;
      const key = `__backup__${now.getUTCDate()}-${now.getUTCHours()}-${now.getUTCMinutes()}`;
      if (lastState.get(key)) return;
      lastState.set(key, now.getTime());
      const res = await createBackup(
        { panelDb: true, sites: true, databases: true, config: true },
        "scheduled"
      );
      if (!res.ok) console.error("[backup] scheduled run failed:", res.error);
    })().catch((e) => console.error("[backup]", e));
  }, 60_000);

  // Relay tunnel
  const { startTunnel } = await import("@/lib/tunnel-client");
  void startTunnel().catch((e) => console.error("[tunnel]", e));

  console.log("[hipno] background jobs started (metrics, monitors, cron, backups, tunnel)");
}

// silence unused import warning for run (kept for future use by modules)
void run;
