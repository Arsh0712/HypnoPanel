"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, fmtBytes, ApiClientError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Gauge,
  Activity,
  Database,
  HardDriveDownload,
  Network,
  Globe,
  Search,
  Copy,
  Check,
  AlertTriangle,
  TerminalSquare,
  FileCode2,
  PackageX,
  ShieldCheck,
  RotateCcw,
  Zap,
} from "lucide-react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  ViewHeader,
  StatCard,
  SectionCard,
  StatusChip,
  EmptyState,
  AnimatedNumber,
} from "@/components/panel/primitives";
import { fadeUp, stagger } from "@/components/panel/motion";

/* ————————————————————————— response types ————————————————————————— */

interface Snapshot {
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
}

interface PhpTuning {
  "pm.max_children": number;
  "pm.start_servers": number;
  "pm.min_spare_servers": number;
  "pm.max_spare_servers": number;
  memory_limit: string;
  "opcache.memory_consumption": number;
  "opcache.max_accelerated_files": number;
  realpath_cache_size: string;
  realpath_cache_ttl: number;
}

interface OverviewResponse {
  metrics: Snapshot | null;
  ring: Snapshot[];
  applied: {
    php: PhpTuning | null;
    net: { congestionControl: string } | null;
    http: { brotli: boolean; staticCache: boolean } | null;
  };
}

interface SwapDevice {
  name: string;
  type: string;
  sizeBytes: number;
  usedBytes: number;
  priority: number;
}

interface AdvisorsResponse {
  php: {
    available: boolean;
    note: string;
    hostRam: number;
    recommended: PhpTuning;
    current: PhpTuning | null;
    snippet: string;
  };
  database: {
    sqlite: {
      available: boolean;
      pageSize: number | null;
      journalMode: string | null;
      walAutocheckpoint: number | null;
      dbBytes: number | null;
      guidance: string[];
    };
    mariadb: { available: boolean; reason: string };
    postgres: { available: boolean; reason: string };
  };
  swap: {
    totalBytes: number;
    usedBytes: number;
    cachedBytes: number;
    devices: SwapDevice[];
    swaponAvailable: boolean;
    source: string;
  };
  network: {
    available: boolean;
    congestionControl: string;
    availableAlgorithms: string[];
    bbrAvailable: boolean;
  };
  http: {
    caddyFile: string | null;
    encode: string[];
    staticCache: boolean;
    tls: boolean;
    note: string;
  };
}

interface SlowProcess {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  rssBytes: number;
  command: string;
  matched: { kind: "website" | "app"; label: string } | null;
}

interface SlowResponse {
  cores: number;
  load1: number;
  verdict: string;
  verdictLevel: "ok" | "warn" | "fail";
  topCpu: SlowProcess[];
  topMem: SlowProcess[];
  untrackedCount: number;
}

interface ApplyResponse {
  ok: boolean;
  requiresRoot?: boolean;
  message: string;
  cliCommand?: string;
}

/* ————————————————————————— shared bits ————————————————————————— */

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  fontSize: 12,
  boxShadow: "0 8px 30px rgb(0 0 0 / 12%)",
} as const;

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2 text-xs"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          toast({ title: "Clipboard unavailable", description: "Copy manually instead.", variant: "destructive" });
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/** Honest "requires root" alert with a copyable hypno CLI command. */
function RequiresRootAlert({ message, cliCommand }: { message: string; cliCommand: string }) {
  return (
    <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3.5">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-relaxed">{message}</p>
          <div className="mt-2.5 flex items-center gap-2 rounded-md border bg-muted/50 px-2.5 py-1.5">
            <TerminalSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{cliCommand}</code>
            <CopyButton text={cliCommand} label="Copy CLI command" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Diff-style preview row set used before any Apply. */
interface DiffDialogState {
  title: string;
  description: string;
  section: "php" | "net" | "http";
  values: Record<string, unknown>;
  rows: { label: string; old: string; next: string }[];
}

const PHP_LABELS: Record<string, string> = {
  "pm.max_children": "pm.max_children (FPM workers)",
  "pm.start_servers": "pm.start_servers",
  "pm.min_spare_servers": "pm.min_spare_servers",
  "pm.max_spare_servers": "pm.max_spare_servers",
  memory_limit: "memory_limit (php.ini)",
  "opcache.memory_consumption": "opcache.memory_consumption (MB)",
  "opcache.max_accelerated_files": "opcache.max_accelerated_files",
  realpath_cache_size: "realpath_cache_size",
  realpath_cache_ttl: "realpath_cache_ttl (s)",
};

/* ————————————————————————— view ————————————————————————— */

export function PerformanceView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [diff, setDiff] = useState<DiffDialogState | null>(null);
  const [rootError, setRootError] = useState<{ message: string; cliCommand: string } | null>(null);
  const [swapSize, setSwapSize] = useState("2");
  const [swapDialogOpen, setSwapDialogOpen] = useState(false);
  const [swapError, setSwapError] = useState<{ message: string; cliCommand: string } | null>(null);
  const [maxChildren, setMaxChildren] = useState<number | null>(null);
  const [memoryLimit, setMemoryLimit] = useState<string | null>(null);

  const overview = useQuery<OverviewResponse>({
    queryKey: ["perf-overview"],
    queryFn: () => get<OverviewResponse>("/api/performance/overview"),
    refetchInterval: 5_000,
  });
  const advisors = useQuery<AdvisorsResponse>({
    queryKey: ["perf-advisors"],
    queryFn: () => get<AdvisorsResponse>("/api/performance/advisors"),
    refetchInterval: 30_000,
  });
  const slow = useQuery<SlowResponse>({
    queryKey: ["perf-slow"],
    queryFn: () => get<SlowResponse>("/api/performance/slow"),
    refetchInterval: 15_000,
  });
  const history = useQuery<{ history: Snapshot[] }>({
    queryKey: ["perf-history"],
    queryFn: () => get<{ history: Snapshot[] }>("/api/dashboard/history?hours=24"),
    refetchInterval: 60_000,
  });

  const applyMutation = useMutation({
    mutationFn: (vars: { section: string; values: Record<string, unknown> }) =>
      post<ApplyResponse>("/api/performance/apply", vars),
    onSuccess: (data) => {
      setDiff(null);
      if (data.ok) {
        toast({ title: "Tuning applied", description: data.message });
        queryClient.invalidateQueries({ queryKey: ["perf-advisors"] });
        queryClient.invalidateQueries({ queryKey: ["perf-overview"] });
      } else {
        toast({ title: "Change not applied", description: data.message, variant: "destructive" });
        if (data.cliCommand) setRootError({ message: data.message, cliCommand: data.cliCommand });
      }
    },
    onError: (err) => {
      setDiff(null);
      toast({
        title: "Apply failed",
        description: err instanceof ApiClientError ? err.message : "Unexpected error",
        variant: "destructive",
      });
    },
  });

  const swapMutation = useMutation({
    mutationFn: (vars: { action: "create" | "off"; sizeGB?: number }) =>
      post<ApplyResponse>("/api/performance/swap", vars),
    onSuccess: (data) => {
      setSwapDialogOpen(false);
      if (data.ok) {
        toast({ title: "Swap change applied", description: data.message });
      } else {
        toast({ title: "Swap change not applied", description: data.message, variant: "destructive" });
        if (data.cliCommand) setSwapError({ message: data.message, cliCommand: data.cliCommand });
      }
      queryClient.invalidateQueries({ queryKey: ["perf-advisors"] });
    },
    onError: (err) => {
      toast({
        title: "Swap action failed",
        description: err instanceof ApiClientError ? err.message : "Unexpected error",
        variant: "destructive",
      });
    },
  });

  /* ————— derived chart data ————— */
  const ring = overview.data?.ring ?? [];
  const liveData = useMemo(
    () =>
      ring.map((s) => ({
        t: timeLabel(s.ts),
        cpu: s.cpu,
        mem: s.memTotal ? Math.round((s.memUsed / s.memTotal) * 1000) / 10 : 0,
      })),
    [ring]
  );
  const histData = useMemo(
    () =>
      (history.data?.history ?? []).map((s) => ({
        t: timeLabel(s.ts),
        cpu: s.cpu,
        mem: s.memTotal ? Math.round((s.memUsed / s.memTotal) * 1000) / 10 : 0,
      })),
    [history.data]
  );

  /* ————— derived php tuning (editable max_children / memory_limit) ————— */
  const rec = advisors.data?.php.recommended;
  const currentPhp = advisors.data?.php.current ?? overview.data?.applied.php ?? null;
  const chosen = useMemo<PhpTuning | null>(() => {
    if (!rec) return null;
    const mc = maxChildren ?? rec["pm.max_children"];
    return {
      "pm.max_children": mc,
      "pm.start_servers": Math.max(2, Math.ceil(mc / 4)),
      "pm.min_spare_servers": Math.max(1, Math.ceil(mc / 8)),
      "pm.max_spare_servers": Math.max(Math.ceil(mc / 8) + 1, Math.floor(mc * 0.75)),
      memory_limit: memoryLimit ?? rec.memory_limit,
      "opcache.memory_consumption": rec["opcache.memory_consumption"],
      "opcache.max_accelerated_files": rec["opcache.max_accelerated_files"],
      realpath_cache_size: rec.realpath_cache_size,
      realpath_cache_ttl: rec.realpath_cache_ttl,
    };
  }, [rec, maxChildren, memoryLimit]);

  const chosenSnippet = useMemo(() => {
    if (!chosen) return "";
    return [
      "; — HipnoType Panel · PHP-FPM pool (www.conf) —",
      "pm = dynamic",
      `pm.max_children = ${chosen["pm.max_children"]}`,
      `pm.start_servers = ${chosen["pm.start_servers"]}`,
      `pm.min_spare_servers = ${chosen["pm.min_spare_servers"]}`,
      `pm.max_spare_servers = ${chosen["pm.max_spare_servers"]}`,
      "",
      "; — php.ini overrides —",
      `memory_limit = ${chosen.memory_limit}`,
      "opcache.enable = 1",
      `opcache.memory_consumption = ${chosen["opcache.memory_consumption"]}`,
      `opcache.max_accelerated_files = ${chosen["opcache.max_accelerated_files"]}`,
      "opcache.validate_timestamps = 1",
      "opcache.revalidate_freq = 2",
      `realpath_cache_size = ${chosen.realpath_cache_size}`,
      `realpath_cache_ttl = ${chosen.realpath_cache_ttl}`,
    ].join("\n");
  }, [chosen]);

  const loading = overview.isLoading || !overview.data;

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-72 rounded-lg bg-muted/50 hipno-shimmer" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-32 rounded-xl bg-muted/50 hipno-shimmer" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-72 rounded-xl bg-muted/40 hipno-shimmer lg:col-span-2" />
          <div className="h-72 rounded-xl bg-muted/40 hipno-shimmer" />
        </div>
      </div>
    );
  }

  const m = overview.data.metrics;
  const memPct = m && m.memTotal ? (m.memUsed / m.memTotal) * 100 : 0;
  const diskPct = m && m.diskTotal ? (m.diskUsed / m.diskTotal) * 100 : 0;
  const sw = advisors.data?.swap;
  const net = advisors.data?.network;
  const http = advisors.data?.http;
  const sqlite = advisors.data?.database.sqlite;
  const appliedNet = overview.data.applied.net;
  const appliedHttp = overview.data.applied.http;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      <ViewHeader
        title={
          <>
            Performance <span className="font-[family-name:var(--font-display)] italic text-gradient">center</span>
          </>
        }
        description="Live resource metrics, PHP-FPM &amp; database advisors, swap, network tuning and a slow-server triage — all computed from real host data."
      />

      {/* ————— overview stat cards ————— */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <motion.div variants={fadeUp}>
          <StatCard
            icon={Cpu}
            label="CPU now"
            value={<AnimatedNumber value={m?.cpu ?? 0} format={(n) => `${n.toFixed(1)}%`} />}
            sub={`${m?.cpuPerCore.length ?? 0} cores sampled · 10s interval`}
          />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard
            icon={MemoryStick}
            label="Memory now"
            value={
              <>
                <AnimatedNumber value={m?.memUsed ?? 0} format={(n) => fmtBytes(n)} />
                <span className="text-sm font-normal text-muted-foreground"> / {fmtBytes(m?.memTotal)}</span>
              </>
            }
          />
          <Progress value={memPct} className="h-1.5 mt-3" aria-label={`Memory ${memPct.toFixed(0)}% used`} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard
            icon={HardDrive}
            label="Disk used"
            value={
              <>
                <AnimatedNumber value={m?.diskUsed ?? 0} format={(n) => fmtBytes(n)} />
                <span className="text-sm font-normal text-muted-foreground"> / {fmtBytes(m?.diskTotal)}</span>
              </>
            }
          />
          <Progress value={diskPct} className="h-1.5 mt-3" aria-label={`Disk ${diskPct.toFixed(0)}% used`} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard
            icon={Gauge}
            label="Load average"
            value={<AnimatedNumber value={m?.load1 ?? 0} format={(n) => n.toFixed(2)} />}
            sub={`5m ${m?.load5.toFixed(2) ?? "0.00"} · 15m ${m?.load15.toFixed(2) ?? "0.00"}`}
          />
        </motion.div>
      </div>

      {/* ————— charts + slow-server triage ————— */}
      <div className="grid gap-4 lg:grid-cols-3">
        <motion.div variants={fadeUp} className="lg:col-span-2">
          <SectionCard
            title="CPU & memory"
            description="Last 30 minutes from the live sampler, plus the persisted 24-hour history"
          >
            <div className="space-y-6">
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Last 30 minutes · live ring</p>
                <div className="h-56">
                  {liveData.length < 2 ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Collecting samples — the chart fills as the 10s sampler runs.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={liveData} margin={{ top: 4, right: 4, left: -14, bottom: 0 }}>
                        <defs>
                          <linearGradient id="perfCpuFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="perfMemFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.22} />
                            <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 6" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="t" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" minTickGap={40} tickLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" unit="%" width={38} tickLine={false} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Area type="monotone" dataKey="cpu" name="CPU %" stroke="var(--chart-1)" fill="url(#perfCpuFill)" strokeWidth={2} isAnimationActive={false} />
                        <Area type="monotone" dataKey="mem" name="Memory %" stroke="var(--chart-2)" fill="url(#perfMemFill)" strokeWidth={2} isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">24 hours · per-minute averages</p>
                <div className="h-56">
                  {histData.length < 2 ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Persisted history is still building — samples are stored every 10 seconds.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={histData} margin={{ top: 4, right: 4, left: -14, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 6" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="t" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" minTickGap={40} tickLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" unit="%" width={38} tickLine={false} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Line type="monotone" dataKey="cpu" name="CPU %" stroke="var(--chart-1)" dot={false} strokeWidth={2} />
                        <Line type="monotone" dataKey="mem" name="Memory %" stroke="var(--chart-2)" dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>
          </SectionCard>
        </motion.div>

        {/* ————— why is my server slow ————— */}
        <motion.div variants={fadeUp}>
          <SectionCard
            title={
              <span className="inline-flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" aria-hidden /> Why is my server slow?
              </span>
            }
            description="Top consumers matched against panel websites & apps"
          >
            {slow.isLoading ? (
              <div className="h-48 rounded-lg bg-muted/40 hipno-shimmer" />
            ) : slow.data ? (
              <div className="space-y-4">
                <div
                  role="status"
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed",
                    slow.data.verdictLevel === "ok" && "border-emerald-500/25 bg-emerald-500/[0.06]",
                    slow.data.verdictLevel === "warn" && "border-amber-500/25 bg-amber-500/[0.06]",
                    slow.data.verdictLevel === "fail" && "border-red-500/25 bg-red-500/[0.06]"
                  )}
                >
                  {slow.data.verdict}
                </div>
                {(
                  [
                    ["Top CPU", slow.data.topCpu],
                    ["Top memory", slow.data.topMem],
                  ] as const
                ).map(([label, rows]) => (
                  <div key={label}>
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      {label}
                    </p>
                    <ul className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                      {rows.map((p) => (
                        <li key={`${label}-${p.pid}`} className="text-xs leading-snug">
                          <span className="inline-flex max-w-full items-center gap-1.5">
                            <span className="font-mono text-[11px] text-muted-foreground">{p.pid}</span>
                            <span className="truncate font-medium" title={p.command}>
                              {p.command.split(" ")[0]}
                            </span>
                            {p.matched ? (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                {p.matched.kind === "website" ? "site" : "app"}: {p.matched.label}
                              </span>
                            ) : (
                              <span className="shrink-0 rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                untracked
                              </span>
                            )}
                            <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                              {label === "Top CPU" ? `${p.cpu.toFixed(1)}%` : fmtBytes(p.rssBytes)}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <p className="text-[11px] leading-relaxed text-muted-foreground/80">
                  Processes whose command matches a website docRoot, linux user or app name get a badge; everything else is
                  untracked. {slow.data.untrackedCount} of the sampled processes are untracked.
                </p>
              </div>
            ) : (
              <EmptyState icon={Activity} title="Triage unavailable" description="Process sampling is not available in this environment." />
            )}
          </SectionCard>
        </motion.div>
      </div>

      {/* ————— PHP-FPM advisor + database advisor ————— */}
      <div className="grid gap-4 lg:grid-cols-3">
        <motion.div variants={fadeUp} className="lg:col-span-2">
          <SectionCard
            title={
              <span className="inline-flex items-center gap-2">
                <FileCode2 className="h-4 w-4 text-primary" aria-hidden /> PHP-FPM tuning advisor
              </span>
            }
            description={`Computed from host RAM (${fmtBytes(advisors.data?.php.hostRam ?? 0)}, 75% budget, 512 MB avg worker)`}
            actions={currentPhp ? <StatusChip status="ok" label="applied config" /> : <StatusChip status="na" label="not applied yet" />}
          >
            {advisors.isLoading || !chosen || !rec ? (
              <div className="h-48 rounded-lg bg-muted/40 hipno-shimmer" />
            ) : (
              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="pmc" className="text-xs">pm.max_children</Label>
                      <Input
                        id="pmc"
                        type="number"
                        min={2}
                        max={500}
                        className="mt-1 h-9"
                        value={chosen["pm.max_children"]}
                        onChange={(e) => setMaxChildren(Math.max(2, Math.min(500, Number(e.target.value) || 2)))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="mlim" className="text-xs">memory_limit</Label>
                      <Select value={chosen.memory_limit} onValueChange={(v) => setMemoryLimit(v)}>
                        <SelectTrigger id="mlim" className="mt-1 h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["128M", "256M", "512M"].map((v) => (
                            <SelectItem key={v} value={v}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <table className="w-full text-[13px]">
                    <tbody>
                      {(
                        [
                          ["pm.start_servers", chosen["pm.start_servers"]],
                          ["pm.min_spare_servers", chosen["pm.min_spare_servers"]],
                          ["pm.max_spare_servers", chosen["pm.max_spare_servers"]],
                          ["opcache.memory_consumption", `${chosen["opcache.memory_consumption"]} MB`],
                          ["opcache.max_accelerated_files", chosen["opcache.max_accelerated_files"]],
                          ["realpath_cache_size", chosen.realpath_cache_size],
                          ["realpath_cache_ttl", `${chosen.realpath_cache_ttl}s`],
                        ] as const
                      ).map(([k, v]) => (
                        <tr key={k} className="border-b last:border-0">
                          <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground">{k}</td>
                          <td className="py-1.5 text-right tabular-nums">
                            {currentPhp && String(currentPhp[k as keyof PhpTuning]) !== String(v) ? (
                              <span className="font-semibold text-primary">{String(v)}</span>
                            ) : (
                              String(v)
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      className="hipno-glow"
                      size="sm"
                      onClick={() =>
                        setDiff({
                          title: "Apply PHP-FPM tuning",
                          description:
                            "Values are stored in the panel config; FPM pools are generated per site on the VPS deployment.",
                          section: "php",
                          values: chosen as unknown as Record<string, unknown>,
                          rows: Object.keys(chosen).map((k) => ({
                            label: PHP_LABELS[k] ?? k,
                            old: currentPhp ? String(currentPhp[k as keyof PhpTuning]) : "not set",
                            next: String(chosen[k as keyof PhpTuning]),
                          })),
                        })
                      }
                    >
                      <Zap className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Apply tuning
                    </Button>
                    <CopyButton text={chosenSnippet} label="Copy php.ini / FPM snippet" />
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground/80">
                    {advisors.data?.php.note}
                  </p>
                </div>
                <pre
                  className="max-h-72 overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-foreground/90"
                  aria-label="Generated PHP-FPM and php.ini snippet"
                >
                  {chosenSnippet}
                </pre>
              </div>
            )}
          </SectionCard>
        </motion.div>

        {/* ————— database advisor ————— */}
        <motion.div variants={fadeUp}>
          <SectionCard
            title={
              <span className="inline-flex items-center gap-2">
                <Database className="h-4 w-4 text-primary" aria-hidden /> Database advisor
              </span>
            }
            description="Real PRAGMA inspection of the panel DB"
          >
            <div className="space-y-4">
              {advisors.isLoading || !sqlite ? (
                <div className="h-40 rounded-lg bg-muted/40 hipno-shimmer" />
              ) : (
                <>
                  <table className="w-full text-[13px]">
                    <tbody>
                      {(
                        [
                          ["page_size", sqlite.pageSize ? `${sqlite.pageSize} B` : null],
                          ["journal_mode", sqlite.journalMode],
                          ["wal_autocheckpoint", sqlite.walAutocheckpoint != null ? `${sqlite.walAutocheckpoint} pages` : null],
                          ["db size", sqlite.dbBytes != null ? fmtBytes(sqlite.dbBytes) : null],
                        ] as const
                      ).map(([k, v]) => (
                        <tr key={k} className="border-b last:border-0">
                          <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground">{k}</td>
                          <td className="py-1.5 text-right font-medium">{v ?? "n/a"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <ul className="space-y-1.5">
                    {sqlite.guidance.map((g) => (
                      <li key={g} className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
                        {g}
                      </li>
                    ))}
                  </ul>
                  {[
                    { name: "MariaDB / MySQL", d: advisors.data?.database.mariadb },
                    { name: "PostgreSQL", d: advisors.data?.database.postgres },
                  ].map(({ name, d }) =>
                    d?.available ? (
                      <StatusChip key={name} status="ok" label={`${name} detected`} />
                    ) : (
                      <div key={name} className="rounded-lg border bg-muted/20 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium">{name}</span>
                          <StatusChip status="na" label="not installed" />
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{d?.reason ?? "not installed"}</p>
                      </div>
                    )
                  )}
                </>
              )}
            </div>
          </SectionCard>
        </motion.div>
      </div>

      {/* ————— swap + network + http ————— */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* ————— swap manager ————— */}
        <motion.div variants={fadeUp}>
          <SectionCard
            title={
              <span className="inline-flex items-center gap-2">
                <HardDriveDownload className="h-4 w-4 text-primary" aria-hidden /> Swap manager
              </span>
            }
            description={advisors.data?.swap ? `Totals from /proc/meminfo · devices via ${advisors.data.swap.source}` : "Real swap state from /proc"}
          >
            {advisors.isLoading || !sw ? (
              <div className="h-40 rounded-lg bg-muted/40 hipno-shimmer" />
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-semibold tabular-nums">
                      <AnimatedNumber value={sw.usedBytes} format={(n) => fmtBytes(n)} />
                    </span>
                    <span className="text-xs text-muted-foreground">of {fmtBytes(sw.totalBytes)}</span>
                  </div>
                  <Progress
                    value={sw.totalBytes ? (sw.usedBytes / sw.totalBytes) * 100 : 0}
                    className="mt-2 h-1.5"
                    aria-label={`Swap ${fmtBytes(sw.usedBytes)} of ${fmtBytes(sw.totalBytes)} used`}
                  />
                </div>
                {sw.devices.length > 0 ? (
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b text-left text-[11px] text-muted-foreground">
                        <th className="py-1 pr-3 font-medium">Device</th>
                        <th className="py-1 pr-3 font-medium">Type</th>
                        <th className="py-1 font-medium text-right">Used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sw.devices.map((d) => (
                        <tr key={d.name} className="border-b last:border-0 hover:bg-muted/40">
                          <td className="truncate py-1.5 pr-3 font-mono text-xs" title={d.name}>{d.name}</td>
                          <td className="py-1.5 pr-3 text-muted-foreground">{d.type}</td>
                          <td className="py-1.5 text-right tabular-nums">{fmtBytes(d.usedBytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <EmptyState
                    icon={HardDriveDownload}
                    title="No swap devices active"
                    description="/proc/swaps reports no active swap. A small swap file absorbs memory spikes."
                    className="py-8"
                  />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSwapError(null);
                      setSwapDialogOpen(true);
                    }}
                  >
                    <Zap className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Create swap
                  </Button>
                  {sw.devices.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => swapMutation.mutate({ action: "off" })}
                      disabled={swapMutation.isPending}
                    >
                      {swapMutation.isPending && swapMutation.variables?.action === "off" ? (
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <PackageX className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      )}
                      Swap off
                    </Button>
                  )}
                </div>
                {swapError && <RequiresRootAlert message={swapError.message} cliCommand={swapError.cliCommand} />}
                {!sw.swaponAvailable && (
                  <p className="text-[11px] text-muted-foreground/80">swapon binary not present — reporting /proc/swaps only.</p>
                )}
              </div>
            )}
          </SectionCard>
        </motion.div>

        {/* ————— network tuning ————— */}
        <motion.div variants={fadeUp}>
          <SectionCard
            title={
              <span className="inline-flex items-center gap-2">
                <Network className="h-4 w-4 text-primary" aria-hidden /> Network tuning
              </span>
            }
            description="Congestion control, read from /proc/sys"
          >
            {advisors.isLoading || !net ? (
              <div className="h-40 rounded-lg bg-muted/40 hipno-shimmer" />
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-muted-foreground">Active algorithm:</span>
                  <StatusChip status="ok" label={net.congestionControl} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-muted-foreground">Kernel offers:</span>
                  {net.availableAlgorithms.map((a) => (
                    <span key={a} className="rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px]">
                      {a}
                    </span>
                  ))}
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold">BBR congestion control</span>
                    {appliedNet?.congestionControl === "bbr" ? (
                      <StatusChip status="ok" label="panel pref: bbr" />
                    ) : null}
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    BBR models the connection&apos;s bandwidth and round-trip time to pace sends, instead of waiting for
                    packet loss — usually steadier throughput and lower latency on lossy long-haul links.
                  </p>
                  <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">net.ipv4.tcp_congestion_control=bbr</p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {net.bbrAvailable ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setDiff({
                            title: "Switch congestion control to BBR",
                            description:
                              "The kernel reports bbr as available. The panel attempts the real sysctl write; on a non-root session it returns the CLI command instead.",
                            section: "net",
                            values: { congestionControl: "bbr" },
                            rows: [
                              {
                                label: "net.ipv4.tcp_congestion_control",
                                old: net.congestionControl,
                                next: "bbr",
                              },
                            ],
                          })
                        }
                      >
                        <Zap className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Apply BBR
                      </Button>
                    ) : (
                      <StatusChip status="na" label="bbr not in kernel" />
                    )}
                    {net.congestionControl === "bbr" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setDiff({
                            title: "Restore cubic congestion control",
                            description: "Reverts the algorithm to the kernel default cubic.",
                            section: "net",
                            values: { congestionControl: "cubic" },
                            rows: [
                              {
                                label: "net.ipv4.tcp_congestion_control",
                                old: "bbr",
                                next: "cubic",
                              },
                            ],
                          })
                        }
                      >
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Restore cubic
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground/80">
                  One sentence per setting — switching algorithms only affects new TCP flows; existing connections keep
                  the algorithm they started with.
                </p>
                {rootError && <RequiresRootAlert message={rootError.message} cliCommand={rootError.cliCommand} />}
              </div>
            )}
          </SectionCard>
        </motion.div>

        {/* ————— HTTP features ————— */}
        <motion.div variants={fadeUp}>
          <SectionCard
            title={
              <span className="inline-flex items-center gap-2">
                <Globe className="h-4 w-4 text-primary" aria-hidden /> HTTP features
              </span>
            }
            description="Parsed from the active Caddyfile"
          >
            {advisors.isLoading || !http ? (
              <div className="h-40 rounded-lg bg-muted/40 hipno-shimmer" />
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
                  <p className="font-mono text-[11px] text-foreground/80">{http.caddyFile ?? "no Caddyfile found"}</p>
                  <p className="mt-1.5">{http.note}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-muted-foreground">Compression:</span>
                  {http.encode.length ? (
                    http.encode.map((e) => <StatusChip key={e} status="ok" label={e} />)
                  ) : (
                    <StatusChip status="na" label="none configured" />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-muted-foreground">Static caching:</span>
                  <StatusChip status={http.staticCache ? "ok" : "na"} label={http.staticCache ? "directive found" : "not configured"} />
                  <span className="text-[13px] text-muted-foreground">TLS:</span>
                  <StatusChip status={http.tls ? "ok" : "na"} label={http.tls ? "site blocks" : "none in this file"} />
                </div>
                <div className="space-y-2.5 border-t pt-3">
                  {(
                    [
                      ["brotli", "Brotli compression", "Brotli compresses text ~15-20% smaller than gzip at similar CPU cost; applied to generated per-site Caddyfiles on the VPS."],
                      ["staticCache", "Static asset caching", "Adds Cache-Control / ETag headers for static files so returning visitors skip re-downloading assets."],
                    ] as const
                  ).map(([key, label, blurb]) => {
                    const current = appliedHttp ? appliedHttp[key] : false;
                    return (
                      <div key={key} className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium">{label}</span>
                            <Switch
                              id={`http-${key}`}
                              checked={current}
                              aria-label={label}
                              onCheckedChange={(v) =>
                                setDiff({
                                  title: `HTTP feature: ${label}`,
                                  description:
                                    "Toggles are stored in the panel config and feed the per-site Caddyfile generator on the VPS deployment.",
                                  section: "http",
                                  values: { ...(appliedHttp ?? { brotli: false, staticCache: false }), [key]: v },
                                  rows: [
                                    { label, old: String(current), next: String(v) },
                                  ],
                                })
                              }
                            />
                          </div>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{blurb}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </SectionCard>
        </motion.div>
      </div>

      {/* ————— diff preview dialog ————— */}
      <Dialog open={!!diff} onOpenChange={(o) => !o && setDiff(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{diff?.title}</DialogTitle>
            <DialogDescription>{diff?.description}</DialogDescription>
          </DialogHeader>
          <table className="w-full text-[13px]" aria-label="Diff of values about to be applied">
            <thead>
              <tr className="border-b text-left text-[11px] text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">Setting</th>
                <th className="py-1.5 pr-2 font-medium">Current</th>
                <th className="py-1.5 font-medium">New</th>
              </tr>
            </thead>
            <tbody>
              {diff?.rows.map((r) => (
                <tr key={r.label} className="border-b last:border-0">
                  <td className="py-1.5 pr-2">{r.label}</td>
                  <td className="py-1.5 pr-2 font-mono text-xs text-muted-foreground">{r.old}</td>
                  <td className="py-1.5 font-mono text-xs font-semibold text-primary">{r.next}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiff(null)}>Cancel</Button>
            <Button
              className="hipno-glow"
              disabled={applyMutation.isPending}
              onClick={() => diff && applyMutation.mutate({ section: diff.section, values: diff.values })}
            >
              {applyMutation.isPending ? "Applying…" : "Confirm apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ————— create swap dialog ————— */}
      <Dialog open={swapDialogOpen} onOpenChange={setSwapDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create swap file</DialogTitle>
            <DialogDescription>
              The panel attempts fallocate → chmod 600 → mkswap → swapon as /swapfile. A non-root session gets the exact
              CLI command to run instead.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="swapsize">Size</Label>
            <Select value={swapSize} onValueChange={setSwapSize}>
              <SelectTrigger id="swapsize" aria-label="Swap size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["1", "2", "4"].map((v) => (
                  <SelectItem key={v} value={v}>{v} GB</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSwapDialogOpen(false)}>Cancel</Button>
            <Button
              className="hipno-glow"
              disabled={swapMutation.isPending}
              onClick={() => swapMutation.mutate({ action: "create", sizeGB: Number(swapSize) })}
            >
              {swapMutation.isPending ? "Attempting…" : "Create swap"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
