"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, ApiClientError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search,
  Info,
  RefreshCw,
  MoreHorizontal,
  Play,
  Square,
  RotateCw,
  Power,
  PowerOff,
  ScrollText,
  Loader2,
  Ban,
} from "lucide-react";

interface ServicesResponse {
  systemd: boolean;
  note: string | null;
  units: {
    unit: string;
    load: string;
    active: string;
    sub: string;
    description: string;
    key: boolean;
  }[];
  processMap: { name: string; pid: number; command: string }[];
}

const CRITICAL_HINT = "sshd, hipnod, networking, systemd-*";

function activeBadgeClass(active: string): string {
  if (active === "active") return "border-primary/40 text-primary";
  if (active === "failed") return "border-destructive/50 text-destructive";
  return "border-border text-muted-foreground";
}

export function ServicesView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [journalUnit, setJournalUnit] = useState<string | null>(null);
  const [actionUnit, setActionUnit] = useState<{ unit: string; action: string; critical: boolean } | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const list = useQuery<ServicesResponse>({
    queryKey: ["services"],
    queryFn: () => get<ServicesResponse>("/api/services"),
    refetchInterval: 30_000,
  });

  const journal = useQuery<{ unit: string; output: string }>({
    queryKey: ["services-journal", journalUnit],
    queryFn: () => get<{ unit: string; output: string }>(`/api/services/journal?unit=${encodeURIComponent(journalUnit!)}&lines=200`),
    enabled: !!journalUnit,
    refetchInterval: 15_000,
  });

  const actionMutation = useMutation({
    mutationFn: (vars: { unit: string; action: string; confirm?: boolean }) =>
      post<{ ok: boolean; output: string | null }>("/api/services/action", vars),
    onSuccess: (data, vars) => {
      toast({
        title: `systemctl ${vars.action} ${vars.unit}`,
        description: data.output || "Command completed.",
      });
      queryClient.invalidateQueries({ queryKey: ["services"] });
    },
    onError: (err, vars) => {
      toast({
        title: `Action failed: ${vars.action} ${vars.unit}`,
        description: err instanceof ApiClientError ? err.message : "Unexpected error",
        variant: "destructive",
      });
    },
  });

  const systemd = list.data?.systemd ?? false;
  const units = list.data?.units ?? [];
  const processMap = list.data?.processMap ?? [];

  const filteredUnits = useMemo(() => {
    const q = search.trim().toLowerCase();
    return units.filter((u) => {
      if (onlyActive && u.active !== "active") return false;
      if (!q) return true;
      return (
        u.unit.toLowerCase().includes(q) ||
        u.description.toLowerCase().includes(q)
      );
    });
  }, [units, search, onlyActive]);

  function runAction(unit: string, action: string, critical: boolean) {
    if (critical) {
      setActionUnit({ unit, action, critical });
      setConfirmText("");
    } else {
      actionMutation.mutate({ unit, action });
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Services</h1>
        <p className="text-sm text-muted-foreground">
          systemd service units and their journals — real <code className="font-mono text-xs bg-muted px-1 rounded">systemctl</code> / <code className="font-mono text-xs bg-muted px-1 rounded">journalctl</code> output.
        </p>
      </div>

      {list.isLoading ? (
        <div className="space-y-2" role="status" aria-label="Loading services">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : list.isError ? (
        <Card>
          <CardContent className="py-10 text-center space-y-3" role="alert">
            <p className="text-sm text-muted-foreground">
              Could not load services. {list.error instanceof ApiClientError ? list.error.message : ""}
            </p>
            <Button variant="outline" onClick={() => list.refetch()}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : !systemd ? (
        <>
          {/* Honest environment notice (container preview) */}
          <Alert className="border-amber-500/50 bg-amber-500/5">
            <Info className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            <div className="text-sm">
              <p className="font-medium">systemd is not available here</p>
              <p>{list.data?.note}</p>
            </div>
          </Alert>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Panel-related processes</CardTitle>
            </CardHeader>
            <CardContent>
              {processMap.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No panel-related processes detected.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b">
                        <th className="py-2 pr-4 font-medium">Name</th>
                        <th className="py-2 pr-4 font-medium">PID</th>
                        <th className="py-2 font-medium">Command</th>
                      </tr>
                    </thead>
                    <tbody>
                      {processMap.map((p, i) => (
                        <tr key={`${p.pid}-${i}`} className="border-b last:border-0 hover:bg-muted/40">
                          <td className="py-1.5 pr-4">
                            <Badge variant="outline" className="font-mono font-normal">{p.name}</Badge>
                          </td>
                          <td className="py-1.5 pr-4 font-mono text-xs">{p.pid}</td>
                          <td className="py-1.5 font-mono text-xs truncate max-w-96" title={p.command}>
                            {p.command}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Ban className="h-4 w-4 shrink-0" aria-hidden />
                <p>
                  Service actions are disabled in this environment — start/stop/restart/enable/disable
                  apply to the VPS deployment where systemd is the init system.
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* Toolbar */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-56">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter units or descriptions…"
                    className="pl-8"
                    aria-label="Filter service units"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="svc-active-only"
                    checked={onlyActive}
                    onCheckedChange={setOnlyActive}
                    aria-label="Show only active units"
                  />
                  <Label htmlFor="svc-active-only" className="text-sm text-muted-foreground whitespace-nowrap">
                    Active only
                  </Label>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => list.refetch()}
                  aria-label="Refresh service list"
                  title="Refresh"
                >
                  <RefreshCw className={`h-4 w-4 ${list.isFetching ? "animate-spin" : ""}`} aria-hidden />
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              {filteredUnits.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {search || onlyActive ? "No units match the current filter." : "No service units reported."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b">
                        <th className="py-2 pr-3 font-medium">Unit</th>
                        <th className="py-2 pr-3 font-medium">Active</th>
                        <th className="py-2 pr-3 font-medium">Sub</th>
                        <th className="py-2 pr-3 font-medium">Description</th>
                        <th className="py-2 pl-2 font-medium text-right sr-only">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUnits.map((u) => (
                        <tr key={u.unit} className="border-b last:border-0 hover:bg-muted/40">
                          <td className="py-1.5 pr-3">
                            <span className="font-mono text-xs">{u.unit}</span>
                            {u.key && (
                              <Badge variant="default" className="ml-2 text-[10px] cursor-default">key</Badge>
                            )}
                          </td>
                          <td className="py-1.5 pr-3">
                            <Badge variant="outline" className={`cursor-default ${activeBadgeClass(u.active)}`}>
                              {u.active}
                            </Badge>
                          </td>
                          <td className="py-1.5 pr-3 text-xs text-muted-foreground">{u.sub}</td>
                          <td className="py-1.5 pr-3 truncate max-w-64" title={u.description}>{u.description}</td>
                          <td className="py-1.5 pl-2 text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${u.unit}`}>
                                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setJournalUnit(u.unit)}>
                                  <ScrollText className="h-4 w-4" aria-hidden /> View journal…
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => runAction(u.unit, "start", u.key)}>
                                  <Play className="h-4 w-4" aria-hidden /> Start
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => runAction(u.unit, "stop", u.key)}>
                                  <Square className="h-4 w-4" aria-hidden /> Stop
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => runAction(u.unit, "restart", u.key)}>
                                  <RotateCw className="h-4 w-4" aria-hidden /> Restart
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => runAction(u.unit, "enable", u.key)}>
                                  <Power className="h-4 w-4" aria-hidden /> Enable
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => runAction(u.unit, "disable", u.key)}>
                                  <PowerOff className="h-4 w-4" aria-hidden /> Disable
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="pt-3 text-xs text-muted-foreground">
                {filteredUnits.length} of {units.length} units · critical units ({CRITICAL_HINT}) require a typed confirmation.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {/* Typed confirm for critical units */}
      <Dialog
        open={!!actionUnit}
        onOpenChange={(open) => {
          if (!open) setActionUnit(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {actionUnit?.action} {actionUnit?.unit}
            </DialogTitle>
            <DialogDescription>
              <span className="font-mono">{actionUnit?.unit}</span> is a critical unit — stopping or
              changing it can cut off your own access to the server. Type the unit name{" "}
              <span className="font-mono font-semibold">{actionUnit?.unit}</span> to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={actionUnit?.unit || ""}
            aria-label="Type the unit name to confirm"
            autoComplete="off"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionUnit(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!actionUnit || confirmText.trim() !== actionUnit.unit || actionMutation.isPending}
              onClick={() => {
                if (actionUnit) actionMutation.mutate({ unit: actionUnit.unit, action: actionUnit.action, confirm: true });
                setActionUnit(null);
              }}
            >
              {actionMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Confirm {actionUnit?.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Journal viewer */}
      <Dialog
        open={!!journalUnit}
        onOpenChange={(open) => {
          if (!open) setJournalUnit(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-base">{journalUnit}</DialogTitle>
            <DialogDescription>
              Last 200 lines from <span className="font-mono">journalctl -u {journalUnit}</span> — refreshes every 15s.
            </DialogDescription>
          </DialogHeader>
          {journal.isLoading ? (
            <div className="space-y-2" role="status" aria-label="Loading journal">
              {[...Array(8)].map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : journal.isError ? (
            <div className="py-6 text-center space-y-3" role="alert">
              <p className="text-sm text-muted-foreground">
                {journal.error instanceof ApiClientError ? journal.error.message : "Could not load journal."}
              </p>
              <Button variant="outline" onClick={() => journal.refetch()}>
                <RefreshCw className="h-4 w-4" aria-hidden /> Retry
              </Button>
            </div>
          ) : (
            <pre
              className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs font-mono whitespace-pre"
              aria-label={`Journal output for ${journalUnit}`}
            >
              {journal.data?.output || "(empty journal)"}
            </pre>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => journal.refetch()} disabled={!journalUnit}>
              <RefreshCw className={`h-4 w-4 ${journal.isFetching ? "animate-spin" : ""}`} aria-hidden /> Refresh
            </Button>
            <Button onClick={() => setJournalUnit(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
