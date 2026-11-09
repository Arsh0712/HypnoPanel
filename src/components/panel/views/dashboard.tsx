"use client";

import { useQuery } from "@tanstack/react-query";
import { usePanelStore } from "@/lib/store";
import { get, fmtBytes, fmtDuration } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  ArrowDownUp,
  Clock,
  Globe,
  Server,
  Boxes,
  TerminalSquare,
  ArrowUpRight,
  Network as NetworkIcon,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { ViewHeader, StatCard, SectionCard, StatusChip, AnimatedNumber } from "@/components/panel/primitives";
import { fadeUp, stagger } from "@/components/panel/motion";

interface LiveResponse {
  metrics: {
    ts: number;
    cpu: number;
    cpuPerCore: number[];
    memUsed: number;
    memTotal: number;
    swapUsed: number;
    swapTotal: number;
    diskUsed: number;
    diskTotal: number;
    netRx: number;
    netTx: number;
    load1: number;
    load5: number;
    load15: number;
  } | null;
  ring: { ts: number; cpu: number; memUsed: number; memTotal: number; netRx: number; netTx: number }[];
  host: {
    hostname: string;
    os: string;
    kernel: string;
    arch: string;
    uptimeSec: number;
    virt: string;
    cpuModel: string;
    cpuCores: number;
    memTotal: number;
    publicIpv4: string | null;
    publicIpv6: string | null;
    panelVersion: string;
  };
  services: { name: string; status: string; detail?: string }[];
  processes: { pid: number; user: string; cpu: number; mem: number; command: string }[];
  tunnel: { status: string; latencyMs: number | null; lastError: string | null };
  recentAudit: { ts: string; actorEmail: string | null; action: string; target: string | null; result: string }[];
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  fontSize: 12,
  boxShadow: "0 8px 30px rgb(0 0 0 / 12%)",
} as const;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night ops";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Tiny sparkline used inside stat cards. */
function Spark({ data, dataKey, color }: { data: unknown[]; dataKey: string; color: string }) {
  return (
    <div className="h-11 -mx-1 mt-1 opacity-90">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.8}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DashboardView() {
  const setView = usePanelStore((s) => s.setView);
  const viewer = usePanelStore((s) => s.viewer);
  const live = useQuery<LiveResponse>({
    queryKey: ["dashboard-live"],
    queryFn: () => get<LiveResponse>("/api/dashboard/live"),
    refetchInterval: 3000,
  });
  const history = useQuery<{ history: { ts: number; cpu: number; memUsed: number; memTotal: number }[] }>({
    queryKey: ["dashboard-history"],
    queryFn: () => get("/api/dashboard/history?hours=24"),
    refetchInterval: 60_000,
  });

  if (live.isLoading || !live.data) {
    return (
      <div className="space-y-6">
        <div className="h-24 w-80 rounded-xl bg-muted/50 hipno-shimmer" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-36 rounded-xl bg-muted/50 hipno-shimmer" />
          ))}
        </div>
        <div className="h-72 rounded-xl bg-muted/40 hipno-shimmer" />
      </div>
    );
  }
  if (live.isError) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Could not load dashboard data. Retrying automatically…
        </CardContent>
      </Card>
    );
  }

  const { metrics, host, services, processes, tunnel, recentAudit, ring } = live.data;
  const m = metrics;
  const memPct = m && m.memTotal ? (m.memUsed / m.memTotal) * 100 : 0;
  const diskPct = m && m.diskTotal ? (m.diskUsed / m.diskTotal) * 100 : 0;

  const sparkRing = ring.slice(-36);
  const memSpark = sparkRing.map((r) => ({ v: r.memTotal ? (r.memUsed / r.memTotal) * 100 : 0 }));
  const chartData = ring.map((r) => ({
    t: timeLabel(r.ts),
    cpu: r.cpu,
    mem: r.memTotal ? Math.round((r.memUsed / r.memTotal) * 1000) / 10 : 0,
    netRx: Math.round(r.netRx / 1024),
    netTx: Math.round(r.netTx / 1024),
  }));
  const hist = (history.data?.history || []).map((h) => ({
    t: new Date(h.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    cpu: h.cpu,
    mem: h.memTotal ? Math.round((h.memUsed / h.memTotal) * 1000) / 10 : 0,
  }));

  const firstName = (viewer?.name || viewer?.email || "admin").split(/[ @]/)[0];
  const okServices = services.filter((s) => s.status === "ok").length;

  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="show"
      className="space-y-6"
    >
      {/* ————— hero ————— */}
      <motion.div variants={fadeUp} className="relative overflow-hidden rounded-2xl border hipno-card">
        <div className="absolute inset-0 hipno-aurora opacity-70 dark:opacity-100" aria-hidden />
        <div className="relative flex flex-wrap items-end justify-between gap-6 p-6 md:p-7">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 text-muted-foreground text-xs">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 hipno-pulse" aria-hidden />
                live · 3s polling
              </span>
              <span aria-hidden>·</span>
              <span className="font-mono">{host.panelVersion}</span>
            </div>
            <h1 className="mt-2 text-[28px] md:text-[34px] font-semibold tracking-tight leading-tight">
              {greeting()},{" "}
              <span className="font-[family-name:var(--font-display)] italic text-gradient">{firstName}</span>
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <Server className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="font-medium text-foreground truncate">{host.hostname}</span>
              </span>
              <span className="hidden md:inline">{host.os}</span>
              <span className="hidden xl:inline">kernel {host.kernel} · {host.arch}</span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" aria-hidden /> up {fmtDuration(host.uptimeSec)}
              </span>
              {host.publicIpv4 && (
                <span className="hidden lg:inline font-mono text-[12px] border rounded-full px-2 py-0.5 border-border">
                  {host.publicIpv4}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="h-9" onClick={() => setView("websites")}>
              <Globe className="h-3.5 w-3.5 mr-1.5" aria-hidden /> New website
            </Button>
            <Button size="sm" variant="outline" className="h-9" onClick={() => setView("apps")}>
              <Boxes className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Deploy app
            </Button>
            <Button size="sm" className="h-9 hipno-glow" onClick={() => setView("terminal")}>
              <TerminalSquare className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Terminal
            </Button>
          </div>
        </div>
      </motion.div>

      {/* ————— stat cards ————— */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <motion.div variants={fadeUp}>
          <StatCard
            icon={Cpu}
            label="CPU"
            value={<AnimatedNumber value={m?.cpu ?? 0} format={(n) => `${n.toFixed(1)}%`} />}
            sub={`${host.cpuCores}× ${host.cpuModel}`}
          />
          <Spark data={sparkRing.map((r) => ({ v: r.cpu }))} dataKey="v" color="var(--chart-1)" />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard
            icon={MemoryStick}
            label="Memory"
            value={
              <>
                <AnimatedNumber value={m?.memUsed ?? 0} format={(n) => fmtBytes(n)} />
                <span className="text-sm font-normal text-muted-foreground"> / {fmtBytes(m?.memTotal)}</span>
              </>
            }
          />
          <Progress value={memPct} className="h-1.5 mt-3" aria-label={`Memory ${memPct.toFixed(0)}%`} />
          {m && m.swapTotal > 0 && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              swap {fmtBytes(m.swapUsed)} / {fmtBytes(m.swapTotal)}
            </p>
          )}
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard
            icon={HardDrive}
            label="Disk"
            value={
              <>
                <AnimatedNumber value={m?.diskUsed ?? 0} format={(n) => fmtBytes(n)} />
                <span className="text-sm font-normal text-muted-foreground"> / {fmtBytes(m?.diskTotal)}</span>
              </>
            }
          />
          <Progress value={diskPct} className="h-1.5 mt-3" aria-label={`Disk ${diskPct.toFixed(0)}%`} />
          <p className="mt-1.5 text-[11px] text-muted-foreground">{diskPct.toFixed(1)}% used</p>
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard
            icon={ArrowDownUp}
            label="Network"
            value={
              <>
                <span className="text-emerald-600 dark:text-emerald-400">↓</span>
                <AnimatedNumber value={m?.netRx ?? 0} format={(n) => fmtBytes(n)} />
                <span className="text-sm font-normal text-muted-foreground">/s</span>
              </>
            }
            sub={`↑ ${fmtBytes(m?.netTx || 0)}/s · load ${m?.load1.toFixed(2) ?? "0.00"}`}
          />
          <Spark data={sparkRing.map((r) => ({ v: r.netRx }))} dataKey="v" color="var(--chart-2)" />
        </motion.div>
      </div>

      {/* ————— charts + service health ————— */}
      <div className="grid gap-4 lg:grid-cols-3">
        <motion.div variants={fadeUp} className="lg:col-span-2">
          <Tabs defaultValue="live">
            <SectionCard
              title="Resource usage"
              description="CPU and memory, live and over time"
              actions={
                <TabsList className="h-8">
                  <TabsTrigger value="live" className="text-xs h-7">Live</TabsTrigger>
                  <TabsTrigger value="24h" className="text-xs h-7">24 hours</TabsTrigger>
                </TabsList>
              }
            >
              <div className="h-72">
                <TabsContent value="live" className="mt-0 h-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="memFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.22} />
                          <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 6" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="t" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" minTickGap={44} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" unit="%" width={38} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Area type="monotone" dataKey="cpu" name="CPU %" stroke="var(--chart-1)" fill="url(#cpuFill)" strokeWidth={2} isAnimationActive={false} />
                      <Area type="monotone" dataKey="mem" name="Memory %" stroke="var(--chart-2)" fill="url(#memFill)" strokeWidth={2} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </TabsContent>
                <TabsContent value="24h" className="mt-0 h-full">
                  {hist.length < 2 ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                      Collecting samples — the chart builds as the sampler runs (10s interval).
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={hist}>
                        <CartesianGrid strokeDasharray="3 6" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="t" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" minTickGap={48} tickLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" unit="%" width={38} tickLine={false} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Line type="monotone" dataKey="cpu" name="CPU %" stroke="var(--chart-1)" dot={false} strokeWidth={2} />
                        <Line type="monotone" dataKey="mem" name="Memory %" stroke="var(--chart-2)" dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </TabsContent>
              </div>
            </SectionCard>
          </Tabs>
        </motion.div>

        <motion.div variants={fadeUp}>
          <SectionCard
            title="Service health"
            description={`${okServices}/${services.length} healthy`}
            actions={
              <button
                onClick={() => setView("services")}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Open services"
              >
                <ArrowUpRight className="h-4 w-4" />
              </button>
            }
          >
            <ul className="space-y-2">
              {services.map((s) => (
                <li key={s.name} className="flex items-center justify-between gap-2">
                  <span className="text-[13px] truncate" title={s.detail}>{s.name}</span>
                  <StatusChip
                    status={s.status === "ok" ? "ok" : s.status === "down" ? "fail" : "na"}
                    label={s.status}
                  />
                </li>
              ))}
            </ul>
            <div className="mt-4 rounded-lg border bg-muted/30 px-3 py-2.5">
              <div className="flex items-center justify-between text-[13px]">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <NetworkIcon className="h-3.5 w-3.5" aria-hidden /> Relay tunnel
                </span>
                <StatusChip
                  status={tunnel.status === "connected" ? "connected" : tunnel.status === "connecting" ? "degraded" : "offline"}
                  label={`${tunnel.status}${tunnel.latencyMs != null ? ` · ${tunnel.latencyMs}ms` : ""}`}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground/80 mt-3 leading-relaxed">
              Backends not present in this environment are reported honestly as unavailable.
            </p>
          </SectionCard>
        </motion.div>
      </div>

      {/* ————— processes + audit ————— */}
      <div className="grid gap-4 lg:grid-cols-3">
        <motion.div variants={fadeUp} className="lg:col-span-2">
          <SectionCard
            title="Top processes"
            description="By CPU usage, live from /proc"
            actions={
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setView("processes")}>
                All processes <ArrowUpRight className="h-3.5 w-3.5 ml-1" aria-hidden />
              </Button>
            }
          >
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-muted-foreground border-b">
                    <th className="py-2 pr-4 font-medium">PID</th>
                    <th className="py-2 pr-4 font-medium">User</th>
                    <th className="py-2 pr-4 font-medium">CPU %</th>
                    <th className="py-2 pr-4 font-medium">MEM %</th>
                    <th className="py-2 font-medium">Command</th>
                  </tr>
                </thead>
                <tbody>
                  {processes.map((p) => (
                    <tr key={p.pid} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="py-1.5 pr-4 font-mono text-xs">{p.pid}</td>
                      <td className="py-1.5 pr-4">{p.user}</td>
                      <td className="py-1.5 pr-4 tabular-nums">{p.cpu.toFixed(1)}</td>
                      <td className="py-1.5 pr-4 tabular-nums">{p.mem.toFixed(1)}</td>
                      <td className="py-1.5 font-mono text-xs truncate max-w-72" title={p.command}>{p.command}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </motion.div>

        <motion.div variants={fadeUp}>
          <SectionCard
            title="Recent activity"
            description="Hash-chained audit log"
            actions={
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setView("audit")}>
                Full log <ArrowUpRight className="h-3.5 w-3.5 ml-1" aria-hidden />
              </Button>
            }
          >
            <ul className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
              {recentAudit.map((a, i) => (
                <li key={i} className="text-xs flex items-start gap-2.5">
                  <span
                    className={cn(
                      "mt-1 h-1.5 w-1.5 rounded-full shrink-0",
                      a.result === "success" ? "bg-emerald-500" : "bg-red-500"
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="font-mono">{a.action}</span>{" "}
                    <span className="text-muted-foreground">
                      {a.actorEmail || "system"} · {new Date(a.ts).toLocaleTimeString()}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>
        </motion.div>
      </div>
    </motion.div>
  );
}
