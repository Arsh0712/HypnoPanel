"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, ApiClientError, fmtBytes } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Alert } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search,
  RefreshCw,
  MoreHorizontal,
  Skull,
  Gauge,
  Info,
  Loader2,
} from "lucide-react";

interface ProcessRow {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  rss: number;
  stat: string;
  time: string;
  command: string;
}

interface ProcessesResponse {
  processes: ProcessRow[];
  total: number;
}

type SortKey = "cpu" | "mem" | "pid";

function cpuColor(v: number): string {
  if (v > 80) return "text-destructive font-semibold";
  if (v > 50) return "text-amber-600 dark:text-amber-400 font-medium";
  return "";
}

function statBadge(stat: string): { label: string; className: string } {
  if (stat.includes("Z")) return { label: "zombie", className: "border-destructive/50 text-destructive" };
  if (stat.includes("D")) return { label: stat, className: "border-amber-500/50 text-amber-600 dark:text-amber-400" };
  return { label: stat, className: "border-border text-muted-foreground" };
}

export function ProcessesView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("cpu");
  const [auto, setAuto] = useState(true);

  // Term / graceful kill (simple confirm)
  const [termTarget, setTermTarget] = useState<ProcessRow | null>(null);
  // Kill -9 (typed confirmation)
  const [killTarget, setKillTarget] = useState<ProcessRow | null>(null);
  const [killConfirmText, setKillConfirmText] = useState("");
  // Renice
  const [reniceTarget, setReniceTarget] = useState<ProcessRow | null>(null);
  const [reniceValue, setReniceValue] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const list = useQuery<ProcessesResponse>({
    queryKey: ["processes", search, sort],
    queryFn: () => get<ProcessesResponse>(`/api/processes?search=${encodeURIComponent(search)}&sort=${sort}&limit=100`),
    refetchInterval: auto ? 5_000 : false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["processes"] });

  const killMutation = useMutation({
    mutationFn: (vars: { pid: number; signal: "SIGTERM" | "SIGKILL" }) =>
      post<{ ok: boolean }>(`/api/processes/kill`, vars),
    onSuccess: (_data, vars) => {
      toast({
        title: `Signal sent (${vars.signal})`,
        description: `PID ${vars.pid} was signalled. The list refreshes automatically.`,
      });
      invalidate();
    },
    onError: (err, vars) => {
      // Honest failures: EPERM for other users' processes, ESRCH for exited ones.
      toast({
        title: `Could not ${vars.signal === "SIGKILL" ? "kill" : "terminate"} PID ${vars.pid}`,
        description: err instanceof ApiClientError ? err.message : "Unexpected error",
        variant: "destructive",
      });
    },
  });

  const reniceMutation = useMutation({
    mutationFn: (vars: { pid: number; nice: number }) => post<{ ok: boolean; output: string | null }>("/api/processes/renice", vars),
    onSuccess: (data, vars) => {
      toast({
        title: `Priority updated for PID ${vars.pid}`,
        description: data.output || `New nice value: ${vars.nice}`,
      });
      invalidate();
    },
    onError: (err, vars) => {
      toast({
        title: `renice failed for PID ${vars.pid}`,
        description: err instanceof ApiClientError ? err.message : "Unexpected error",
        variant: "destructive",
      });
    },
  });

  const processes = list.data?.processes ?? [];
  const killTypeExpected = killTarget ? `kill ${killTarget.pid}` : "";

  const rows = useMemo(
    () =>
      processes.map((p) => {
        const stat = statBadge(p.stat);
        return (
          <tr key={p.pid} className="border-b last:border-0 hover:bg-muted/40">
            <td className="py-1.5 pr-3 font-mono text-xs">{p.pid}</td>
            <td className="py-1.5 pr-3 truncate max-w-28" title={p.user}>{p.user}</td>
            <td className={`py-1.5 pr-3 tabular-nums ${cpuColor(p.cpu)}`}>{p.cpu.toFixed(1)}</td>
            <td className="py-1.5 pr-3 tabular-nums">{p.mem.toFixed(1)}</td>
            <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">{fmtBytes(p.rss)}</td>
            <td className="py-1.5 pr-3">
              <Badge variant="outline" className={`font-mono font-normal cursor-default ${stat.className}`}>
                {stat.label}
              </Badge>
            </td>
            <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap tabular-nums">{p.time}</td>
            <td className="py-1.5 font-mono text-xs truncate max-w-52" title={p.command}>{p.command}</td>
            <td className="py-1.5 pl-2 text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for PID ${p.pid}`}>
                    <MoreHorizontal className="h-4 w-4" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      setReniceTarget(p);
                      setReniceValue(0);
                    }}
                  >
                    <Gauge className="h-4 w-4" aria-hidden /> Renice…
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTermTarget(p)}>
                    <Skull className="h-4 w-4" aria-hidden /> Terminate (SIGTERM)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => {
                      setKillTarget(p);
                      setKillConfirmText("");
                    }}
                  >
                    <Skull className="h-4 w-4" aria-hidden /> Force kill (SIGKILL)…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </td>
          </tr>
        );
      }),
    [processes]
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Processes</h1>
        <p className="text-sm text-muted-foreground">
          Live process table from <code className="font-mono text-xs bg-muted px-1 rounded">ps</code> on this server.
        </p>
      </div>

      {/* Pinned scope notice */}
      <Alert className="border-amber-500/50 bg-amber-500/5">
        <Info className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
        <div className="text-sm">
          <p className="font-medium">Operations apply to this server only.</p>
          <p className="text-muted-foreground">
            Signals and priority changes run under the panel&apos;s own OS user — acting on processes
            owned by other users can fail with a permission error, which is reported honestly.
          </p>
        </div>
      </Alert>

      {/* Toolbar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Filter by command, user or PID…"
                className="pl-8"
                aria-label="Filter processes"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="proc-sort" className="sr-only">Sort by</Label>
              <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                <SelectTrigger id="proc-sort" className="w-36" aria-label="Sort processes by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cpu">Sort: CPU %</SelectItem>
                  <SelectItem value="mem">Sort: Memory %</SelectItem>
                  <SelectItem value="pid">Sort: PID</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => list.refetch()}
              aria-label="Refresh process list now"
              title="Refresh now"
            >
              <RefreshCw className={`h-4 w-4 ${list.isFetching ? "animate-spin" : ""}`} aria-hidden />
            </Button>
            <div className="flex items-center gap-2">
              <Switch
                id="proc-auto"
                checked={auto}
                onCheckedChange={setAuto}
                aria-label="Auto-refresh every 5 seconds"
              />
              <Label htmlFor="proc-auto" className="text-sm text-muted-foreground whitespace-nowrap">
                Auto 5s
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-4">
          {list.isLoading ? (
            <div className="space-y-2" role="status" aria-label="Loading processes">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : list.isError ? (
            <div className="py-10 text-center space-y-3" role="alert">
              <p className="text-sm text-muted-foreground">
                Could not load processes. {list.error instanceof ApiClientError ? list.error.message : ""}
              </p>
              <Button variant="outline" onClick={() => list.refetch()}>
                <RefreshCw className="h-4 w-4" aria-hidden /> Retry
              </Button>
            </div>
          ) : processes.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {search ? `No processes match “${search}”.` : "No processes returned by ps."}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-2 pr-3 font-medium">PID</th>
                      <th className="py-2 pr-3 font-medium">User</th>
                      <th className="py-2 pr-3 font-medium">CPU %</th>
                      <th className="py-2 pr-3 font-medium">MEM %</th>
                      <th className="py-2 pr-3 font-medium">RSS</th>
                      <th className="py-2 pr-3 font-medium">STAT</th>
                      <th className="py-2 pr-3 font-medium">TIME</th>
                      <th className="py-2 pr-3 font-medium">Command</th>
                      <th className="py-2 pl-2 font-medium text-right sr-only">Actions</th>
                    </tr>
                  </thead>
                  <tbody>{rows}</tbody>
                </table>
              </div>
              <p className="pt-3 text-xs text-muted-foreground">
                Showing {processes.length} of the top processes{auto ? " · refreshing every 5s" : ""}.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* SIGTERM — simple confirm */}
      <AlertDialog
        open={!!termTarget}
        onOpenChange={(open) => {
          if (!open) setTermTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Terminate PID {termTarget?.pid}?</AlertDialogTitle>
            <AlertDialogDescription>
              Sends <span className="font-mono">SIGTERM</span> to{" "}
              <span className="font-mono">{termTarget?.command}</span> (user {termTarget?.user}). The
              process may catch the signal and shut down gracefully. If the process belongs to
              another user, the OS may refuse the operation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (termTarget) killMutation.mutate({ pid: termTarget.pid, signal: "SIGTERM" });
                setTermTarget(null);
              }}
            >
              Send SIGTERM
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* SIGKILL — typed confirmation */}
      <AlertDialog
        open={!!killTarget}
        onOpenChange={(open) => {
          if (!open) setKillTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force kill PID {killTarget?.pid}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono">SIGKILL</span> cannot be caught or ignored — the process is
              terminated immediately by the kernel, losing any unsaved work. Type{" "}
              <span className="font-mono font-semibold">{killTypeExpected}</span> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={killConfirmText}
            onChange={(e) => setKillConfirmText(e.target.value)}
            placeholder={killTypeExpected}
            aria-label="Type the confirmation phrase to force kill"
            autoComplete="off"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={killConfirmText.trim() !== killTypeExpected || killMutation.isPending}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (killTarget) killMutation.mutate({ pid: killTarget.pid, signal: "SIGKILL" });
                setKillTarget(null);
              }}
            >
              {killMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Force kill
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Renice dialog */}
      <Dialog
        open={!!reniceTarget}
        onOpenChange={(open) => {
          if (!open) setReniceTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change priority of PID {reniceTarget?.pid}</DialogTitle>
            <DialogDescription>
              Lower values = higher priority. Only <span className="font-mono">root</span> may set
              negative values (raise priority); as a regular user the OS may refuse the change —
              the result is reported honestly.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="renice-value">Nice value</Label>
                <span className="font-mono text-sm tabular-nums">{reniceValue}</span>
              </div>
              <Slider
                id="renice-slider"
                min={-20}
                max={19}
                step={1}
                value={[reniceValue]}
                onValueChange={(v) => setReniceValue(v[0] ?? 0)}
                aria-label="Nice value slider"
              />
              <Input
                id="renice-value"
                type="number"
                min={-20}
                max={19}
                step={1}
                value={reniceValue}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setReniceValue(Number.isFinite(n) ? Math.max(-20, Math.min(19, Math.trunc(n))) : 0);
                }}
                aria-label="Nice value between -20 and 19"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Applies the real <span className="font-mono">renice -n {reniceValue} -p {reniceTarget?.pid}</span>.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReniceTarget(null)}>Cancel</Button>
            <Button
              disabled={reniceMutation.isPending}
              onClick={() => {
                if (reniceTarget) reniceMutation.mutate({ pid: reniceTarget.pid, nice: reniceValue });
                setReniceTarget(null);
              }}
            >
              {reniceMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
