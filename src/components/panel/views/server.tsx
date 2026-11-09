"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, fmtBytes, fmtDuration, ApiClientError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
  Server as ServerIcon,
  Network,
  Radio,
  HardDrive,
  Package,
  Power,
  Clock,
  Globe2,
  TerminalSquare,
  Copy,
  Check,
  AlertTriangle,
  Search,
  RefreshCw,
  ShieldCheck,
  Timer,
  Wrench,
} from "lucide-react";
import {
  ViewHeader,
  SectionCard,
  StatusChip,
  EmptyState,
} from "@/components/panel/primitives";
import { fadeUp, stagger } from "@/components/panel/motion";

/* ————————————————————————— response types ————————————————————————— */

interface OverviewResponse {
  info: {
    hostname: string;
    distro: string;
    kernel: string;
    arch: string;
    virt: string;
    uptimeSec: number;
    bootTime: string;
    panelVersion: string;
    timezone: { system: string | null; panel: string | null; source: string };
    locale: string | null;
    cpuModel: string;
    cpuCores: number;
  };
  network: {
    interfaces: {
      name: string;
      addr: string;
      cidr: string | null;
      family: string;
      mac: string;
      internal: boolean;
    }[];
    defaultRoute: { iface: string; gateway: string; metric: number } | null;
    dns: string[];
    tcpStates: { state: string; count: number }[];
    bandwidth: { rxBytesSec: number; txBytesSec: number };
  };
  ports: {
    port: number;
    proto: "v4" | "v6";
    address: string;
    service: string;
    known: boolean;
  }[];
  actions: {
    reboot: { scheduledAt: string | null };
    ntp: { available: boolean; status: string | null; detail: string | null };
  };
}

interface DiskResponse {
  mounts: {
    path: string;
    device: string;
    fstype: string;
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usedPct: number;
  }[];
}

interface DuEntry {
  name: string;
  path: string;
  bytes: number;
  files: number;
  dirs: number;
}

interface DuResponse {
  path: string;
  rootBytes: number;
  entries: DuEntry[];
  fileCount: number;
  dirCount: number;
  skipped: number;
  partial: boolean;
  partialReason: string | null;
  elapsedMs: number;
}

interface PackagesResponse {
  available: boolean;
  manager: string;
  updates: {
    pkg: string;
    current: string | null;
    candidate: string;
    security: boolean;
    repo: string;
  }[];
  securityCount: number;
  held: string[];
  rebootRequired: boolean;
  note?: string;
}

interface ActionResult {
  ok: boolean;
  requiresRoot?: boolean;
  message: string;
  cliCommand?: string;
  scheduledAt?: string;
}

/* ————————————————————————— helpers ————————————————————————— */

const FALLBACK_TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Moscow",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Sao_Paulo",
];

function timezoneList(): string[] {
  if (typeof Intl !== "undefined") {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf;
    const list = supported?.call(Intl, "timeZone");
    if (list?.length) return list;
  }
  return FALLBACK_TIMEZONES;
}

function fmtCountdown(seconds: number): string {
  if (seconds <= 0) return "due now";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

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

/* ————————————————————————— view ————————————————————————— */

export function ServerView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [duPath, setDuPath] = useState("/home/z/my-project");
  const [duResult, setDuResult] = useState<DuResponse | null>(null);
  const [hostDialogOpen, setHostDialogOpen] = useState(false);
  const [newHostname, setNewHostname] = useState("");
  const [rebootAt, setRebootAt] = useState("");
  const [tzValue, setTzValue] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ message: string; cliCommand: string } | null>(null);
  const [updateError, setUpdateError] = useState<{ message: string; cliCommand: string } | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const overview = useQuery<OverviewResponse>({
    queryKey: ["server-overview"],
    queryFn: () => get<OverviewResponse>("/api/server/overview"),
    refetchInterval: 10_000,
  });
  const disk = useQuery<DiskResponse>({
    queryKey: ["server-disk"],
    queryFn: () => get<DiskResponse>("/api/server/disk"),
  });
  const packages = useQuery<PackagesResponse>({
    queryKey: ["server-packages"],
    queryFn: () => get<PackagesResponse>("/api/server/packages"),
    refetchInterval: 60_000,
  });

  const duMutation = useMutation({
    mutationFn: (vars: { path: string }) => post<DuResponse>("/api/server/disk", vars),
    onSuccess: (data) => {
      setDuResult(data);
      if (data.partial) {
        toast({
          title: "Analysis completed partially",
          description: `${data.partialReason} — results below are partial but real.`,
        });
      }
    },
    onError: (err) => {
      toast({
        title: "Analysis failed",
        description: err instanceof ApiClientError ? err.message : "Unexpected error",
        variant: "destructive",
      });
    },
  });

  const actionMutation = useMutation({
    mutationFn: (vars: Record<string, unknown> & { action: string }) =>
      post<ActionResult>("/api/server/actions", vars),
    onSuccess: (data, vars) => {
      setActionError(null);
      if (data.ok) {
        toast({ title: "Action applied", description: data.message });
        if (vars.action === "reboot_schedule" && data.scheduledAt) {
          toast({ title: "Reboot scheduled", description: new Date(data.scheduledAt).toLocaleString() });
        }
      } else {
        toast({ title: "Action not applied", description: data.message, variant: "destructive" });
        if (data.cliCommand) setActionError({ message: data.message, cliCommand: data.cliCommand });
      }
      queryClient.invalidateQueries({ queryKey: ["server-overview"] });
    },
    onError: (err) => {
      toast({
        title: "Action failed",
        description: err instanceof ApiClientError ? err.message : "Unexpected error",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { mode: "all" | "security" }) =>
      post<ActionResult>("/api/server/packages/update", vars),
    onSuccess: (data) => {
      if (data.ok) {
        toast({ title: "Update finished", description: data.message });
      } else {
        toast({ title: "Update not applied", description: data.message, variant: "destructive" });
        if (data.cliCommand) setUpdateError({ message: data.message, cliCommand: data.cliCommand });
      }
      queryClient.invalidateQueries({ queryKey: ["server-packages"] });
    },
    onError: (err) => {
      toast({
        title: "Update failed",
        description: err instanceof ApiClientError ? err.message : "Unexpected error",
        variant: "destructive",
      });
    },
  });

  const tzs = useMemo(() => timezoneList(), []);
  const maxBytes = duResult?.entries[0]?.bytes ?? 0;

  if (overview.isLoading || !overview.data) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-72 rounded-lg bg-muted/50 hipno-shimmer" />
        <div className="h-44 rounded-xl bg-muted/50 hipno-shimmer" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-72 rounded-xl bg-muted/40 hipno-shimmer lg:col-span-2" />
          <div className="h-72 rounded-xl bg-muted/40 hipno-shimmer" />
        </div>
      </div>
    );
  }

  const { info, network, ports, actions } = overview.data;
  const rebootScheduled = actions.reboot.scheduledAt ? new Date(actions.reboot.scheduledAt) : null;
  const rebootRemaining = rebootScheduled
    ? Math.floor((rebootScheduled.getTime() - now) / 1000)
    : null;
  const systemTz = tzValue ?? info.timezone.panel ?? info.timezone.system;

  const infoRows: [string, string][] = [
    ["Hostname", info.hostname],
    ["Distribution", info.distro],
    ["Kernel", info.kernel],
    ["Architecture", info.arch],
    ["Virtualization", info.virt],
    ["Uptime", fmtDuration(info.uptimeSec)],
    ["Boot time", new Date(info.bootTime).toLocaleString()],
    ["Panel version", info.panelVersion],
    ["Timezone", `${info.timezone.system ?? "unknown"} (source: ${info.timezone.source})`],
    ["Locale", info.locale ?? "not set (honest n/a)"],
    ["CPU", `${info.cpuCores}× ${info.cpuModel}`],
  ];

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      <ViewHeader
        title={
          <>
            Server <span className="font-[family-name:var(--font-display)] italic text-gradient">management</span>
          </>
        }
        description="Host identity, network, listening ports, disk analysis, package updates and power actions — read from /proc, /etc and the OS."
      />

      {/* ————— info grid ————— */}
      <motion.div variants={fadeUp}>
        <SectionCard
          title={
            <span className="inline-flex items-center gap-2">
              <ServerIcon className="h-4 w-4 text-primary" aria-hidden /> Host information
            </span>
          }
          description="Real reads from os, /etc/os-release and systemd-detect-virt"
          actions={<StatusChip status="ok" label={`up ${fmtDuration(info.uptimeSec)}`} />}
        >
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
            {infoRows.map(([k, v]) => (
              <div key={k} className="min-w-0 border-b border-dashed pb-2.5 last:border-0">
                <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{k}</dt>
                <dd className="mt-0.5 truncate text-[13px] font-medium" title={v}>
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </SectionCard>
      </motion.div>

      {/* ————— network + ports ————— */}
      <div className="grid gap-4 lg:grid-cols-3">
        <motion.div variants={fadeUp} className="lg:col-span-2">
          <SectionCard
            title={
              <span className="inline-flex items-center gap-2">
                <Network className="h-4 w-4 text-primary" aria-hidden /> Network overview
              </span>
            }
            description="Interfaces, default route, resolvers and connection states"
          >
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]" aria-label="Network interfaces">
                  <thead>
                    <tr className="border-b text-left text-[11px] text-muted-foreground">
                      <th className="py-1.5 pr-4 font-medium">Interface</th>
                      <th className="py-1.5 pr-4 font-medium">Address</th>
                      <th className="py-1.5 pr-4 font-medium">Family</th>
                      <th className="py-1.5 pr-4 font-medium">MAC</th>
                      <th className="py-1.5 font-medium">Scope</th>
                    </tr>
                  </thead>
                  <tbody>
                    {network.interfaces.map((i, idx) => (
                      <tr key={`${i.name}-${i.addr}-${idx}`} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="py-1.5 pr-4 font-mono text-xs">{i.name}</td>
                        <td className="py-1.5 pr-4 font-mono text-xs">
                          {i.addr}
                          {i.cidr && <span className="text-muted-foreground">/{i.cidr}</span>}
                        </td>
                        <td className="py-1.5 pr-4 text-muted-foreground">{i.family}</td>
                        <td className="py-1.5 pr-4 font-mono text-xs text-muted-foreground">{i.mac}</td>
                        <td className="py-1.5">
                          {i.internal ? <StatusChip status="info" label="internal" /> : <StatusChip status="ok" label="external" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border bg-muted/20 px-3 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    Default route
                  </p>
                  {network.defaultRoute ? (
                    <p className="mt-1 font-mono text-[13px]">
                      via {network.defaultRoute.gateway} · {network.defaultRoute.iface}
                      <span className="text-muted-foreground"> (metric {network.defaultRoute.metric})</span>
                    </p>
                  ) : (
                    <p className="mt-1 text-[13px] text-muted-foreground">not found in /proc/net/route</p>
                  )}
                </div>
                <div className="rounded-lg border bg-muted/20 px-3 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    DNS resolvers
                  </p>
                  <p className="mt-1 font-mono text-[13px]">{network.dns.length ? network.dns.join(" · ") : "none in /etc/resolv.conf"}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-muted-foreground">TCP states (v4+v6):</span>
                {network.tcpStates.length ? (
                  network.tcpStates.map((s) => (
                    <StatusChip
                      key={s.state}
                      status={s.state === "ESTABLISHED" ? "ok" : s.state === "LISTEN" ? "info" : s.state === "TIME_WAIT" || s.state === "CLOSE_WAIT" ? "warn" : "na"}
                      label={`${s.state.toLowerCase()} ${s.count}`}
                    />
                  ))
                ) : (
                  <StatusChip status="na" label="no tcp sockets" />
                )}
              </div>
              <div className="rounded-lg border bg-muted/20 px-3 py-2.5 text-[13px]">
                <span className="text-muted-foreground">Aggregate bandwidth (all interfaces, live sampler): </span>
                <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">↓ {fmtBytes(network.bandwidth.rxBytesSec)}/s</span>
                <span className="text-muted-foreground"> · </span>
                <span className="font-semibold tabular-nums">{fmtBytes(network.bandwidth.txBytesSec)}/s ↑</span>
              </div>
            </div>
          </SectionCard>
        </motion.div>

        {/* ————— listening ports ————— */}
        <motion.div variants={fadeUp}>
          <SectionCard
            title={
              <span className="inline-flex items-center gap-2">
                <Radio className="h-4 w-4 text-primary" aria-hidden /> Listening ports
              </span>
            }
            description="Parsed from /proc/net/tcp{,6} · state 0A"
          >
            {ports.length ? (
              <div className="max-h-96 overflow-y-auto pr-1">
                <table className="w-full text-[13px]" aria-label="Listening ports">
                  <thead>
                    <tr className="border-b text-left text-[11px] text-muted-foreground">
                      <th className="py-1.5 pr-3 font-medium">Port</th>
                      <th className="py-1.5 pr-3 font-medium">Proto</th>
                      <th className="py-1.5 pr-3 font-medium">Address</th>
                      <th className="py-1.5 font-medium">Service</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ports.map((p) => (
                      <tr key={`${p.proto}-${p.port}-${p.address}`} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="py-1.5 pr-3 font-mono tabular-nums">{p.port}</td>
                        <td className="py-1.5 pr-3 text-muted-foreground">{p.proto}</td>
                        <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground">{p.address}</td>
                        <td className="py-1.5">
                          {p.known ? (
                            <span className="text-[13px]">{p.service}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                              <AlertTriangle className="h-3 w-3" aria-hidden /> {p.service} — review
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={Radio} title="No listening sockets" description="Nothing is bound on this host right now." />
            )}
          </SectionCard>
        </motion.div>
      </div>

      {/* ————— disk analyser + actions ————— */}
      <div className="grid gap-4 lg:grid-cols-3">
        <motion.div variants={fadeUp} className="lg:col-span-2">
          <SectionCard
            title={
              <span className="inline-flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-primary" aria-hidden /> Disk analyser
              </span>
            }
            description="statfs per mount plus a real async directory walk"
          >
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                {disk.data?.mounts.map((mt) => (
                  <div key={mt.path} className="rounded-lg border bg-muted/20 p-3 transition-all duration-300 hover:-translate-y-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-sm font-semibold">{mt.path}</span>
                      <span className={cn("text-xs tabular-nums", mt.usedPct > 85 ? "text-red-500" : mt.usedPct > 70 ? "text-amber-500" : "text-muted-foreground")}>
                        {mt.usedPct.toFixed(0)}%
                      </span>
                    </div>
                    <Progress value={mt.usedPct} className="mt-2 h-1.5" aria-label={`${mt.path} ${mt.usedPct.toFixed(0)}% used`} />
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      {fmtBytes(mt.usedBytes)} / {fmtBytes(mt.totalBytes)} · {mt.fstype}
                    </p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground/70" title={mt.device}>{mt.device}</p>
                  </div>
                ))}
                {disk.isLoading && <div className="h-24 rounded-lg bg-muted/40 hipno-shimmer sm:col-span-3" />}
              </div>

              <div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Label htmlFor="du-path" className="text-xs">Analyse a directory (within panel roots)</Label>
                    <Input
                      id="du-path"
                      className="mt-1 h-9 font-mono text-xs"
                      value={duPath}
                      onChange={(e) => setDuPath(e.target.value)}
                      placeholder="/home/z/my-project"
                      aria-label="Directory path to analyse"
                    />
                  </div>
                  <Button
                    size="sm"
                    className="hipno-glow h-9"
                    disabled={duMutation.isPending}
                    onClick={() => duMutation.mutate({ path: duPath })}
                  >
                    {duMutation.isPending ? (
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Search className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    )}
                    {duMutation.isPending ? "Walking…" : "Analyse"}
                  </Button>
                </div>
                {duResult && (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        <span className="font-semibold text-foreground">{fmtBytes(duResult.rootBytes)}</span> under{" "}
                        <span className="font-mono">{duResult.path}</span>
                      </span>
                      <span>{duResult.fileCount.toLocaleString()} files · {duResult.dirCount.toLocaleString()} dirs</span>
                      <span>{duResult.elapsedMs} ms</span>
                      {duResult.skipped > 0 && <span>{duResult.skipped} entries unreadable (skipped)</span>}
                    </div>
                    {duResult.partial && (
                      <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2 text-xs leading-relaxed">
                        Walk stopped early: {duResult.partialReason}. The bars below show the directories measured so far —
                        partial but real.
                      </div>
                    )}
                    <div className="space-y-2.5">
                      {duResult.entries.map((e, i) => (
                        <div key={e.path}>
                          <div className="flex items-baseline justify-between gap-3 text-[13px]">
                            <span className="min-w-0 truncate font-mono text-xs" title={e.path}>
                              {e.name}
                            </span>
                            <span className="shrink-0 tabular-nums">{fmtBytes(e.bytes)}</span>
                          </div>
                          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${maxBytes ? Math.max(2, (e.bytes / maxBytes) * 100) : 0}%` }}
                              transition={{ duration: 0.6, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
                              className={cn("h-full rounded-full", i === 0 ? "bg-primary" : i < 3 ? "bg-primary/70" : "bg-primary/40")}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </SectionCard>
        </motion.div>

        {/* ————— actions card ————— */}
        <motion.div variants={fadeUp}>
          <SectionCard
            title={
              <span className="inline-flex items-center gap-2">
                <Wrench className="h-4 w-4 text-primary" aria-hidden /> Actions
              </span>
            }
            description="Reboot, hostname, timezone & NTP"
          >
            <div className="space-y-4">
              {/* scheduled reboot */}
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  <Power className="h-3.5 w-3.5 text-primary" aria-hidden /> Scheduled reboot
                </div>
                {rebootScheduled ? (
                  <div className="mt-2.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">{rebootScheduled.toLocaleString()}</span>
                      <StatusChip status={rebootRemaining != null && rebootRemaining < 300 ? "warn" : "info"} label={fmtCountdown(rebootRemaining ?? 0)} />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Timer className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {rebootRemaining != null && rebootRemaining <= 0
                        ? "due — the on-server agent triggers the reboot"
                        : "the panel stores the schedule; the on-server hipno agent performs the reboot"}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      disabled={actionMutation.isPending}
                      onClick={() => actionMutation.mutate({ action: "reboot_cancel" })}
                    >
                      Cancel reboot
                    </Button>
                  </div>
                ) : (
                  <div className="mt-2.5 space-y-2">
                    <Input
                      type="datetime-local"
                      aria-label="Reboot date and time"
                      value={rebootAt}
                      onChange={(e) => setRebootAt(e.target.value)}
                      className="h-9 text-xs"
                    />
                    <Button
                      size="sm"
                      className="w-full hipno-glow"
                      disabled={!rebootAt || actionMutation.isPending}
                      onClick={() => actionMutation.mutate({ action: "reboot_schedule", at: new Date(rebootAt).toISOString() })}
                    >
                      <Clock className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Schedule reboot
                    </Button>
                  </div>
                )}
              </div>

              {/* hostname */}
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">Hostname</p>
                    <p className="truncate font-mono text-xs text-muted-foreground" title={info.hostname}>{info.hostname}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => { setNewHostname(""); setHostDialogOpen(true); }}>
                    Change
                  </Button>
                </div>
              </div>

              {/* timezone */}
              <div className="rounded-lg border bg-muted/20 p-3">
                <Label htmlFor="tz-select" className="text-[13px] font-medium">Timezone</Label>
                <Select value={systemTz ?? undefined} onValueChange={(v) => setTzValue(v)}>
                  <SelectTrigger id="tz-select" className="mt-1.5 h-9 text-xs" aria-label="System timezone">
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {tzs.map((tz) => (
                      <SelectItem key={tz} value={tz} className="text-xs">{tz}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 w-full"
                  disabled={!tzValue || actionMutation.isPending}
                  onClick={() => tzValue && actionMutation.mutate({ action: "timezone", timezone: tzValue })}
                >
                  <Globe2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Apply timezone
                </Button>
              </div>

              {/* NTP */}
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">NTP time sync</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {actions.ntp.detail ?? actions.ntp.status ?? "unknown"}
                    </p>
                  </div>
                  <StatusChip
                    status={actions.ntp.available && actions.ntp.status ? "ok" : "na"}
                    label={actions.ntp.available && actions.ntp.status ? "synced" : "n/a"}
                  />
                </div>
              </div>

              {actionError && <RequiresRootAlert message={actionError.message} cliCommand={actionError.cliCommand} />}
            </div>
          </SectionCard>
        </motion.div>
      </div>

      {/* ————— package updates ————— */}
      <motion.div variants={fadeUp}>
        <SectionCard
          title={
            <span className="inline-flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" aria-hidden /> Package updates
              </span>
          }
          description={packages.data?.available ? `${packages.data.updates.length} updates · ${packages.data.securityCount} security` : "apt package management"}
          actions={
            packages.data?.available ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={packages.data.updates.length === 0 || updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ mode: "security" })}
                >
                  <ShieldCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {packages.data.securityCount > 0 ? `Security only (${packages.data.securityCount})` : "Security only"}
                </Button>
                <Button
                  size="sm"
                  className="hipno-glow"
                  disabled={packages.data.updates.length === 0 || updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ mode: "all" })}
                >
                  {updateMutation.isPending ? "Updating…" : `Update all (${packages.data.updates.length})`}
                </Button>
              </div>
            ) : undefined
          }
        >
          {packages.isLoading ? (
            <div className="h-40 rounded-lg bg-muted/40 hipno-shimmer" />
          ) : !packages.data?.available ? (
            <EmptyState
              icon={Package}
              title="Package manager unavailable"
              description={packages.data?.note ?? "No apt-get binary on this host — package management applies to the VPS deployment."}
            />
          ) : (
            <div className="space-y-3">
              {packages.data.rebootRequired && (
                <div role="alert" className="flex items-center gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2.5 text-[13px]">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                  A reboot is required to finish installing pending updates (/var/run/reboot-required).
                </div>
              )}
              {packages.data.held.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Held packages: <span className="font-mono">{packages.data.held.join(", ")}</span>
                </p>
              )}
              {packages.data.updates.length === 0 ? (
                <EmptyState
                  icon={ShieldCheck}
                  title="All packages up to date"
                  description={`apt-get simulation reports no pending upgrades${packages.data.held.length ? " (held packages excluded)" : ""}.`}
                  className="py-10"
                />
              ) : (
                <div className="max-h-80 overflow-y-auto pr-1">
                  <table className="w-full text-[13px]" aria-label="Available package updates">
                    <thead>
                      <tr className="border-b text-left text-[11px] text-muted-foreground">
                        <th className="py-1.5 pr-3 font-medium">Package</th>
                        <th className="py-1.5 pr-3 font-medium">Current</th>
                        <th className="py-1.5 pr-3 font-medium">Candidate</th>
                        <th className="py-1.5 font-medium">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {packages.data.updates.map((u) => (
                        <tr key={u.pkg} className="border-b last:border-0 hover:bg-muted/40">
                          <td className="py-1.5 pr-3 font-mono text-xs">
                            {u.pkg}
                            {u.security && (
                              <span className="ml-2 rounded-full border border-red-500/25 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                                security
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground">{u.current ?? "—"}</td>
                          <td className="py-1.5 pr-3 font-mono text-xs">{u.candidate}</td>
                          <td className="max-w-40 truncate py-1.5 text-xs text-muted-foreground" title={u.repo}>{u.repo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {updateError && <RequiresRootAlert message={updateError.message} cliCommand={updateError.cliCommand} />}
              <p className="text-[11px] leading-relaxed text-muted-foreground/80">
                Parsed from a real <span className="font-mono">apt-get -s upgrade</span> simulation. Applying updates runs
                the real apt transaction — non-root sessions get the hypno CLI command.
              </p>
            </div>
          )}
        </SectionCard>
      </motion.div>

      {/* ————— hostname dialog ————— */}
      <Dialog open={hostDialogOpen} onOpenChange={setHostDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set hostname</DialogTitle>
            <DialogDescription>
              RFC 1123 names only — letters, digits and hyphens, 253 characters max. The panel attempts the real change;
              a non-root session receives the CLI command instead.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="hostname-input">New hostname</Label>
            <Input
              id="hostname-input"
              className="font-mono text-xs"
              placeholder="web-01.example.com"
              value={newHostname}
              onChange={(e) => setNewHostname(e.target.value)}
              aria-invalid={newHostname.length > 0 && !HOSTNAME_RE.test(newHostname)}
            />
            {newHostname.length > 0 && !HOSTNAME_RE.test(newHostname) && (
              <p role="alert" className="text-xs text-red-500">
                Not a valid RFC 1123 hostname (labels of letters/digits/hyphens, no leading or trailing hyphen).
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHostDialogOpen(false)}>Cancel</Button>
            <Button
              className="hipno-glow"
              disabled={!HOSTNAME_RE.test(newHostname) || actionMutation.isPending}
              onClick={() => {
                actionMutation.mutate({ action: "hostname", hostname: newHostname });
                setHostDialogOpen(false);
              }}
            >
              {actionMutation.isPending ? "Applying…" : "Set hostname"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
