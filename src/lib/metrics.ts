import fs from "fs";
import os from "os";
import { db } from "@/lib/db";

/**
 * Real host metrics sampler. Reads /proc on the local machine, keeps an
 * in-memory ring for live dashboards and persists samples for 24h history
 * (spec §5.1), pruned and available for downsampling.
 */

export interface MetricSnapshot {
  ts: number;
  cpu: number; // percent 0-100
  cpuPerCore: number[];
  memUsed: number;
  memTotal: number;
  swapUsed: number;
  swapTotal: number;
  diskUsed: number;
  diskTotal: number;
  netRx: number; // bytes/sec
  netTx: number; // bytes/sec
  load1: number;
  load5: number;
  load15: number;
}

interface CpuTimes {
  total: number[];
  idle: number[];
}

const RING_SIZE = 480; // ~80 min at 10s sampling

class MetricsEngine {
  private lastCpu: CpuTimes | null = null;
  private lastNet: { rx: number; tx: number; ts: number } | null = null;
  ring: MetricSnapshot[] = [];
  startedAt = Date.now();

  private readCpu(): CpuTimes | null {
    try {
      const txt = fs.readFileSync("/proc/stat", "utf8");
      const lines = txt.split("\n").filter((l) => /^cpu\d*\s/.test(l));
      const totals: number[] = [];
      const idles: number[] = [];
      for (const line of lines) {
        const parts = line.split(/\s+/).slice(1).map(Number);
        // user nice system idle iowait irq softirq steal …
        const idle = (parts[3] || 0) + (parts[4] || 0);
        const total = parts.reduce((a, b) => a + b, 0);
        totals.push(total);
        idles.push(idle);
      }
      return { total: totals, idle: idles };
    } catch {
      return null;
    }
  }

  private readMem(): { memTotal: number; memAvailable: number; swapTotal: number; swapFree: number } {
    try {
      const txt = fs.readFileSync("/proc/meminfo", "utf8");
      const get = (k: string) => Number(txt.match(new RegExp(`^${k}:\\s+(\\d+) kB`, "m"))?.[1] || 0) * 1024;
      return {
        memTotal: get("MemTotal"),
        memAvailable: get("MemAvailable"),
        swapTotal: get("SwapTotal"),
        swapFree: get("SwapFree"),
      };
    } catch {
      return { memTotal: os.totalmem(), memAvailable: os.freemem(), swapTotal: 0, swapFree: 0 };
    }
  }

  private readNet(): { rx: number; tx: number } {
    try {
      const txt = fs.readFileSync("/proc/net/dev", "utf8");
      let rx = 0;
      let tx = 0;
      for (const line of txt.split("\n").slice(2)) {
        const m = line.match(/^\s*([^:]+):\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
        if (!m) continue;
        const iface = m[1].trim();
        if (iface === "lo") continue;
        rx += Number(m[2]);
        tx += Number(m[3]);
      }
      return { rx, tx };
    } catch {
      return { rx: 0, tx: 0 };
    }
  }

  private readDisk(): { used: number; total: number } {
    try {
      const st = fs.statfsSync("/") as { blocks: number; bsize: number; bfree: number };
      const total = st.blocks * st.bsize;
      const free = st.bfree * st.bsize;
      return { used: total - free, total };
    } catch {
      return { used: 0, total: 0 };
    }
  }

  private readLoad(): [number, number, number] {
    try {
      const txt = fs.readFileSync("/proc/loadavg", "utf8");
      const p = txt.split(" ");
      return [Number(p[0]), Number(p[1]), Number(p[2])];
    } catch {
      const l = os.loadavg();
      return [l[0], l[1], l[2]];
    }
  }

  /** Take one sample (CPU/net are deltas vs the previous call). */
  sample(): MetricSnapshot {
    const now = Date.now();
    const cpu = this.readCpu();
    let cpuPct = 0;
    let cpuPerCore: number[] = [];
    if (cpu && this.lastCpu && cpu.total.length === this.lastCpu.total.length) {
      cpuPerCore = cpu.total.map((t, i) => {
        const dt = t - this.lastCpu!.total[i];
        const di = cpu.idle[i] - this.lastCpu!.idle[i];
        if (dt <= 0) return 0;
        return Math.min(100, Math.max(0, ((dt - di) / dt) * 100));
      });
      // overall = first /proc/stat line (index 0 = aggregate)
      cpuPct = cpuPerCore[0] || 0;
    }
    this.lastCpu = cpu;

    const net = this.readNet();
    let netRx = 0;
    let netTx = 0;
    if (this.lastNet) {
      const dt = Math.max(1, (now - this.lastNet.ts) / 1000);
      netRx = Math.max(0, (net.rx - this.lastNet.rx) / dt);
      netTx = Math.max(0, (net.tx - this.lastNet.tx) / dt);
    }
    this.lastNet = { ...net, ts: now };

    const mem = this.readMem();
    const disk = this.readDisk();
    const load = this.readLoad();

    const snap: MetricSnapshot = {
      ts: now,
      cpu: Math.round(cpuPct * 10) / 10,
      cpuPerCore: cpuPerCore.slice(1).map((v) => Math.round(v * 10) / 10), // exclude aggregate
      memUsed: mem.memTotal - mem.memAvailable,
      memTotal: mem.memTotal,
      swapUsed: mem.swapTotal - mem.swapFree,
      swapTotal: mem.swapTotal,
      diskUsed: disk.used,
      diskTotal: disk.total,
      netRx: Math.round(netRx),
      netTx: Math.round(netTx),
      load1: load[0],
      load5: load[1],
      load15: load[2],
    };
    this.ring.push(snap);
    if (this.ring.length > RING_SIZE) this.ring.shift();
    return snap;
  }

  latest(): MetricSnapshot | null {
    return this.ring.length ? this.ring[this.ring.length - 1] : null;
  }

  /** Persist the current sample to SQLite (called by the background loop). */
  async persist(snap: MetricSnapshot): Promise<void> {
    try {
      await db.metricSample.create({
        data: {
          ts: new Date(snap.ts),
          cpu: snap.cpu,
          memUsed: BigInt(Math.round(snap.memUsed)),
          memTotal: BigInt(Math.round(snap.memTotal)),
          swapUsed: BigInt(Math.round(snap.swapUsed)),
          swapTotal: BigInt(Math.round(snap.swapTotal)),
          diskUsed: BigInt(Math.round(snap.diskUsed)),
          diskTotal: BigInt(Math.round(snap.diskTotal)),
          netRx: snap.netRx,
          netTx: snap.netTx,
          load1: snap.load1,
        },
      });
      // prune to 24h
      await db.metricSample.deleteMany({
        where: { ts: { lt: new Date(Date.now() - 24 * 3600_000) } },
      });
    } catch (e) {
      console.error("[metrics] persist failed:", e);
    }
  }

  /** 24h history, downsampled to per-minute averages. */
  async history(hours = 24): Promise<MetricSnapshot[]> {
    const since = new Date(Date.now() - hours * 3600_000);
    const rows = await db.metricSample.findMany({
      where: { ts: { gte: since } },
      orderBy: { ts: "asc" },
    });
    const buckets = new Map<number, MetricSnapshot[]>();
    for (const r of rows) {
      const minute = Math.floor(r.ts.getTime() / 60_000) * 60_000;
      const arr = buckets.get(minute) || [];
      arr.push({
        ts: r.ts.getTime(),
        cpu: r.cpu,
        cpuPerCore: [],
        memUsed: Number(r.memUsed), // BigInt → Number (safe: < 2^53)
        memTotal: Number(r.memTotal),
        swapUsed: Number(r.swapUsed),
        swapTotal: Number(r.swapTotal),
        diskUsed: Number(r.diskUsed),
        diskTotal: Number(r.diskTotal),
        netRx: r.netRx,
        netTx: r.netTx,
        load1: r.load1,
        load5: 0, // per-minute averages keep load1 only (load5/15 not persisted)
        load15: 0,
      });
      buckets.set(minute, arr);
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([minute, snaps]) => {
        const avg = (fn: (s: MetricSnapshot) => number) =>
          snaps.reduce((a, s) => a + fn(s), 0) / snaps.length;
        return {
          ts: minute,
          cpu: Math.round(avg((s) => s.cpu) * 10) / 10,
          cpuPerCore: [],
          memUsed: Math.round(avg((s) => s.memUsed)),
          memTotal: snaps[0].memTotal,
          swapUsed: Math.round(avg((s) => s.swapUsed)),
          swapTotal: snaps[0].swapTotal,
          diskUsed: Math.round(avg((s) => s.diskUsed)),
          diskTotal: snaps[0].diskTotal,
          netRx: Math.round(avg((s) => s.netRx)),
          netTx: Math.round(avg((s) => s.netTx)),
          load1: Math.round(avg((s) => s.load1) * 100) / 100,
          load5: 0,
          load15: 0,
        };
      });
  }
}

const g = globalThis as unknown as { __hipnoMetrics?: MetricsEngine };

export function getMetricsEngine(): MetricsEngine {
  if (!g.__hipnoMetrics) g.__hipnoMetrics = new MetricsEngine();
  return g.__hipnoMetrics;
}
