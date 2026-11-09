"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, put, del, api, ApiClientError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Activity, BellRing, Plus, Trash2, Bell, Webhook, Send, Mail, MessageSquare, Timer, CheckCircle2, VolumeX, Play } from "lucide-react";

interface MonitorRuleRow {
  id: string; name: string; metric: string; operator: string; threshold: number;
  durationMin: number; severity: string; channelIds: string[]; enabled: boolean;
}
interface AlertRow {
  id: string; ruleId: string | null; ruleName: string; severity: string;
  message: string; state: string; startedAt: string; resolvedAt: string | null;
}
interface ChannelRow {
  id: string; name: string; type: string; lastTestAt: string | null; lastTestOk: boolean | null; createdAt: string;
}

const METRIC_LABELS: Record<string, string> = {
  cpu: "CPU", memory: "Memory", disk: "Disk", load: "Load average",
  tunnel: "Tunnel status", ssl: "SSL expiry", backup: "Backup failure", service: "Service down",
};

function severityBadge(sev: string) {
  if (sev === "critical") return <Badge variant="destructive">critical</Badge>;
  if (sev === "warning") return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40">warning</Badge>;
  return <Badge variant="secondary">info</Badge>;
}

function ruleCondition(r: MonitorRuleRow): string {
  const m = METRIC_LABELS[r.metric] || r.metric;
  const unit = ["cpu", "memory", "disk"].includes(r.metric) ? "%" : "";
  const dur = r.durationMin > 0 ? ` for ${r.durationMin}m` : "";
  return `${m} ${r.operator} ${r.threshold}${unit}${dur}`;
}

export function MonitoringView() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Monitoring &amp; Alerts</h2>
      <Tabs defaultValue="alerts">
        <TabsList>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="channels">Channels</TabsTrigger>
        </TabsList>
        <TabsContent value="alerts"><AlertsTab /></TabsContent>
        <TabsContent value="rules"><RulesTab /></TabsContent>
        <TabsContent value="channels"><ChannelsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------------------------------------------------------- alerts */

function AlertsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const alerts = useQuery<{ alerts: AlertRow[] }>({
    queryKey: ["alerts"],
    queryFn: () => get("/api/monitoring/alerts"),
    refetchInterval: 15_000,
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      api(`/api/monitoring/alerts/${id}`, { method: "PATCH", body: JSON.stringify({ action }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
    onError: (e) => toast({ title: "Failed", description: String(e), variant: "destructive" }),
  });

  if (alerts.isLoading) return <div className="h-40 rounded-xl bg-muted animate-pulse" />;
  const list = alerts.data?.alerts || [];
  const firing = list.filter((a) => a.state === "firing");
  const other = list.filter((a) => a.state !== "firing");

  return (
    <div className="space-y-4">
      {firing.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <CheckCircle2 className="h-9 w-9 mx-auto text-primary" aria-hidden />
            <p className="font-medium">No firing alerts</p>
            <p className="text-sm text-muted-foreground">Everything is healthy. Rules are evaluated every 30 seconds against live metrics.</p>
          </CardContent>
        </Card>
      ) : (
        firing.map((a) => (
          <Card key={a.id} className="border-l-4 border-l-amber-500" data-severity={a.severity}>
            <CardContent className="p-4 flex flex-wrap items-center gap-3">
              <Activity className="h-4 w-4 text-amber-600 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{a.ruleName}</span>
                  {severityBadge(a.severity)}
                </div>
                <p className="text-sm text-muted-foreground">{a.message}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  since {new Date(a.startedAt).toLocaleString()} ({Math.max(1, Math.round((Date.now() - new Date(a.startedAt).getTime()) / 60000))}m)
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => act.mutate({ id: a.id, action: "silence" })}>
                  <VolumeX className="h-3.5 w-3.5" aria-hidden /> Silence
                </Button>
                <Button size="sm" variant="outline" onClick={() => act.mutate({ id: a.id, action: "resolve" })}>
                  Resolve
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
      {other.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">History</CardTitle></CardHeader>
          <CardContent>
            <ul className="max-h-72 overflow-y-auto divide-y text-sm" role="list">
              {other.map((a) => (
                <li key={a.id} className="py-2 flex items-center gap-3">
                  <Badge variant="outline">{a.state}</Badge>
                  <span className="min-w-0 flex-1 truncate">{a.ruleName}: {a.message}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {a.resolvedAt ? new Date(a.resolvedAt).toLocaleString() : new Date(a.startedAt).toLocaleString()}
                  </span>
                  {a.state === "silenced" && (
                    <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: a.id, action: "unsilence" })}>
                      Unsilence
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {alerts.isError && (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          Could not load alerts. <Button variant="link" onClick={() => alerts.refetch()}>Retry</Button>
        </CardContent></Card>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- rules */

const EMPTY_RULE = {
  name: "", metric: "cpu", operator: ">", threshold: "85", durationMin: "5",
  severity: "warning", channelIds: [] as string[],
};

function RulesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const rules = useQuery<{ rules: MonitorRuleRow[] }>({
    queryKey: ["monitor-rules"],
    queryFn: () => get("/api/monitoring/rules"),
  });
  const channels = useQuery<{ channels: ChannelRow[] }>({
    queryKey: ["channels"],
    queryFn: () => get("/api/monitoring/channels"),
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MonitorRuleRow | null>(null);
  const [form, setForm] = useState({ ...EMPTY_RULE });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name, metric: form.metric, operator: form.operator,
        threshold: Number(form.threshold), durationMin: Number(form.durationMin),
        severity: form.severity, channelIds: form.channelIds,
      };
      if (editing) return put(`/api/monitoring/rules/${editing.id}`, payload);
      return post("/api/monitoring/rules", payload);
    },
    onSuccess: () => {
      toast({ title: editing ? "Rule updated" : "Rule created" });
      setDialogOpen(false);
      setEditing(null);
      setForm({ ...EMPTY_RULE });
      qc.invalidateQueries({ queryKey: ["monitor-rules"] });
    },
    onError: (e) => toast({ title: "Failed", description: e instanceof Error ? e.message : "error", variant: "destructive" }),
  });

  const toggle = useMutation({
    mutationFn: (r: MonitorRuleRow) => api(`/api/monitoring/rules/${r.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !r.enabled }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["monitor-rules"] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/monitoring/rules/${id}`),
    onSuccess: () => { toast({ title: "Rule deleted" }); qc.invalidateQueries({ queryKey: ["monitor-rules"] }); },
  });

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY_RULE });
    setDialogOpen(true);
  }
  function openEdit(r: MonitorRuleRow) {
    setEditing(r);
    setForm({
      name: r.name, metric: r.metric, operator: r.operator, threshold: String(r.threshold),
      durationMin: String(r.durationMin), severity: r.severity, channelIds: r.channelIds,
    });
    setDialogOpen(true);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Threshold rules evaluated against real host metrics every 30s.</p>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4" aria-hidden /> New rule</Button>
      </div>
      {rules.isLoading ? (
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      ) : !rules.data?.rules.length ? (
        <Card><CardContent className="py-10 text-center space-y-2">
          <Timer className="h-9 w-9 mx-auto text-muted-foreground" aria-hidden />
          <p className="font-medium">No rules yet</p>
          <p className="text-sm text-muted-foreground">Create one, e.g. “CPU &gt; 85% for 5 minutes → warning”.</p>
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="p-3 font-medium">Rule</th>
                    <th className="p-3 font-medium">Condition</th>
                    <th className="p-3 font-medium">Severity</th>
                    <th className="p-3 font-medium">Channels</th>
                    <th className="p-3 font-medium">On</th>
                    <th className="p-3 font-medium sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.data.rules.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="p-3 font-medium">{r.name}</td>
                      <td className="p-3 font-mono text-xs">{ruleCondition(r)}</td>
                      <td className="p-3">{severityBadge(r.severity)}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {r.channelIds.length === 0 ? "—" : r.channelIds.length + " linked"}
                      </td>
                      <td className="p-3">
                        <Switch
                          checked={r.enabled}
                          onCheckedChange={() => toggle.mutate(r)}
                          aria-label={`Toggle rule ${r.name}`}
                        />
                      </td>
                      <td className="p-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>Edit</Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove.mutate(r.id)}>
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit rule" : "New alert rule"}</DialogTitle>
            <DialogDescription>Evaluated on the server against live metrics.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="rule-name">Name</Label>
              <Input id="rule-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="High CPU" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Metric</Label>
                <Select value={form.metric} onValueChange={(v) => setForm({ ...form, metric: v })}>
                  <SelectTrigger aria-label="Metric"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(METRIC_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Operator</Label>
                <Select value={form.operator} onValueChange={(v) => setForm({ ...form, operator: v })}>
                  <SelectTrigger aria-label="Operator"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value=">">&gt;</SelectItem>
                    <SelectItem value="<">&lt;</SelectItem>
                    <SelectItem value="==">=</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rule-threshold">Threshold</Label>
                <Input id="rule-threshold" inputMode="decimal" value={form.threshold}
                  onChange={(e) => setForm({ ...form, threshold: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="rule-duration">For (minutes)</Label>
                <Input id="rule-duration" inputMode="numeric" value={form.durationMin}
                  onChange={(e) => setForm({ ...form, durationMin: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Severity</Label>
                <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                  <SelectTrigger aria-label="Severity"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">info</SelectItem>
                    <SelectItem value="warning">warning</SelectItem>
                    <SelectItem value="critical">critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notify channels</Label>
              {(channels.data?.channels || []).length === 0 && (
                <p className="text-xs text-muted-foreground">No channels yet — create one in the Channels tab.</p>
              )}
              <div className="space-y-1.5">
                {(channels.data?.channels || []).map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={form.channelIds.includes(c.id)}
                      onCheckedChange={(checked) =>
                        setForm({
                          ...form,
                          channelIds: checked
                            ? [...form.channelIds, c.id]
                            : form.channelIds.filter((x) => x !== c.id),
                        })
                      }
                    />
                    {c.name} <span className="text-xs text-muted-foreground">({c.type})</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button disabled={!form.name || save.isPending} onClick={() => save.mutate()}>Save rule</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* -------------------------------------------------------------- channels */

const CHANNEL_TYPES = [
  { id: "webhook", label: "Webhook", icon: Webhook },
  { id: "telegram", label: "Telegram", icon: Send },
  { id: "discord", label: "Discord", icon: MessageSquare },
  { id: "smtp", label: "Email (SMTP)", icon: Mail },
];

function ChannelsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const channels = useQuery<{ channels: ChannelRow[] }>({
    queryKey: ["channels"],
    queryFn: () => get("/api/monitoring/channels"),
  });
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChannelRow | null>(null);
  const [type, setType] = useState("webhook");
  const [cfg, setCfg] = useState<Record<string, string>>({ secure: "false" });

  const create = useMutation({
    mutationFn: () => {
      const config: Record<string, unknown> = {};
      if (type === "webhook" || type === "discord") config.url = cfg.url;
      if (type === "telegram") { config.botToken = cfg.botToken; config.chatId = cfg.chatId; }
      if (type === "smtp") {
        config.host = cfg.host; config.port = Number(cfg.port || 587);
        config.secure = cfg.secure === "true"; config.from = cfg.from;
        config.user = cfg.user; config.pass = cfg.pass;
      }
      return post("/api/monitoring/channels", { name: cfg.name, type, config });
    },
    onSuccess: () => {
      toast({ title: "Channel created" });
      setAddOpen(false);
      setCfg({ secure: "false" });
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (e) => toast({ title: "Failed", description: e instanceof Error ? e.message : "error", variant: "destructive" }),
  });

  const test = useMutation({
    mutationFn: (id: string) => post<{ ok: boolean; error?: string }>(`/api/monitoring/channels/${id}/test`),
    onSuccess: (r) => {
      if (r.ok) toast({ title: "Test delivered", description: "The notification was sent successfully." });
      else toast({ title: "Test failed (honest result)", description: r.error || "network error", variant: "destructive" });
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/monitoring/channels/${id}`),
    onSuccess: () => { toast({ title: "Channel deleted" }); setDeleteTarget(null); qc.invalidateQueries({ queryKey: ["channels"] }); },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Real HTTP/SMTP attempts — results are reported honestly (this environment may block outbound).
        </p>
        <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" aria-hidden /> Add channel</Button>
      </div>
      {channels.isLoading ? (
        <div className="h-32 rounded-xl bg-muted animate-pulse" />
      ) : !channels.data?.channels.length ? (
        <Card><CardContent className="py-10 text-center space-y-2">
          <Bell className="h-9 w-9 mx-auto text-muted-foreground" aria-hidden />
          <p className="font-medium">No notification channels</p>
          <p className="text-sm text-muted-foreground">Add a webhook, Telegram bot, Discord webhook or SMTP email.</p>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {channels.data.channels.map((c) => {
            const meta = CHANNEL_TYPES.find((t) => t.id === c.type);
            const Icon = meta?.icon || Bell;
            return (
              <Card key={c.id}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Icon className="h-4 w-4" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.lastTestAt
                        ? `last test ${new Date(c.lastTestAt).toLocaleString()} — ${c.lastTestOk ? "ok" : "failed"}`
                        : "never tested"}
                    </p>
                  </div>
                  {c.lastTestOk === true && <Badge variant="default">ok</Badge>}
                  {c.lastTestOk === false && <Badge variant="destructive">failing</Badge>}
                  <Button size="sm" variant="outline" onClick={() => test.mutate(c.id)} disabled={test.isPending}>
                    <Play className="h-3.5 w-3.5" aria-hidden /> Test
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(c)} aria-label={`Delete ${c.name}`}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New notification channel</DialogTitle>
            <DialogDescription>Configurations are encrypted at rest (AES-256-GCM).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="ch-name">Name</Label>
              <Input id="ch-name" value={cfg.name || ""} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} placeholder="Ops webhook" />
            </div>
            <RadioGroup value={type} onValueChange={setType} className="grid grid-cols-4 gap-2">
              {CHANNEL_TYPES.map((t) => (
                <label key={t.id} className="flex flex-col items-center gap-1 rounded-lg border p-2 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5 text-center">
                  <RadioGroupItem value={t.id} className="sr-only" />
                  <t.icon className="h-4 w-4" aria-hidden />
                  <span className="text-xs">{t.label}</span>
                </label>
              ))}
            </RadioGroup>
            {(type === "webhook" || type === "discord") && (
              <div className="space-y-2">
                <Label htmlFor="ch-url">Webhook URL</Label>
                <Input id="ch-url" type="url" value={cfg.url || ""} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} placeholder="https://…" />
              </div>
            )}
            {type === "telegram" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="ch-tg-token">Bot token</Label>
                  <Input id="ch-tg-token" type="password" value={cfg.botToken || ""} onChange={(e) => setCfg({ ...cfg, botToken: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ch-tg-chat">Chat ID</Label>
                  <Input id="ch-tg-chat" value={cfg.chatId || ""} onChange={(e) => setCfg({ ...cfg, chatId: e.target.value })} />
                </div>
              </>
            )}
            {type === "smtp" && (
              <>
                <div className="grid grid-cols-[1fr_100px] gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="ch-smtp-host">Host</Label>
                    <Input id="ch-smtp-host" value={cfg.host || ""} onChange={(e) => setCfg({ ...cfg, host: e.target.value })} placeholder="smtp.example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ch-smtp-port">Port</Label>
                    <Input id="ch-smtp-port" inputMode="numeric" value={cfg.port || "587"} onChange={(e) => setCfg({ ...cfg, port: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ch-smtp-from">From address</Label>
                  <Input id="ch-smtp-from" type="email" value={cfg.from || ""} onChange={(e) => setCfg({ ...cfg, from: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="ch-smtp-user">Username</Label>
                    <Input id="ch-smtp-user" value={cfg.user || ""} onChange={(e) => setCfg({ ...cfg, user: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ch-smtp-pass">Password</Label>
                    <Input id="ch-smtp-pass" type="password" value={cfg.pass || ""} onChange={(e) => setCfg({ ...cfg, pass: e.target.value })} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="ch-smtp-secure" checked={cfg.secure === "true"} onCheckedChange={(v) => setCfg({ ...cfg, secure: String(v) })} />
                  <Label htmlFor="ch-smtp-port">Use TLS (465)</Label>
                </div>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button disabled={!cfg.name || create.isPending} onClick={() => create.mutate()}>Create</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>Linked alert rules will stop notifying through this channel.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
