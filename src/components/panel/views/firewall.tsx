"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, put, del, api, ApiClientError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ShieldAlert,
  ShieldCheck,
  ShieldBan,
  Plus,
  Pencil,
  Trash2,
  Copy,
  Check,
  ChevronDown,
  FileCode2,
  AlertTriangle,
  Loader2,
  RotateCcw,
  Ban,
} from "lucide-react";

// ---------------------------------------------------------------- types

interface FirewallRuleRow {
  id: string;
  action: "allow" | "deny";
  protocol: "tcp" | "udp" | "both";
  portStart: number;
  portEnd: number;
  source: string;
  note: string | null;
  enabled: boolean;
  createdAt: string;
}

interface PendingConfirm {
  deadline: number;
  appliedAt: string;
}

interface FirewallStatus {
  nftAvailable: boolean;
  ruleset: string;
  pendingConfirm: PendingConfirm | null;
  sshPort: number;
  panelPort: number;
}

interface Fail2banInfo {
  available: boolean;
  jails: { name: string; bannedIps: string[] }[];
  note: string;
}

interface ApplyResponse {
  applied: boolean;
  staged?: boolean;
  pendingConfirm?: PendingConfirm | null;
  error?: string;
}

// ---------------------------------------------------------------- rule dialog

interface RuleForm {
  action: "allow" | "deny";
  protocol: "tcp" | "udp" | "both";
  portStart: string;
  portEnd: string;
  source: string;
  note: string;
}

const EMPTY_FORM: RuleForm = {
  action: "allow",
  protocol: "tcp",
  portStart: "",
  portEnd: "",
  source: "any",
  note: "",
};

function RuleDialog({
  open,
  onOpenChange,
  editing,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: FirewallRuleRow | null;
  onSubmit: (form: RuleForm) => void;
  submitting: boolean;
}) {
  const [form, setForm] = useState<RuleForm>(() =>
    editing
      ? {
          action: editing.action,
          protocol: editing.protocol,
          portStart: String(editing.portStart),
          portEnd: String(editing.portEnd),
          source: editing.source,
          note: editing.note || "",
        }
      : { ...EMPTY_FORM, portEnd: "" }
  );

  const set = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const start = Number(form.portStart);
  const end = Number(form.portEnd);
  const portsValid =
    Number.isInteger(start) && start >= 1 && start <= 65535 &&
    Number.isInteger(end) && end >= 1 && end <= 65535 && start <= end;
  const sourceValid = form.source.trim() === "any" || /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(form.source.trim());
  const canSubmit = form.portStart !== "" && form.portEnd !== "" && portsValid && sourceValid && !submitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit firewall rule" : "Add firewall rule"}</DialogTitle>
          <DialogDescription>
            Rules are compiled into the nftables ruleset when you apply it. Deny rules are always emitted before allow rules.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rule-action">Action</Label>
              <Select value={form.action} onValueChange={(v) => set("action", v as RuleForm["action"])}>
                <SelectTrigger id="rule-action" aria-label="Action">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">Allow</SelectItem>
                  <SelectItem value="deny">Deny</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-protocol">Protocol</Label>
              <Select value={form.protocol} onValueChange={(v) => set("protocol", v as RuleForm["protocol"])}>
                <SelectTrigger id="rule-protocol" aria-label="Protocol">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tcp">TCP</SelectItem>
                  <SelectItem value="udp">UDP</SelectItem>
                  <SelectItem value="both">TCP + UDP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rule-port-start">Port start</Label>
              <Input
                id="rule-port-start"
                type="number"
                min={1}
                max={65535}
                inputMode="numeric"
                placeholder="443"
                value={form.portStart}
                onChange={(e) => set("portStart", e.target.value)}
                aria-invalid={form.portStart !== "" && !portsValid}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-port-end">Port end</Label>
              <Input
                id="rule-port-end"
                type="number"
                min={1}
                max={65535}
                inputMode="numeric"
                placeholder="443"
                value={form.portEnd}
                onChange={(e) => set("portEnd", e.target.value)}
                aria-invalid={form.portEnd !== "" && !portsValid}
              />
            </div>
          </div>
          {form.portStart !== "" && form.portEnd !== "" && !portsValid && (
            <p className="text-xs text-destructive" role="alert">
              Ports must be 1–65535 and start must not exceed end.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="rule-source">Source</Label>
            <Input
              id="rule-source"
              placeholder="any or 203.0.113.0/24"
              value={form.source}
              onChange={(e) => set("source", e.target.value)}
              className="font-mono"
              aria-invalid={!sourceValid}
            />
            <p className="text-xs text-muted-foreground">
              “any” or an IPv4 address / CIDR range.
            </p>
            {!sourceValid && (
              <p className="text-xs text-destructive" role="alert">
                Source must be “any” or a valid IPv4 CIDR.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="rule-note">Note (optional)</Label>
            <Textarea
              id="rule-note"
              rows={2}
              maxLength={200}
              placeholder="e.g. HTTPS for the website"
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => onSubmit(form)}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}
            {editing ? "Save changes" : "Add rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- main view

export function FirewallView() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<FirewallRuleRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FirewallRuleRow | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyText, setApplyText] = useState("");
  const [localPending, setLocalPending] = useState<PendingConfirm | null>(null);
  const [stagedNotice, setStagedNotice] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rulesetOpen, setRulesetOpen] = useState(false);

  const statusQuery = useQuery<FirewallStatus>({
    queryKey: ["firewall-status"],
    queryFn: () => get<FirewallStatus>("/api/firewall/status"),
    refetchInterval: 10_000,
  });
  const rulesQuery = useQuery<{ rules: FirewallRuleRow[] }>({
    queryKey: ["firewall-rules"],
    queryFn: () => get<{ rules: FirewallRuleRow[] }>("/api/firewall/rules"),
  });
  const fail2banQuery = useQuery<Fail2banInfo>({
    queryKey: ["firewall-fail2ban"],
    queryFn: () => get<Fail2banInfo>("/api/firewall/fail2ban"),
  });

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ["firewall-status"] });
    void qc.invalidateQueries({ queryKey: ["firewall-rules"] });
  };

  const errMessage = (e: unknown) =>
    e instanceof ApiClientError ? e.message : "Unexpected error";

  // -- mutations
  const createRule = useMutation({
    mutationFn: (form: RuleForm) =>
      post<{ rule: FirewallRuleRow }>("/api/firewall/rules", {
        action: form.action,
        protocol: form.protocol,
        portStart: Number(form.portStart),
        portEnd: Number(form.portEnd),
        source: form.source.trim(),
        note: form.note.trim() || null,
      }),
    onSuccess: () => {
      toast({ title: "Rule created", description: "Apply the ruleset to activate it." });
      setRuleDialogOpen(false);
      invalidateAll();
    },
    onError: (e) => toast({ title: "Could not create rule", description: errMessage(e), variant: "destructive" }),
  });

  const updateRule = useMutation({
    mutationFn: ({ id, form }: { id: string; form: RuleForm }) =>
      put<{ rule: FirewallRuleRow }>(`/api/firewall/rules/${id}`, {
        action: form.action,
        protocol: form.protocol,
        portStart: Number(form.portStart),
        portEnd: Number(form.portEnd),
        source: form.source.trim(),
        note: form.note.trim() || null,
      }),
    onSuccess: () => {
      toast({ title: "Rule updated" });
      setRuleDialogOpen(false);
      invalidateAll();
    },
    onError: (e) => toast({ title: "Could not update rule", description: errMessage(e), variant: "destructive" }),
  });

  const toggleRule = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api<{ rule: FirewallRuleRow }>(`/api/firewall/rules/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => invalidateAll(),
    onError: (e) => {
      toast({ title: "Could not toggle rule", description: errMessage(e), variant: "destructive" });
      invalidateAll();
    },
  });

  const deleteRule = useMutation({
    mutationFn: (id: string) => del(`/api/firewall/rules/${id}`),
    onSuccess: () => {
      toast({ title: "Rule deleted" });
      setDeleteTarget(null);
      invalidateAll();
    },
    onError: (e) => toast({ title: "Could not delete rule", description: errMessage(e), variant: "destructive" }),
  });

  const applyFirewall = useMutation({
    mutationFn: () => post<ApplyResponse>("/api/firewall/apply", { confirm: "APPLY" }),
    onSuccess: (res) => {
      setApplyOpen(false);
      setApplyText("");
      if (res.applied && res.pendingConfirm) {
        setLocalPending(res.pendingConfirm);
        toast({
          title: "Firewall applied",
          description: "Confirm within 60 seconds or the change is rolled back automatically.",
        });
      } else if (res.staged) {
        setStagedNotice(true);
        setRulesetOpen(true);
        toast({
          title: "Ruleset staged (not applied)",
          description: res.error,
        });
      } else {
        toast({ title: "Apply failed", description: res.error, variant: "destructive" });
      }
      invalidateAll();
    },
    onError: (e) => {
      setApplyOpen(false);
      toast({ title: "Apply failed", description: errMessage(e), variant: "destructive" });
    },
  });

  const confirmFirewall = useMutation({
    mutationFn: () => post<{ ok: boolean }>("/api/firewall/confirm"),
    onSuccess: () => {
      setLocalPending(null);
      toast({ title: "Changes kept", description: "The applied ruleset stays active." });
      invalidateAll();
    },
    onError: (e) => toast({ title: "Could not confirm", description: errMessage(e), variant: "destructive" }),
  });

  const rollbackFirewall = useMutation({
    mutationFn: () => post<{ applied: boolean; rolledBack?: boolean; error?: string }>("/api/firewall/rollback"),
    onSuccess: (res) => {
      setLocalPending(null);
      if (res.applied) {
        toast({ title: "Rolled back", description: "The previous ruleset was restored." });
      } else {
        toast({ title: "Rollback", description: res.error, variant: "destructive" });
      }
      invalidateAll();
    },
    onError: (e) => toast({ title: "Rollback failed", description: errMessage(e), variant: "destructive" }),
  });

  // -- pending confirm countdown
  const pending = localPending ?? statusQuery.data?.pendingConfirm ?? null;
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!pending) return;
    const iv = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [pending]);
  const secondsLeft = pending ? Math.max(0, Math.ceil((pending.deadline - nowTick) / 1000)) : 0;
  const effectivePending = pending && pending.deadline > nowTick ? pending : null;
  useEffect(() => {
    if (pending && pending.deadline <= nowTick) {
      // Window expired — the server auto-rolls-back; refresh honest state.
      void qc.invalidateQueries({ queryKey: ["firewall-status"] });
    }
  }, [pending, nowTick, qc]);

  const copyRuleset = async () => {
    const text = statusQuery.data?.ruleset || "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast({ title: "Ruleset copied to clipboard" });
    } catch {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  };

  const rules = rulesQuery.data?.rules ?? [];
  const status = statusQuery.data;
  const busy = createRule.isPending || updateRule.isPending;

  return (
    <div className="space-y-4">
      {/* Pending confirm banner */}
      {effectivePending && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-amber-500/50 bg-amber-50 dark:bg-amber-950/40 p-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-amber-900 dark:text-amber-200">
                Firewall changes applied — confirm within {secondsLeft}s or they will be automatically rolled back
              </p>
              <p className="text-sm text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                Applied at {new Date(effectivePending.appliedAt).toLocaleTimeString()}. If you lose connectivity, wait 60 seconds and the previous ruleset returns.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                onClick={() => confirmFirewall.mutate()}
                disabled={confirmFirewall.isPending}
              >
                {confirmFirewall.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
                ) : (
                  <ShieldCheck className="h-4 w-4 mr-2" aria-hidden />
                )}
                Keep changes
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => rollbackFirewall.mutate()}
                disabled={rollbackFirewall.isPending}
              >
                <RotateCcw className="h-4 w-4 mr-2" aria-hidden />
                Rollback now
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Staged (backend unavailable) banner */}
      {stagedNotice && !pending && (
        <div
          role="status"
          className="rounded-xl border border-amber-500/50 bg-amber-50 dark:bg-amber-950/40 p-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-amber-900 dark:text-amber-200">
                Ruleset staged — not applied
              </p>
              <p className="text-sm text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                The nftables backend is not available in this environment, so nothing was changed on the
                host. The generated config below shows exactly what would be applied on the VPS deployment.
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setStagedNotice(false)} aria-label="Dismiss notice">
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Status card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <ShieldAlert className="h-5 w-5 text-primary" aria-hidden />
            </div>
            <div className="min-w-0">
              <CardTitle>Firewall</CardTitle>
              <CardDescription>
                nftables ruleset compiled from your rules — deny rules win, base policy is accept.
              </CardDescription>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {statusQuery.isLoading ? (
                <div className="h-6 w-36 rounded-full bg-muted animate-pulse" aria-label="Loading status" />
              ) : status?.nftAvailable ? (
                <Badge variant="outline" className="cursor-default border-green-600/50 text-green-700 dark:text-green-400">
                  <ShieldCheck className="h-3 w-3 mr-1" aria-hidden /> nftables available
                </Badge>
              ) : (
                <Badge variant="outline" className="cursor-default border-amber-500/60 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3 mr-1" aria-hidden /> nft backend not available — preview mode
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-start gap-3 rounded-lg border p-3">
            <ShieldCheck className="h-4 w-4 mt-0.5 text-primary shrink-0" aria-hidden />
            <div>
              <p className="text-sm font-medium">SSH port protected</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Port {status?.sshPort ?? "—"} (from Settings). Apply refuses rulesets that would block SSH or the panel.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg border p-3">
            <ShieldCheck className="h-4 w-4 mt-0.5 text-primary shrink-0" aria-hidden />
            <div>
              <p className="text-sm font-medium">Panel port protected</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Port {status?.panelPort ?? "—"}. Applied changes require confirmation within 60s — otherwise automatic rollback.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Rules table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0">
              <CardTitle>Rules</CardTitle>
              <CardDescription>
                {rules.length} rule{rules.length === 1 ? "" : "s"} — changes take effect when you apply the ruleset.
              </CardDescription>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setEditingRule(null);
                  setRuleDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" aria-hidden />
                Add rule
              </Button>
              <Button
                onClick={() => {
                  setApplyText("");
                  setApplyOpen(true);
                }}
                disabled={rulesQuery.isLoading || rules.length === 0}
              >
                <ShieldCheck className="h-4 w-4 mr-2" aria-hidden />
                Apply ruleset
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {rulesQuery.isLoading ? (
            <div className="space-y-2" role="status" aria-label="Loading firewall rules">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : rulesQuery.isError ? (
            <div className="py-10 text-center" role="alert">
              <p className="text-sm text-muted-foreground mb-3">Could not load firewall rules.</p>
              <Button variant="outline" onClick={() => rulesQuery.refetch()}>
                <RotateCcw className="h-4 w-4 mr-2" aria-hidden /> Retry
              </Button>
            </div>
          ) : rules.length === 0 ? (
            <div className="py-12 text-center">
              <Ban className="mx-auto h-10 w-10 text-muted-foreground/50" aria-hidden />
              <p className="mt-3 font-medium">No firewall rules yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                The base ruleset allows established, loopback and ICMP traffic only.
              </p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => {
                  setEditingRule(null);
                  setRuleDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" aria-hidden />
                Add your first rule
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th scope="col" className="py-2 pr-4 font-medium">Action</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Ports</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Protocol</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Source</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Note</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Enabled</th>
                    <th scope="col" className="py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="py-2.5 pr-4">
                        {r.action === "allow" ? (
                          <Badge variant="outline" className="cursor-default border-green-600/50 text-green-700 dark:text-green-400">
                            Allow
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="cursor-default">Deny</Badge>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-xs">
                        {r.portStart === r.portEnd ? r.portStart : `${r.portStart}–${r.portEnd}`}
                      </td>
                      <td className="py-2.5 pr-4">
                        {r.protocol === "both" ? "TCP+UDP" : r.protocol.toUpperCase()}
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-xs">{r.source}</td>
                      <td className="py-2.5 pr-4 max-w-48">
                        <span className="block truncate" title={r.note || undefined}>
                          {r.note || <span className="text-muted-foreground">—</span>}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <Switch
                          checked={r.enabled}
                          onCheckedChange={(enabled) => toggleRule.mutate({ id: r.id, enabled })}
                          aria-label={`${r.enabled ? "Disable" : "Enable"} rule ${r.portStart === r.portEnd ? r.portStart : `${r.portStart}–${r.portEnd}`}`}
                        />
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="inline-flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit rule for port ${r.portStart}`}
                            onClick={() => {
                              setEditingRule(r);
                              setRuleDialogOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            aria-label={`Delete rule for port ${r.portStart}`}
                            onClick={() => setDeleteTarget(r)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Generated ruleset viewer */}
      <Card>
        <Collapsible open={rulesetOpen} onOpenChange={setRulesetOpen}>
          <CardHeader className="pb-3">
            <CollapsibleTrigger asChild>
              <button
                className="flex w-full items-center gap-2 text-left"
                aria-expanded={rulesetOpen}
              >
                <FileCode2 className="h-4 w-4 text-primary shrink-0" aria-hidden />
                <div className="flex-1 min-w-0">
                  <CardTitle>Generated nftables ruleset</CardTitle>
                  <CardDescription>
                    Live compilation of your rules for <code className="font-mono text-xs">table inet hipno</code>.
                  </CardDescription>
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${rulesetOpen ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
              {statusQuery.isLoading ? (
                <div className="h-40 rounded-lg bg-muted animate-pulse" role="status" aria-label="Loading ruleset" />
              ) : statusQuery.isError ? (
                <p className="text-sm text-muted-foreground" role="alert">
                  Could not load the generated ruleset.
                </p>
              ) : (
                <div className="relative">
                  <Button
                    size="sm"
                    variant="outline"
                    className="absolute right-2 top-2"
                    onClick={copyRuleset}
                    aria-label="Copy ruleset to clipboard"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                    ) : (
                      <Copy className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-4 pr-24 font-mono text-xs leading-relaxed whitespace-pre">
                    {statusQuery.data?.ruleset}
                  </pre>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* fail2ban */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <ShieldBan className="h-5 w-5 text-primary" aria-hidden />
            </div>
            <div className="min-w-0">
              <CardTitle>Brute-force protection (fail2ban)</CardTitle>
              <CardDescription>SSH and service jails with automatic IP bans.</CardDescription>
            </div>
            <div className="ml-auto">
              {fail2banQuery.isLoading ? (
                <div className="h-6 w-28 rounded-full bg-muted animate-pulse" aria-label="Loading fail2ban status" />
              ) : fail2banQuery.data?.available ? (
                <Badge variant="outline" className="cursor-default border-green-600/50 text-green-700 dark:text-green-400">
                  Available
                </Badge>
              ) : (
                <Badge variant="outline" className="cursor-default border-amber-500/60 text-amber-700 dark:text-amber-400">
                  Not installed
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {fail2banQuery.isError ? (
            <p className="text-sm text-muted-foreground" role="alert">Could not load fail2ban status.</p>
          ) : fail2banQuery.data?.available ? (
            <div className="space-y-3">
              {fail2banQuery.data.jails.length === 0 ? (
                <p className="text-sm text-muted-foreground">No jails configured.</p>
              ) : (
                <ScrollArea className="max-h-96">
                  <ul className="space-y-3 pr-3">
                    {fail2banQuery.data.jails.map((j) => (
                      <li key={j.name} className="rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{j.name}</span>
                          <Badge variant="secondary" className="cursor-default">
                            {j.bannedIps.length} banned
                          </Badge>
                        </div>
                        {j.bannedIps.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {j.bannedIps.map((ip) => (
                              <span key={ip} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                                {ip}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground mt-1">No IPs currently banned.</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              )}
              <p className="text-xs text-muted-foreground">{fail2banQuery.data.note}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {fail2banQuery.data?.note ||
                "fail2ban is not installed in this environment (VPS deployment installs it) — jails/bans apply there."}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit rule dialog */}
      <RuleDialog
        key={`${ruleDialogOpen}-${editingRule?.id || "new"}`}
        open={ruleDialogOpen}
        onOpenChange={setRuleDialogOpen}
        editing={editingRule}
        submitting={busy}
        onSubmit={(form) => {
          if (editingRule) updateRule.mutate({ id: editingRule.id, form });
          else createRule.mutate(form);
        }}
      />

      {/* Delete rule confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this firewall rule?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  The {deleteTarget.action} rule for{" "}
                  <span className="font-mono">
                    {deleteTarget.protocol === "both" ? "TCP+UDP" : deleteTarget.protocol.toUpperCase()}{" "}
                    {deleteTarget.portStart === deleteTarget.portEnd
                      ? deleteTarget.portStart
                      : `${deleteTarget.portStart}–${deleteTarget.portEnd}`}
                  </span>{" "}
                  from {deleteTarget.source} will be removed from the ruleset. You still need to apply the
                  ruleset for the change to take effect.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteRule.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteRule.mutate(deleteTarget.id);
              }}
            >
              {deleteRule.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}
              Delete rule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Apply — typed confirmation */}
      <AlertDialog open={applyOpen} onOpenChange={(open) => { setApplyOpen(open); if (!open) setApplyText(""); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply the firewall ruleset?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <span className="block">
                  This runs <code className="font-mono text-xs">nft -f</code> with the generated ruleset on the
                  host. The panel protects SSH (port {status?.sshPort ?? 22}) and this panel (port{" "}
                  {status?.panelPort ?? 3000}) from lockout, and any applied change must be confirmed within 60
                  seconds — otherwise it is rolled back automatically.
                </span>
                <span className="block">
                  Type <span className="font-mono font-semibold">APPLY</span> to confirm.
                </span>
                <Input
                  value={applyText}
                  onChange={(e) => setApplyText(e.target.value)}
                  placeholder="APPLY"
                  aria-label="Type APPLY to confirm"
                  className="font-mono"
                  autoComplete="off"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={applyText !== "APPLY" || applyFirewall.isPending}
              onClick={(e) => {
                e.preventDefault();
                applyFirewall.mutate();
              }}
            >
              {applyFirewall.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}
              Apply ruleset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
