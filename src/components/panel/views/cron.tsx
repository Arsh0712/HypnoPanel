"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, put, api, ApiClientError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CalendarClock, Play, Trash2, Pencil, History, Plus, Loader2, CircleCheck, CircleX, Clock3 } from "lucide-react";

interface CronRun {
  id: string; startedAt: string; finishedAt: string | null; exitCode: number | null; output: string | null; trigger: string;
}
interface CronJob {
  id: string; name: string; schedule: string; command: string; runAs: string;
  enabled: boolean; lastRunAt: string | null; createdAt: string; runs: CronRun[];
}

function humanSchedule(cron: string): string {
  const [min, hour, dom, mon, dow] = cron.trim().split(/\s+/);
  if (cron === "* * * * *") return "Every minute";
  if (min!.startsWith("*/") && hour === "*") return `Every ${min!.slice(2)} minutes`;
  if (hour === "*") return `Every hour at :${min!.padStart(2, "0")}`;
  if (dom === "*" && dow === "*" && mon === "*") return `Daily at ${hour!.padStart(2, "0")}:${min!.padStart(2, "0")}`;
  if (dom === "*" && mon === "*") return `Weekly (${dow}) at ${hour!.padStart(2, "0")}:${min!.padStart(2, "0")}`;
  if (dow === "*" && mon === "*") return `Monthly on day ${dom} at ${hour!.padStart(2, "0")}:${min!.padStart(2, "0")}`;
  return "Custom schedule";
}

type Preset = "minute" | "hourly" | "daily" | "weekly" | "monthly" | "custom";

export function CronView() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const jobs = useQuery<{ jobs: CronJob[] }>({
    queryKey: ["cron"],
    queryFn: () => get("/api/cron"),
    refetchInterval: 15_000,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CronJob | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CronJob | null>(null);
  const [historyJob, setHistoryJob] = useState<CronJob | null>(null);

  // form state
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<Preset>("daily");
  const [custom, setCustom] = useState("*/5 * * * *");
  const [time, setTime] = useState("03:00");
  const [weekday, setWeekday] = useState("1");
  const [monthDay, setMonthDay] = useState("1");
  const [command, setCommand] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [preview, setPreview] = useState<{ next: string[]; human: string } | null>(null);

  const schedule = (() => {
    const [h, m] = time.split(":");
    switch (preset) {
      case "minute": return "* * * * *";
      case "hourly": return `${Number(m) || 0} * * * *`;
      case "daily": return `${Number(m) || 0} ${Number(h) || 0} * * *`;
      case "weekly": return `${Number(m) || 0} ${Number(h) || 0} * * ${weekday}`;
      case "monthly": return `${Number(m) || 0} ${Number(h) || 0} ${monthDay} * *`;
      default: return custom.trim();
    }
  })();

  useEffect(() => {
    if (!dialogOpen) return;
    const t = setTimeout(() => {
      get<{ next: string[]; human: string }>(`/api/cron/preview?schedule=${encodeURIComponent(schedule)}`)
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 350);
    return () => clearTimeout(t);
  }, [schedule, dialogOpen]);

  function openNew() {
    setEditing(null);
    setName(""); setPreset("daily"); setTime("03:00"); setCommand(""); setEnabled(true); setCustom("*/5 * * * *");
    setDialogOpen(true);
  }
  function openEdit(j: CronJob) {
    setEditing(j);
    setName(j.name); setCommand(j.command); setEnabled(j.enabled);
    setCustom(j.schedule); setPreset("custom");
    setDialogOpen(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = { name, schedule, command, enabled };
      if (editing) return put(`/api/cron/${editing.id}`, payload);
      return post("/api/cron", payload);
    },
    onSuccess: () => {
      toast({ title: editing ? "Job updated" : "Job created" });
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["cron"] });
    },
    onError: (e) => toast({ title: "Save failed", description: e instanceof Error ? e.message : "error", variant: "destructive" }),
  });

  const toggle = useMutation({
    mutationFn: (j: CronJob) => api(`/api/cron/${j.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !j.enabled }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/cron/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Job deleted" }); setDeleteTarget(null); qc.invalidateQueries({ queryKey: ["cron"] }); },
  });
  const runNow = useMutation({
    mutationFn: (id: string) => post(`/api/cron/${id}/run`),
    onSuccess: () => toast({ title: "Started", description: "Output will appear in the run history." }),
  });

  const history = useQuery<{ runs: CronRun[] }>({
    queryKey: ["cron-runs", historyJob?.id],
    queryFn: () => get(`/api/cron/${historyJob!.id}/runs?limit=20`),
    enabled: !!historyJob,
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Cron Jobs</h2>
        <Badge variant="outline" className="cursor-default">scheduler live</Badge>
        <div className="ml-auto">
          <Button size="sm" onClick={openNew}><Plus className="h-4 w-4" aria-hidden /> New job</Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Jobs run on this server through the panel's scheduler (checked every 30s, minute granularity). Run-now executes immediately with output capture.
      </p>

      {jobs.isLoading ? (
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      ) : jobs.isError ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          Could not load jobs. <Button variant="link" onClick={() => jobs.refetch()}>Retry</Button>
        </CardContent></Card>
      ) : !jobs.data?.jobs.length ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <CalendarClock className="h-10 w-10 mx-auto text-muted-foreground" aria-hidden />
            <p className="font-medium">No cron jobs yet</p>
            <p className="text-sm text-muted-foreground">Schedule backups, cleanups, health checks…</p>
            <Button onClick={openNew} size="sm"><Plus className="h-4 w-4" aria-hidden /> New job</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="p-3 font-medium">Name</th>
                    <th className="p-3 font-medium">Schedule</th>
                    <th className="p-3 font-medium">Command</th>
                    <th className="p-3 font-medium">Last run</th>
                    <th className="p-3 font-medium">On</th>
                    <th className="p-3 font-medium sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.data.jobs.map((j) => {
                    const last = j.runs[0];
                    return (
                      <tr key={j.id} className="border-b last:border-0 hover:bg-muted/40 align-top">
                        <td className="p-3 font-medium">{j.name}</td>
                        <td className="p-3">
                          <p>{humanSchedule(j.schedule)}</p>
                          <p className="font-mono text-xs text-muted-foreground">{j.schedule}</p>
                        </td>
                        <td className="p-3">
                          <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded block max-w-64 truncate" title={j.command}>
                            {j.command}
                          </code>
                        </td>
                        <td className="p-3">
                          {!last ? (
                            <span className="text-xs text-muted-foreground">never</span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-xs">
                              {last.exitCode === null ? (
                                <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> running</>
                              ) : last.exitCode === 0 ? (
                                <><CircleCheck className="h-3.5 w-3.5 text-primary" aria-hidden /> ok</>
                              ) : (
                                <><CircleX className="h-3.5 w-3.5 text-destructive" aria-hidden /> exit {last.exitCode}</>
                              )}
                              <span className="text-muted-foreground">{new Date(last.startedAt).toLocaleTimeString()}</span>
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          <Switch checked={j.enabled} onCheckedChange={() => toggle.mutate(j)} aria-label={`Toggle ${j.name}`} />
                        </td>
                        <td className="p-3 text-right whitespace-nowrap">
                          <Button size="sm" variant="ghost" onClick={() => runNow.mutate(j.id)} aria-label={`Run ${j.name} now`}>
                            <Play className="h-4 w-4" aria-hidden />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setHistoryJob(j)} aria-label={`History for ${j.name}`}>
                            <History className="h-4 w-4" aria-hidden />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(j)} aria-label={`Edit ${j.name}`}>
                            <Pencil className="h-4 w-4" aria-hidden />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(j)} aria-label={`Delete ${j.name}`}>
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit cron job" : "New cron job"}</DialogTitle>
            <DialogDescription>Schedule builder with live validation and next-run preview.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="cron-name">Name</Label>
              <Input id="cron-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nightly backup" />
            </div>
            <div className="space-y-2">
              <Label>Schedule</Label>
              <RadioGroup value={preset} onValueChange={(v) => setPreset(v as Preset)} className="grid grid-cols-3 gap-2">
                {[
                  ["minute", "Every minute"], ["hourly", "Hourly"], ["daily", "Daily"],
                  ["weekly", "Weekly"], ["monthly", "Monthly"], ["custom", "Custom"],
                ].map(([v, l]) => (
                  <label key={v} className="flex items-center justify-center rounded-lg border p-2 text-xs cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                    <RadioGroupItem value={v} className="sr-only" />
                    {l}
                  </label>
                ))}
              </RadioGroup>
              {preset === "custom" ? (
                <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="*/5 * * * *" className="font-mono" aria-label="Custom cron expression" />
              ) : preset === "minute" ? (
                <p className="text-xs text-muted-foreground">Runs every minute.</p>
              ) : (
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" aria-label="Time" />
                  {preset === "weekly" && (
                    <Select value={weekday} onValueChange={setWeekday}>
                      <SelectTrigger className="w-32" aria-label="Weekday"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                          <SelectItem key={d} value={String(i)}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {preset === "monthly" && (
                    <Input
                      type="number" min={1} max={31} value={monthDay}
                      onChange={(e) => setMonthDay(e.target.value)} className="w-20"
                      aria-label="Day of month"
                    />
                  )}
                </div>
              )}
              <div className="rounded-lg border bg-muted/40 p-2 text-xs">
                {preview ? (
                  <>
                    <span className="font-medium">{preview.human}</span> — next:{" "}
                    {preview.next.slice(0, 3).map((n) => new Date(n).toLocaleString()).join(" · ")}
                  </>
                ) : (
                  <span className="text-muted-foreground">Invalid schedule</span>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cron-command">Command</Label>
              <Textarea id="cron-command" value={command} onChange={(e) => setCommand(e.target.value)}
                placeholder="tar -czf /tmp/backup.tgz /home/z/my-project/data" className="font-mono text-xs" rows={3} />
              <p className="text-xs text-muted-foreground">
                Runs via <code className="bg-muted px-1 rounded">bash -c</code> with a 120s timeout; exit code and output are captured. Admin permission + audit required.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="cron-enabled" checked={enabled} onCheckedChange={setEnabled} />
              <Label htmlFor="cron-enabled">Enabled</Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button disabled={!name || !command || !preview || save.isPending} onClick={() => save.mutate()}>
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {editing ? "Save changes" : "Create job"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Run history dialog */}
      <Dialog open={!!historyJob} onOpenChange={(o) => !o && setHistoryJob(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Run history — {historyJob?.name}</DialogTitle>
            <DialogDescription>Last 20 runs with exit codes and captured output.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {history.isLoading && <div className="h-20 rounded-lg bg-muted animate-pulse" />}
            {(history.data?.runs || []).length === 0 && !history.isLoading && (
              <p className="text-sm text-muted-foreground py-6 text-center">No runs yet — use “Run now”.</p>
            )}
            {(history.data?.runs || []).map((r) => (
              <div key={r.id} className="rounded-lg border p-3 space-y-1.5">
                <div className="flex items-center gap-2 text-xs">
                  {r.exitCode === null ? (
                    <Badge variant="secondary">running</Badge>
                  ) : r.exitCode === 0 ? (
                    <Badge variant="default">exit 0</Badge>
                  ) : (
                    <Badge variant="destructive">exit {r.exitCode}</Badge>
                  )}
                  <span className="text-muted-foreground">
                    {new Date(r.startedAt).toLocaleString()} · {r.trigger}
                    {r.finishedAt && ` · ${(new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000}s`}
                  </span>
                </div>
                {r.output && (
                  <pre className="font-mono text-xs bg-muted/50 rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap">{r.output}</pre>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>The job and its run history are removed.</AlertDialogDescription>
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
