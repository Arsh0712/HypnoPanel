"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, api, fmtBytes } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HardDrive, Plus, Trash2, MoreHorizontal, ShieldCheck, FolderSearch, Download,
  RotateCcw, Copy, Loader2, PackageOpen,
} from "lucide-react";

interface BackupRow {
  id: string; name: string; scope: string; fileName: string; sizeBytes: number;
  sha256: string; status: string; createdAt: string;
}

export function BackupsView() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const list = useQuery<{ backups: BackupRow[]; retention: number; schedule: string; encryption: boolean }>({
    queryKey: ["backups"],
    queryFn: () => get("/api/backups"),
    refetchInterval: 30_000,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState({ panelDb: true, sites: true, databases: true, config: true });
  const [inspectTarget, setInspectTarget] = useState<BackupRow | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupRow | null>(null);
  const [restoreText, setRestoreText] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<BackupRow | null>(null);

  const create = useMutation({
    mutationFn: () => post("/api/backups", { name: name || undefined, scope }),
    onSuccess: (r) => {
      toast({ title: "Backup created", description: `${(r as { fileName?: string }).fileName} · ${fmtBytes((r as { sizeBytes?: number }).sizeBytes)} · SHA-256 verified` });
      setCreateOpen(false);
      setName("");
      qc.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (e) => toast({ title: "Backup failed", description: e instanceof Error ? e.message : "error", variant: "destructive" }),
  });

  const verify = useMutation({
    mutationFn: (id: string) => post<{ ok: boolean; status: string; error?: string }>(`/api/backups/${id}/verify`),
    onSuccess: (r) => {
      if (r.ok) toast({ title: "Integrity verified", description: "SHA-256 checksum matches — archive is intact." });
      else toast({ title: `Corrupt (${r.status})`, description: r.error, variant: "destructive" });
      qc.invalidateQueries({ queryKey: ["backups"] });
    },
  });

  const restore = useMutation({
    mutationFn: (id: string) => post<{ ok: boolean; error?: string; snapshotId?: string; restartRequired?: boolean }>(`/api/backups/${id}/restore`),
    onSuccess: (r) => {
      setRestoreTarget(null);
      setRestoreText("");
      if (r.ok) {
        toast({
          title: "Restore complete",
          description: r.restartRequired
            ? "Panel DB restored to db/custom.db.restored — swap on restart (automatic on the VPS deployment)."
            : "A pre-restore snapshot was taken automatically.",
        });
        qc.invalidateQueries({ queryKey: ["backups"] });
      } else {
        toast({ title: "Restore failed", description: r.error, variant: "destructive" });
      }
    },
    onError: (e) => toast({ title: "Restore failed", description: String(e), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/backups/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Backup deleted" }); setDeleteTarget(null); qc.invalidateQueries({ queryKey: ["backups"] }); },
  });

  const inspect = useQuery<{ entries: string[] }>({
    queryKey: ["backup-inspect", inspectTarget?.id],
    queryFn: () => post(`/api/backups/${inspectTarget!.id}/inspect`),
    enabled: !!inspectTarget,
  });

  const scopeBadges = (s: string) => {
    let parsed: Record<string, boolean> = {};
    try { parsed = JSON.parse(s); } catch {}
    const map: Record<string, string> = { panelDb: "panel DB", sites: "sites", databases: "databases", config: "config" };
    return Object.entries(parsed).filter(([, v]) => v).map(([k]) => (
      <Badge key={k} variant="outline" className="font-normal cursor-default">{map[k] || k}</Badge>
    ));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Backups</h2>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="cursor-default">retention {list.data?.retention ?? "…"}</Badge>
          <Badge variant="outline" className="cursor-default font-mono font-normal">{list.data?.schedule ?? "…"}</Badge>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden /> Back up now
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Real tar.gz archives with SHA-256 integrity, pre-restore snapshots and retention pruning. Retention and schedule are configurable in Settings → Backups.
      </p>

      {list.isLoading ? (
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      ) : list.isError ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          Could not load backups. <Button variant="link" onClick={() => list.refetch()}>Retry</Button>
        </CardContent></Card>
      ) : !list.data?.backups.length ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <HardDrive className="h-10 w-10 mx-auto text-muted-foreground" aria-hidden />
            <p className="font-medium">No backups yet</p>
            <p className="text-sm text-muted-foreground">Create your first archive — panel database, sites, databases and config.</p>
            <Button onClick={() => setCreateOpen(true)} size="sm"><Plus className="h-4 w-4" aria-hidden /> Back up now</Button>
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
                    <th className="p-3 font-medium">Scope</th>
                    <th className="p-3 font-medium">Size</th>
                    <th className="p-3 font-medium">SHA-256</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Created</th>
                    <th className="p-3 font-medium sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.backups.map((b) => (
                    <tr key={b.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="p-3 font-medium">{b.name}</td>
                      <td className="p-3"><div className="flex flex-wrap gap-1">{scopeBadges(b.scope)}</div></td>
                      <td className="p-3">{fmtBytes(b.sizeBytes)}</td>
                      <td className="p-3">
                        <button
                          className="font-mono text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                          onClick={() => { navigator.clipboard.writeText(b.sha256); toast({ title: "Checksum copied" }); }}
                          title={b.sha256}
                        >
                          {b.sha256.slice(0, 12)}… <Copy className="h-3 w-3" aria-hidden />
                        </button>
                      </td>
                      <td className="p-3">
                        {b.status === "ok" ? <Badge variant="default">ok</Badge> : <Badge variant="destructive">{b.status}</Badge>}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">{new Date(b.createdAt).toLocaleString()}</td>
                      <td className="p-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost" aria-label={`Actions for ${b.name}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => verify.mutate(b.id)}>
                              <ShieldCheck className="h-4 w-4" aria-hidden /> Verify
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setInspectTarget(b)}>
                              <FolderSearch className="h-4 w-4" aria-hidden /> Inspect
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a href={`/api/backups/${b.id}/download`} download>
                                <Download className="h-4 w-4" aria-hidden /> Download
                              </a>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setRestoreTarget(b); setRestoreText(""); }}>
                              <RotateCcw className="h-4 w-4" aria-hidden /> Restore…
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget(b)}>
                              <Trash2 className="h-4 w-4" aria-hidden /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Back up now</DialogTitle>
            <DialogDescription>Creates a real tar.gz archive with a SHA-256 checksum.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="bk-name">Name (optional)</Label>
              <Input id="bk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="before-migration" />
            </div>
            <div className="space-y-2">
              <Label>Scope</Label>
              {[
                ["panelDb", "Panel database"],
                ["sites", "Websites (data/sites)"],
                ["databases", "Databases (data/databases)"],
                ["config", "Panel configuration"],
              ].map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={scope[k as keyof typeof scope]}
                    onCheckedChange={(v) => setScope({ ...scope, [k]: !!v })}
                  />
                  {l}
                </label>
              ))}
            </div>
            <Button
              className="w-full"
              disabled={create.isPending || !Object.values(scope).some(Boolean)}
              onClick={() => create.mutate()}
            >
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <HardDrive className="h-4 w-4" aria-hidden />}
              Create backup
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Inspect dialog */}
      <Dialog open={!!inspectTarget} onOpenChange={(o) => !o && setInspectTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Archive contents — {inspectTarget?.name}</DialogTitle>
            <DialogDescription>Entries are inspected before any restore (zip-slip protection).</DialogDescription>
          </DialogHeader>
          {inspect.isLoading ? (
            <div className="h-40 rounded-lg bg-muted animate-pulse" />
          ) : (
            <ul className="text-xs font-mono max-h-72 overflow-y-auto rounded-lg border divide-y" role="list">
              {(inspect.data?.entries || []).length === 0 && (
                <li className="p-3 text-center text-muted-foreground font-sans">No entries.</li>
              )}
              {(inspect.data?.entries || []).map((e, i) => (
                <li key={i} className="px-3 py-1.5 truncate">{e}</li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      {/* Restore confirm (typed) */}
      <AlertDialog open={!!restoreTarget} onOpenChange={(o) => !o && setRestoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore “{restoreTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1">
                <p>A pre-restore snapshot of the same scope is taken automatically first.</p>
                <p>Type <strong>RESTORE</strong> to confirm. This overwrites the current data in the archive&apos;s scope.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={restoreText}
            onChange={(e) => setRestoreText(e.target.value)}
            placeholder="RESTORE"
            aria-label="Type RESTORE to confirm"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoreText !== "RESTORE" || restore.isPending}
              onClick={() => restoreTarget && restore.mutate(restoreTarget.id)}
            >
              {restore.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Restore now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>The archive file and its record are removed permanently.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}>
              <Trash2 className="h-4 w-4" aria-hidden /> Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
