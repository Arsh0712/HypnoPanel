"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, ApiClientError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldBan,
  RotateCw,
  Loader2,
  Check,
  Copy,
  KeyRound,
  TerminalSquare,
  Server,
  Users,
  ScrollText,
  HardDrive,
  Globe,
  Ban,
  BookOpen,
  Wrench,
  Info,
} from "lucide-react";
import {
  ViewHeader,
  StatCard,
  SectionCard,
  StatusChip,
  EmptyState,
  AnimatedNumber,
} from "@/components/panel/primitives";
import { fadeUp, stagger, EASE_OUT_EXP0 } from "@/components/panel/motion";

/* ————————————————————————————— response types ————————————————————————————— */

type CheckStatus = "pass" | "warn" | "fail" | "na";
type CheckSeverity = "info" | "low" | "medium" | "high" | "critical";

interface SecurityCheck {
  key: string;
  title: string;
  category: "panel" | "ssh" | "firewall" | "system" | "audit" | "disk";
  severity: CheckSeverity;
  status: CheckStatus;
  detail: string;
  fixAction: string | null;
  meta?: Record<string, unknown>;
}

interface ChecksResponse {
  score: number;
  summary: { issues: number; passed: number; notApplicable: number; total: number };
  checks: SecurityCheck[];
  hardening: {
    waf: { installed: boolean; engines: string[]; detail: string };
    isolation: { linuxUser: string; siteCount: number; domains: string[] }[];
  };
  computedAt: string;
}

const CATEGORY_LABELS: Record<SecurityCheck["category"], { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  panel: { label: "Panel", icon: Users },
  ssh: { label: "SSH", icon: KeyRound },
  firewall: { label: "Firewall", icon: ShieldBan },
  system: { label: "System", icon: Server },
  audit: { label: "Audit", icon: ScrollText },
  disk: { label: "Disk", icon: HardDrive },
};

const SEVERITY_STYLES: Record<CheckSeverity, string> = {
  info: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20",
  low: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20",
  medium: "bg-amber-500/14 text-amber-600 dark:text-amber-400 border-amber-500/25",
  high: "bg-orange-500/14 text-orange-600 dark:text-orange-400 border-orange-500/25",
  critical: "bg-red-500/12 text-red-600 dark:text-red-400 border-red-500/25",
};

/* ————————————————————— manual runbook (copyable, never fake-applied) ————————————————————— */

interface Runbook {
  intro: string;
  steps: string[];
  commands?: { label: string; text: string }[];
}

const RUNBOOKS: Record<string, Runbook> = {
  "panel.two_factor": {
    intro: "TOTP is enrolled per admin from the panel itself — no server access needed.",
    steps: [
      "Open Users & Tokens and select an admin listed above.",
      "Enable two-factor authentication and scan the QR code with an authenticator app.",
      "Store the recovery codes somewhere safe — they are the only way in if the device is lost.",
    ],
  },
  "panel.users": {
    intro: "Forced password changes and disabled accounts are managed in Users & Tokens.",
    steps: [
      "Users pending a forced change must set a new password at next login — nothing to clean up here.",
      "Disabled accounts cannot log in; delete them permanently if they are no longer needed.",
    ],
  },
  "panel.lockout": {
    intro: "This check is informational — the panel already rate-limits sign-ins automatically.",
    steps: [
      "Lockout engages after 5 consecutive failures (1/5/15 minutes) per email and per IP.",
      "Failed attempts age out of this one-hour window on their own; there is nothing to reset.",
      "If the count is high and sustained, review the Audit Log for the source addresses involved.",
    ],
  },
  "ssh.root_login": {
    intro: "Direct root login over SSH should be disabled once a regular sudo user exists.",
    steps: [
      "Confirm you can sign in as a non-root user with sudo rights.",
      "Add the hardening snippet below to /etc/ssh/sshd_config.d/10-hardening.conf (or the main sshd_config).",
      "Validate with `sshd -t`, then `sudo systemctl restart ssh` — keep your current session open until you have verified the new one works.",
    ],
    commands: [
      { label: "sshd_config — root login", text: "PermitRootLogin no" },
    ],
  },
  "ssh.password_auth": {
    intro: "Move to key-only authentication before disabling SSH passwords entirely.",
    steps: [
      "Generate a key pair on your machine: `ssh-keygen -t ed25519 -a 100`.",
      "Install it: `ssh-copy-id user@your-server` (or add the public key to ~/.ssh/authorized_keys).",
      "Sign in once with the key to prove it works, then apply the snippet and restart sshd.",
    ],
    commands: [
      {
        label: "sshd_config — key-only sign-in",
        text: "PasswordAuthentication no\nKbdInteractiveAuthentication no\nPubkeyAuthentication yes",
      },
      { label: "validate + restart", text: "sudo sshd -t && sudo systemctl restart ssh" },
    ],
  },
  "firewall.rules": {
    intro: "The panel ships a firewall module that compiles rules into nftables.",
    steps: [
      "Open the Firewall view and allow exactly the ports this server needs (22, 80, 443).",
      "Add deny rules for everything else, then apply the ruleset.",
      "Re-check here afterwards — this check counts enabled rules in the panel database.",
    ],
  },
  "system.updates": {
    intro: "Package upgrades need root on the server itself.",
    steps: [
      "Run the upgrade simulation on the VPS to review what would change.",
      "Apply the upgrade, then re-run this check to confirm the count drops to zero.",
      "Consider enabling unattended-upgrades for security patches.",
    ],
    commands: [
      { label: "simulate", text: "sudo apt-get -s upgrade" },
      { label: "apply", text: "sudo apt update && sudo apt upgrade" },
    ],
  },
  "system.ports": {
    intro: "Every listening port is attack surface — map each one to a process you trust.",
    steps: [
      "List listeners with owning processes (run on the VPS).",
      "Close what you don't recognise, or add a firewall allow/deny rule for it.",
      "The expected set for this panel is 22, 80, 443, 3000–3005 and 8080; anything else deserves a review.",
    ],
    commands: [
      { label: "listening sockets with processes", text: "sudo ss -tlnp" },
    ],
  },
  "system.reboot_required": {
    intro: "A reboot finishes applying kernel and libc updates already staged on disk.",
    steps: [
      "Pick a maintenance window and reboot the server.",
      "After it comes back, this check clears automatically.",
    ],
    commands: [{ label: "reboot", text: "sudo systemctl reboot" }],
  },
  "audit.chain": {
    intro: "A broken hash chain means entries were modified or written outside the chain — treat it seriously.",
    steps: [
      "Export the audit log (Audit Log view) and compare the seq/hash of the entry reported above with any off-panel copy.",
      "If nobody legitimately changed the database, rotate all panel credentials and API tokens and investigate server access.",
    ],
  },
  "disk.headroom": {
    intro: "Free up the root filesystem before it fills — under 5% free most write operations start failing.",
    steps: [
      "Find the biggest directories on the root filesystem.",
      "Trim old journals, package caches and logs (the panel's backups also live under data/backups).",
    ],
    commands: [
      { label: "usage by directory", text: "sudo du -xh --max-depth=1 / | sort -h | tail -20" },
      { label: "trim systemd journals + apt cache", text: "sudo journalctl --vacuum-size=200M && sudo apt-get clean" },
    ],
  },
};

/* ————————————————————————————— small helpers ————————————————————————————— */

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ago`;
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function CopySnippet({ label, text }: { label: string; text: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-start gap-2 rounded-md border bg-muted/50 px-2.5 py-2">
        <TerminalSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">{text}</pre>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1.5 px-2 text-xs"
          aria-label={`Copy: ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            } catch {
              toast({ title: "Clipboard unavailable", description: "Copy the text manually instead.", variant: "destructive" });
            }
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

/** 0–100 score ring with the ember ramp gradient + animated dash offset. */
function ScoreRing({ score }: { score: number }) {
  return (
    <div className="relative h-40 w-40 shrink-0" role="img" aria-label={`Security score ${score} of 100`}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id="secScoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--brand-amber)" />
            <stop offset="100%" stopColor="var(--brand-red)" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r="52" fill="none" stroke="var(--muted)" strokeWidth="9" opacity="0.55" />
        <motion.circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          stroke="url(#secScoreGradient)"
          strokeWidth="9"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="100"
          initial={{ strokeDashoffset: 100 }}
          animate={{ strokeDashoffset: 100 - Math.max(0, Math.min(100, score)) }}
          transition={{ duration: 1.2, ease: EASE_OUT_EXP0 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-4xl font-semibold tracking-tight tabular-nums ${scoreColor(score)}`}>
          <AnimatedNumber value={score} />
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">score / 100</span>
      </div>
    </div>
  );
}

/* ————————————————————————————————— view ————————————————————————————————— */

export function SecurityView() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [runbookKey, setRunbookKey] = useState<string | null>(null);
  const [fixTarget, setFixTarget] = useState<SecurityCheck | null>(null);

  const checks = useQuery<ChecksResponse>({
    queryKey: ["security-checks"],
    queryFn: () => get("/api/security/checks"),
    refetchInterval: 120_000,
  });

  const fix = useMutation({
    mutationFn: (key: string) => post<{ ok: boolean; key: string; revoked: number; note: string }>(`/api/security/checks/${key}/fix`, {}),
    onSuccess: (data) => {
      toast({ title: "Fix applied", description: data.note });
      setFixTarget(null);
      qc.invalidateQueries({ queryKey: ["security-checks"] });
    },
    onError: (e) => {
      toast({
        title: "Fix not applied",
        description: e instanceof ApiClientError ? e.message : "Unexpected error",
        variant: "destructive",
      });
      setFixTarget(null);
    },
  });

  const data = checks.data;
  const byCategory = useMemo(() => {
    if (!data) return [];
    const map = new Map<SecurityCheck["category"], SecurityCheck[]>();
    for (const c of data.checks) {
      const arr = map.get(c.category) || [];
      arr.push(c);
      map.set(c.category, arr);
    }
    return [...map.entries()];
  }, [data]);

  const runbook = runbookKey ? RUNBOOKS[runbookKey] : null;
  const runbookCheck = runbookKey ? data?.checks.find((c) => c.key === runbookKey) : null;

  if (checks.isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-72 rounded-lg bg-muted/50 hipno-shimmer" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-56 rounded-xl bg-muted/50 hipno-shimmer" />
          <div className="h-56 rounded-xl bg-muted/40 hipno-shimmer lg:col-span-2" />
        </div>
        <div className="h-96 rounded-xl bg-muted/40 hipno-shimmer" />
      </div>
    );
  }

  if (checks.isError || !data) {
    return (
      <Card>
        <CardContent className="py-14">
          <EmptyState
            icon={ShieldAlert}
            title="Checks could not be computed"
            description="The security engine reads live host state — something went wrong while gathering it."
            action={<Button variant="outline" onClick={() => checks.refetch()}>Retry</Button>}
          />
        </CardContent>
      </Card>
    );
  }

  const issues = data.summary.issues;
  const passed = data.summary.passed;
  const notApplicable = data.summary.notApplicable;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      <ViewHeader
        title={
          <>
            Security <span className="font-[family-name:var(--font-display)] italic text-gradient">center</span>
          </>
        }
        description="A weighted score computed from live host and panel state — real database queries, /proc, sshd_config, the apt simulation and the audit hash chain. Nothing is simulated."
        actions={
          <Button variant="outline" onClick={() => checks.refetch()} disabled={checks.isFetching}>
            {checks.isFetching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCw className="h-4 w-4" aria-hidden />}
            Re-run checks
          </Button>
        }
      />

      {/* ————— score hero ————— */}
      <motion.div variants={fadeUp}>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="hipno-card">
            <CardContent className="p-6 flex items-center gap-6">
              <ScoreRing score={data.score} />
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-tight">Overall posture</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {issues} issue{issues === 1 ? "" : "s"} · {passed} passed
                  {notApplicable > 0 ? ` · ${notApplicable} n/a` : ""}
                </p>
                <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                  Each applicable check contributes its severity weight; a pass earns it in full, a warning half. Computed{" "}
                  {timeAgo(data.computedAt)}.
                </p>
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
            <StatCard
              icon={ShieldAlert}
              label="Open issues"
              value={<AnimatedNumber value={issues} />}
              sub={issues > 0 ? "warnings and failures to review" : "nothing needs attention"}
              accentClass={issues > 0 ? "bg-red-500/12 text-red-600 dark:text-red-400" : undefined}
            />
            <StatCard
              icon={ShieldCheck}
              label="Passed"
              value={<AnimatedNumber value={passed} />}
              sub={`of ${data.summary.total - notApplicable} applicable checks`}
              accentClass="bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
            />
            <StatCard
              icon={Ban}
              label="Not applicable"
              value={<AnimatedNumber value={notApplicable} />}
              sub="honestly skipped — no backend on this host"
            />
          </div>
        </div>
      </motion.div>

      {/* ————— live checks ————— */}
      <motion.div variants={fadeUp}>
        <SectionCard
          title="Live checks"
          description={`Recomputed from real system state ${timeAgo(data.computedAt)} — the panel database, /etc/ssh/sshd_config, /proc/net/tcp, the apt simulation, the audit hash chain and statfs("/")`}
        >
          <div className="space-y-6">
            {byCategory.map(([cat, list]) => {
              const meta = CATEGORY_LABELS[cat];
              const Icon = meta.icon;
              return (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-2.5">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">{meta.label}</p>
                  </div>
                  <ul className="space-y-2" aria-label={`${meta.label} checks`}>
                    {list.map((c) => (
                      <li
                        key={c.key}
                        className="rounded-lg border bg-card/60 p-3.5 transition-colors hover:bg-muted/30"
                      >
                        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusChip status={c.status} />
                              <p className="text-sm font-medium">{c.title}</p>
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${SEVERITY_STYLES[c.severity]}`}
                              >
                                {c.severity}
                              </span>
                            </div>
                            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{c.detail}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 sm:pt-0.5">
                            {c.fixAction ? (
                              <Button size="sm" variant="outline" onClick={() => setFixTarget(c)}>
                                <Wrench className="h-3.5 w-3.5" aria-hidden /> Fix it
                              </Button>
                            ) : c.status !== "pass" && RUNBOOKS[c.key] ? (
                              <Button size="sm" variant="ghost" className="text-xs" onClick={() => setRunbookKey(c.key)}>
                                <BookOpen className="h-3.5 w-3.5" aria-hidden /> Runbook
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </motion.div>

      {/* ————— hardening ————— */}
      <motion.div variants={fadeUp}>
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard
            title="SSH hardening checklist"
            description="The recommended sshd_config for a single-VPS deployment — apply on the server, the panel never fakes it"
          >
            <ol className="space-y-3" aria-label="SSH hardening steps">
              {[
                {
                  title: "Provision key-only access",
                  body: "ssh-keygen -t ed25519 on your machine, ssh-copy-id onto the server, sign in once to verify.",
                },
                {
                  title: "Disable direct root login",
                  body: "PermitRootLogin no — administrate through a sudo user instead.",
                },
                {
                  title: "Disable password authentication",
                  body: "PasswordAuthentication no + KbdInteractiveAuthentication no once keys are proven to work.",
                },
                {
                  title: "Validate and restart without locking yourself out",
                  body: "sshd -t, then systemctl restart ssh — keep the current session open until the new one is confirmed.",
                },
              ].map((s, i) => (
                <li key={s.title} className="flex gap-3">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary" aria-hidden>
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{s.title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-4 space-y-3">
              <CopySnippet
                label="drop-in file /etc/ssh/sshd_config.d/10-hardening.conf"
                text={"PermitRootLogin no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPubkeyAuthentication yes\nX11Forwarding no"}
              />
              <CopySnippet label="validate + apply" text="sudo sshd -t && sudo systemctl restart ssh" />
              <p className="flex items-start gap-2 text-[11px] text-muted-foreground leading-relaxed">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Editing sshd_config requires root — apply these on the VPS or via the hipno CLI. Order matters: keys first, passwords off second.
              </p>
            </div>
          </SectionCard>

          <div className="space-y-4">
            <SectionCard
              title="Web application firewall"
              description="Probed live via PATH and nginx -V"
              actions={<StatusChip status={data.hardening.waf.installed ? "ok" : "na"} label={data.hardening.waf.installed ? "installed" : "not installed"} />}
            >
              <div className="space-y-3">
                <p className="text-[13px] text-muted-foreground leading-relaxed">{data.hardening.waf.detail}</p>
                {data.hardening.waf.installed ? (
                  <div className="flex flex-wrap gap-1.5">
                    {data.hardening.waf.engines.map((e) => (
                      <Badge key={e} variant="secondary" className="font-mono text-[11px]">{e}</Badge>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs font-medium text-muted-foreground">Recommended for this panel&apos;s stack (Caddy gateway): Coraza</p>
                    <CopySnippet
                      label="install the Coraza Caddy connector on the VPS"
                      text={"sudo apt install coraza-caddy  # or: xcaddy build --with github.com/corazawaf/coraza-caddy\n# then load the OWASP CRS in your Caddyfile"}
                    />
                  </div>
                )}
              </div>
            </SectionCard>

            <SectionCard
              title="Per-site isolation"
              description="Websites grouped by the Linux user that owns their files — one user per site keeps a compromised site off its neighbours"
            >
              {data.hardening.isolation.length === 0 ? (
                <EmptyState
                  icon={Globe}
                  title="No websites registered"
                  description="Sites added through the Websites view are grouped here by their Linux owner."
                  className="py-8"
                />
              ) : (
                <div className="max-h-72 overflow-y-auto -mx-1 px-1 space-y-2" aria-label="Site isolation by Linux user">
                  {data.hardening.isolation.map((g) => (
                    <div key={g.linuxUser} className="flex items-center gap-3 rounded-lg border bg-muted/25 px-3 py-2.5">
                      <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs font-medium" title={g.linuxUser}>{g.linuxUser}</p>
                        <p className="truncate text-[11px] text-muted-foreground" title={g.domains.join(", ")}>
                          {g.domains.join(" · ")}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-[11px]">
                        {g.siteCount} site{g.siteCount === 1 ? "" : "s"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      </motion.div>

      {/* ————— runbook dialog ————— */}
      <Dialog open={!!runbookKey} onOpenChange={(o) => !o && setRunbookKey(null)}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          {runbook && runbookCheck ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 pr-7">
                  <BookOpen className="h-4 w-4 text-primary" aria-hidden /> {runbookCheck.title}
                </DialogTitle>
                <DialogDescription>
                  {runbookCheck.status === "na" ? "Not applicable on this host — the runbook applies to a VPS deployment." : "Manual steps — the panel does not fake an apply button for this."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-[13px] leading-relaxed text-muted-foreground">{runbook.intro}</p>
                <ol className="space-y-2.5" aria-label="Manual steps">
                  {runbook.steps.map((s, i) => (
                    <li key={s} className="flex gap-3">
                      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary" aria-hidden>
                        {i + 1}
                      </span>
                      <p className="text-[13px] leading-relaxed">{s}</p>
                    </li>
                  ))}
                </ol>
                {runbook.commands?.map((c) => <CopySnippet key={c.label} label={c.label} text={c.text} />)}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ————— fix-it confirm ————— */}
      <AlertDialog open={!!fixTarget} onOpenChange={(o) => !o && setFixTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fixTarget?.fixAction}</AlertDialogTitle>
            <AlertDialogDescription>
              {fixTarget?.key === "panel.sessions"
                ? `Every other signed-in session — including other tabs and devices — is revoked immediately. Sessions found: ${Number(fixTarget?.meta?.count ?? 0)}. Your current session stays active.`
                : "This applies the in-panel fix for this check."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={fix.isPending} onClick={() => fixTarget && fix.mutate(fixTarget.key)}>
              {fix.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Wrench className="h-4 w-4" aria-hidden />}
              Apply fix
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
