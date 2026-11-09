"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, del, api, ApiClientError, fmtBytes } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { motion } from "framer-motion";
import {
  Puzzle,
  Plus,
  Globe,
  FolderOpen,
  RefreshCw,
  Settings2,
  Trash2,
  MoreHorizontal,
  Loader2,
  KeyRound,
  Copy,
  Check,
  ExternalLink,
  Package,
  Palette,
  ArrowUpCircle,
  GitBranch,
  Layers,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import {
  ViewHeader,
  StatCard,
  SectionCard,
  StatusChip,
  EmptyState,
  AnimatedNumber,
} from "@/components/panel/primitives";
import { fadeUp, stagger } from "@/components/panel/motion";

/* ————————————————————————————— response types ————————————————————————————— */

interface WpSiteRow {
  id: string;
  name: string;
  url: string;
  path: string;
  phpVersion: string;
  wpVersion: string | null;
  autoCore: string;
  autoPlugins: boolean;
  autoThemes: boolean;
  stagingPath: string | null;
  status: string;
  lastScanAt: string | null;
  createdAt: string;
  updatedAt: string;
  pluginCount?: number;
  themeCount?: number;
  updatesAvailable?: number;
}

interface WpPlugin {
  slug: string;
  name: string;
  version: string;
  file: string;
}

interface WpTheme {
  slug: string;
  name: string;
  version: string;
}

interface WpUpdatePlugin {
  slug: string;
  current: string;
  latest: string | null;
  available: boolean;
  unknown?: boolean;
}

interface WpUpdates {
  checkedAt: string;
  core: { current: string | null; latest: string | null; available: boolean };
  plugins: WpUpdatePlugin[];
  error?: string;
}

interface WpHistoryEntry {
  target: string;
  from: string | null;
  to: string | null;
  at: string;
  result: "applied" | "rolled_back" | "staged";
  detail?: string;
}

interface WpScan {
  core: { version: string | null } | null;
  plugins: WpPlugin[];
  themes: WpTheme[];
  wpConfig: boolean | null;
  saltsPresent: boolean | null;
  updates: WpUpdates | null;
  history: WpHistoryEntry[];
  scannedAt: string;
}

interface SiteDetailResponse {
  site: WpSiteRow;
  scan: WpScan | null;
  staging: { exists: boolean; path: string | null };
}

interface StagingStatusResponse {
  staging: { exists: boolean; path: string | null; fallback: boolean | null; files: number | null; bytes: number | null };
  production: { files: number; bytes: number } | null;
  diff: { files: number; bytes: number } | null;
}

interface AdminLoginResponse {
  url: string;
  expiresAt: string;
  phpRuntime: boolean;
  note: string;
}

type UpdateResponse =
  | { updated: false; reason: string; target: string; current: string; latest: string | null }
  | {
      result: "applied" | "rolled_back" | "staged";
      target: string;
      from: string | null;
      to: string | null;
      detail: string;
      healthCheck?: { before: number | null; after: number | null };
      manifest?: { file: string; snapshotDir: string; filesTouched: number };
    };

const PHP_VERSIONS = ["8.1", "8.2", "8.3", "8.4"];
const AUTO_CORE_LABELS: Record<string, string> = {
  off: "Off — never auto-update",
  minor: "Minor only (security releases)",
  major: "Major + minor (latest)",
};

/* ————————————————————————————— small helpers ————————————————————————————— */

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} d ago`;
}

function targetLabel(target: string): string {
  if (target === "core") return "WordPress core";
  const slug = target.startsWith("plugin:") ? target.slice(7) : target;
  return `Plugin “${slug}”`;
}

function CopyBtn({ text, label, className }: { text: string; label: string; className?: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className ?? "h-7 gap-1.5 px-2 text-xs"}
      aria-label={label}
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
  );
}

/* ————————————————————————————————— view ————————————————————————————————— */

export function WordpressView() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WpSiteRow | null>(null);

  const sites = useQuery<{ sites: WpSiteRow[] }>({
    queryKey: ["wp-sites"],
    queryFn: () => get("/api/wordpress/sites"),
    refetchInterval: 30_000,
  });

  const scanSite = useMutation({
    mutationFn: (id: string) => post<{ scan: WpScan }>(`/api/wordpress/sites/${id}/scan`, {}),
    onSuccess: (data) => {
      const s = data.scan;
      toast({
        title: `Scan complete — WordPress ${s.core?.version ?? "?"}`,
        description: `${s.plugins.length} plugin${s.plugins.length === 1 ? "" : "s"} · ${s.themes.length} theme${s.themes.length === 1 ? "" : "s"}${s.updates?.error ? " · update check offline" : ""}`,
      });
      qc.invalidateQueries({ queryKey: ["wp-sites"] });
      qc.invalidateQueries({ queryKey: ["wp-site"] });
    },
    onError: (e) => {
      toast({
        title: "Scan failed",
        description: e instanceof ApiClientError ? e.message : "Unexpected error",
        variant: "destructive",
      });
      qc.invalidateQueries({ queryKey: ["wp-sites"] });
      qc.invalidateQueries({ queryKey: ["wp-site"] });
    },
  });

  const deleteSite = useMutation({
    mutationFn: (id: string) => del(`/api/wordpress/sites/${id}`),
    onSuccess: () => {
      toast({ title: "Site removed from the panel", description: "The document root and its files were not touched." });
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["wp-sites"] });
    },
    onError: (e) =>
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : "error", variant: "destructive" }),
  });

  const rows = sites.data?.sites ?? [];
  const totals = useMemo(
    () => ({
      sites: rows.length,
      plugins: rows.reduce((n, s) => n + (s.pluginCount ?? 0), 0),
      themes: rows.reduce((n, s) => n + (s.themeCount ?? 0), 0),
      updates: rows.reduce((n, s) => n + (s.updatesAvailable ?? 0), 0),
    }),
    [rows]
  );

  if (sites.isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-72 rounded-lg bg-muted/50 hipno-shimmer" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-32 rounded-xl bg-muted/50 hipno-shimmer" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-52 rounded-xl bg-muted/40 hipno-shimmer" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      <ViewHeader
        title={
          <>
            WordPress <span className="font-[family-name:var(--font-display)] italic text-gradient">toolkit</span>
          </>
        }
        description="Sites registered on this server, scanned from their real files on disk — core version, plugins, themes and salt health — with staged or applied updates against the live wordpress.org API."
        actions={
          <Button onClick={() => setAddOpen(true)} className="hipno-glow">
            <Plus className="h-4 w-4" aria-hidden /> Add WordPress site
          </Button>
        }
      />

      {/* ————— stat cards ————— */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <motion.div variants={fadeUp}>
          <StatCard icon={Layers} label="Managed sites" value={<AnimatedNumber value={totals.sites} />} sub={totals.sites === 1 ? "1 document root under management" : `${totals.sites} document roots under management`} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard icon={Puzzle} label="Plugins tracked" value={<AnimatedNumber value={totals.plugins} />} sub="parsed from plugin file headers" />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard icon={Palette} label="Themes tracked" value={<AnimatedNumber value={totals.themes} />} sub="parsed from style.css headers" />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard
            icon={ArrowUpCircle}
            label="Updates available"
            value={<AnimatedNumber value={totals.updates} />}
            sub={totals.updates > 0 ? "core + plugin updates pending" : "everything current"}
            accentClass={totals.updates > 0 ? "bg-amber-500/14 text-amber-600 dark:text-amber-400" : undefined}
          />
        </motion.div>
      </div>

      {/* ————— sites ————— */}
      <motion.div variants={fadeUp}>
        {sites.isError ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              Could not load sites.{" "}
              <Button variant="link" onClick={() => sites.refetch()}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card className="hipno-card">
            <EmptyState
              icon={Puzzle}
              title="No WordPress sites yet"
              description="Register a site by pointing the panel at its document root. The scanner then reads the real files — wp-includes/version.php, plugin headers and theme headers — to build the inventory."
              action={
                <Button onClick={() => setAddOpen(true)} className="hipno-glow">
                  <Plus className="h-4 w-4" aria-hidden /> Add WordPress site
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((s) => (
              <Card key={s.id} className="hipno-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/[0.04] dark:hover:shadow-black/20 flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">
                        <button className="hover:text-primary transition-colors" onClick={() => setDetailId(s.id)}>
                          {s.name}
                        </button>
                      </CardTitle>
                      <CardDescription className="flex items-center gap-1.5 mt-1 min-w-0">
                        <Globe className="h-3 w-3 shrink-0" aria-hidden />
                        <a href={s.url} target="_blank" rel="noreferrer" className="truncate hover:text-primary hover:underline">
                          {s.url.replace(/^https?:\/\//, "")}
                        </a>
                      </CardDescription>
                    </div>
                    <StatusChip status={s.status} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 flex-1">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono" title={s.path}>
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{s.path}</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {s.wpVersion ? (
                      <Badge variant="secondary" className="font-mono text-[11px]">WP {s.wpVersion}</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[11px]">version unknown</Badge>
                    )}
                    <Badge variant="outline" className="text-[11px] font-mono">PHP {s.phpVersion}</Badge>
                    {(s.updatesAvailable ?? 0) > 0 && (
                      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/25 text-[11px]">
                        {s.updatesAvailable} update{(s.updatesAvailable ?? 0) === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {(s.pluginCount ?? 0)} plugin{(s.pluginCount ?? 0) === 1 ? "" : "s"} · {(s.themeCount ?? 0)} theme{(s.themeCount ?? 0) === 1 ? "" : "s"} · scanned {timeAgo(s.lastScanAt)}
                  </p>
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      disabled={scanSite.isPending && scanSite.variables === s.id}
                      onClick={() => scanSite.mutate(s.id)}
                    >
                      {scanSite.isPending && scanSite.variables === s.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                      )}
                      Scan
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => setDetailId(s.id)}>
                      <Settings2 className="h-3.5 w-3.5" aria-hidden /> Manage
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost" aria-label={`More actions for ${s.name}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setDetailId(s.id)}>
                          <KeyRound className="h-4 w-4" aria-hidden /> Admin login &amp; settings
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget(s)}>
                          <Trash2 className="h-4 w-4" aria-hidden /> Remove from panel…
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </motion.div>

      {addOpen && (
        <AddSiteDialog
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false);
            qc.invalidateQueries({ queryKey: ["wp-sites"] });
          }}
        />
      )}

      {detailId && (
        <SiteDetailDialog
          siteId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ["wp-sites"] });
            qc.invalidateQueries({ queryKey: ["wp-site"] });
          }}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{deleteTarget?.name}” from the panel?</AlertDialogTitle>
            <AlertDialogDescription>
              This only un-registers the site. The document root <span className="font-mono text-xs">{deleteTarget?.path}</span> and every file in it are <strong>never touched</strong>; only panel-owned snapshots and staging copies under <span className="font-mono text-xs">data/sites/…</span> are removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteSite.mutate(deleteTarget.id)}
            >
              Remove site
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

/* ————————————————————————————— add-site dialog ————————————————————————————— */

function AddSiteDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [path, setPath] = useState("");
  const [phpVersion, setPhpVersion] = useState("8.3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && url.trim().length > 0 && path.trim().length > 0 && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ site: WpSiteRow }>("/api/wordpress/sites", {
        name: name.trim(),
        url: url.trim(),
        path: path.trim(),
        phpVersion,
      });
      toast({
        title: `“${res.site.name}” registered`,
        description: res.site.wpVersion
          ? `WordPress ${res.site.wpVersion} detected on disk — run a scan for the full inventory.`
          : "No WordPress core detected yet — the site is registered with status “error” until a scan succeeds.",
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add WordPress site</DialogTitle>
          <DialogDescription>
            Point the panel at an existing document root on this server. Nothing is installed or modified — the scanner
            only reads files.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wp-name">Site name</Label>
            <Input id="wp-name" placeholder="My blog" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wp-url">Site URL</Label>
            <Input id="wp-url" type="url" placeholder="https://blog.example.com" value={url} onChange={(e) => setUrl(e.target.value)} />
            <p className="text-xs text-muted-foreground">Used for post-update health checks and the admin-login redirect.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wp-path">Document root</Label>
            <Input
              id="wp-path"
              className="font-mono"
              placeholder="/var/www/blog"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">Absolute path on this server containing <span className="font-mono">wp-includes/</span>.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wp-php">PHP version</Label>
            <Select value={phpVersion} onValueChange={setPhpVersion}>
              <SelectTrigger id="wp-php" aria-label="PHP version">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PHP_VERSIONS.map((v) => (
                  <SelectItem key={v} value={v}>
                    PHP {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
            Register site
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ————————————————————————————— site detail ————————————————————————————— */

function SiteDetailDialog({
  siteId,
  onClose,
  onChanged,
}: {
  siteId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [adminLogin, setAdminLogin] = useState<AdminLoginResponse | null>(null);
  const [pushConfirm, setPushConfirm] = useState(false);

  const detail = useQuery<SiteDetailResponse>({
    queryKey: ["wp-site", siteId],
    queryFn: () => get(`/api/wordpress/sites/${siteId}`),
  });
  const staging = useQuery<StagingStatusResponse>({
    queryKey: ["wp-staging", siteId],
    queryFn: () => get(`/api/wordpress/sites/${siteId}/staging`),
  });

  const patchSettings = async (data: Record<string, unknown>) => {
    try {
      await api(`/api/wordpress/sites/${siteId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      onChanged();
    } catch (e) {
      toast({ title: "Could not save setting", description: e instanceof Error ? e.message : "error", variant: "destructive" });
    }
  };

  const runScan = useMutation({
    mutationFn: () => post<{ scan: WpScan }>(`/api/wordpress/sites/${siteId}/scan`, {}),
    onSuccess: (data) => {
      const s = data.scan;
      const upd = s.updates;
      toast({
        title: `Scanned — WordPress ${s.core?.version ?? "?"}`,
        description: upd
          ? upd.error
            ? `Inventory refreshed, but the update check is offline (${upd.error.split(":")[0]}).`
            : `${upd.core.available ? `core ${upd.core.latest} available` : "core current"} · ${upd.plugins.filter((p) => p.available).length} plugin update(s)`
          : `${s.plugins.length} plugin(s) · ${s.themes.length} theme(s)`,
      });
      onChanged();
    },
    onError: (e) => {
      toast({ title: "Scan failed", description: e instanceof ApiClientError ? e.message : "error", variant: "destructive" });
      onChanged();
    },
  });

  const applyUpdate = useMutation({
    mutationFn: (target: string) => post<UpdateResponse>(`/api/wordpress/sites/${siteId}/update`, { target }),
    onSuccess: (data) => {
      if ("result" in data) {
        if (data.result === "applied") {
          toast({ title: `${targetLabel(data.target)} updated → ${data.to}`, description: data.detail });
        } else if (data.result === "staged") {
          toast({ title: "Update staged (not applied)", description: data.detail });
        } else {
          toast({ title: "Update rolled back", description: data.detail, variant: "destructive" });
        }
      } else {
        toast({ title: "Already up to date", description: `${targetLabel(data.target)} is at ${data.current}.` });
      }
      onChanged();
    },
    onError: (e) => {
      // 500 without an ApiError body = the rolled_back path: the site was
      // restored from its snapshot. Show the story, then refresh history.
      if (e instanceof ApiClientError && e.status === 500 && (e.code === "error" || e.code === "internal")) {
        toast({
          title: "Update failed — restored from snapshot",
          description: "The update could not be applied safely, so the previous files were rolled back byte-for-byte. See Update history.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Update failed", description: e instanceof Error ? e.message : "error", variant: "destructive" });
      }
      onChanged();
    },
  });

  const adminLoginMut = useMutation({
    mutationFn: () => post<AdminLoginResponse>(`/api/wordpress/sites/${siteId}/admin-login`, {}),
    onSuccess: (data) => {
      setAdminLogin(data);
      onChanged();
    },
    onError: (e) =>
      toast({ title: "Could not issue login link", description: e instanceof Error ? e.message : "error", variant: "destructive" }),
  });

  const stagingAction = useMutation({
    mutationFn: (action: "create" | "push" | "pull" | "delete"): Promise<
      { ok: boolean; removed: boolean; path: string } | { note?: string; result?: string }
    > => {
      if (action === "delete") {
        return del<{ ok: boolean; removed: boolean; path: string }>(`/api/wordpress/sites/${siteId}/staging`);
      }
      return post<{ note?: string; result?: string }>(`/api/wordpress/sites/${siteId}/staging`, { action });
    },
    onSuccess: (data) => {
      const msg =
        ("note" in data && data.note) ||
        ("result" in data && data.result === "pushed"
          ? "Staging was pushed onto production."
          : "result" in data && data.result === "pulled"
            ? "Staging refreshed from production."
            : "Staging updated.");
      toast({ title: "Staging", description: msg });
      qc.invalidateQueries({ queryKey: ["wp-staging", siteId] });
      onChanged();
    },
    onError: (e) =>
      toast({ title: "Staging action failed", description: e instanceof ApiClientError ? e.message : "error", variant: "destructive" }),
  });

  if (detail.isLoading || !detail.data) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-3xl" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Loading site details</DialogTitle>
          <div className="space-y-4">
            <div className="h-8 w-56 rounded-lg bg-muted/50 hipno-shimmer" />
            <div className="h-40 rounded-xl bg-muted/40 hipno-shimmer" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const { site, scan } = detail.data;
  const updates = scan?.updates ?? null;
  const pluginUpdates = updates?.plugins.filter((p) => p.available) ?? [];
  const unknownPlugins = updates?.plugins.filter((p) => p.unknown) ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2.5 pr-7">
            <span className="truncate">{site.name}</span>
            <StatusChip status={site.status} />
            {site.wpVersion && <Badge variant="secondary" className="font-mono text-[11px]">WP {site.wpVersion}</Badge>}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a href={site.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary hover:underline">
              <Globe className="h-3 w-3" aria-hidden /> {site.url.replace(/^https?:\/\//, "")}
            </a>
            <span className="inline-flex items-center gap-1 font-mono text-[11px]" title={site.path}>
              <FolderOpen className="h-3 w-3" aria-hidden /> {site.path}
            </span>
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <div className="overflow-x-auto -mx-1 px-1 pb-1">
            <TabsList aria-label="Site management sections">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="plugins">Plugins ({scan?.plugins.length ?? 0})</TabsTrigger>
              <TabsTrigger value="themes">Themes ({scan?.themes.length ?? 0})</TabsTrigger>
              <TabsTrigger value="updates">
                Updates
                {(updates?.core.available || pluginUpdates.length > 0) && (
                  <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="updates available" />
                )}
              </TabsTrigger>
              <TabsTrigger value="staging">Staging</TabsTrigger>
            </TabsList>
          </div>

          {/* ——————————— overview ——————————— */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid gap-4 md:grid-cols-2">
              <SectionCard title="WordPress core" description={scan ? `Detected from wp-includes/version.php · scanned ${timeAgo(scan.scannedAt)}` : "Not scanned yet"}>
                <div className="space-y-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-semibold tracking-tight">{scan?.core?.version ?? site.wpVersion ?? "—"}</span>
                    <span className="text-xs text-muted-foreground">current version</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="core-auto" className="text-xs">Core auto-updates</Label>
                      <Select defaultValue={site.autoCore} onValueChange={(v) => patchSettings({ autoCore: v })}>
                        <SelectTrigger id="core-auto" aria-label="Core auto-update policy" className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="off">Off</SelectItem>
                          <SelectItem value="minor">Minor only</SelectItem>
                          <SelectItem value="major">Major + minor</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">{AUTO_CORE_LABELS[site.autoCore]}</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="php-sel" className="text-xs">PHP version</Label>
                      <Select defaultValue={site.phpVersion} onValueChange={(v) => patchSettings({ phpVersion: v })}>
                        <SelectTrigger id="php-sel" aria-label="PHP version" className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PHP_VERSIONS.map((v) => (
                            <SelectItem key={v} value={v}>PHP {v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">Recorded for the web-server configuration.</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => runScan.mutate()} disabled={runScan.isPending}>
                      {runScan.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                      Check for updates
                    </Button>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Automatic updates &amp; health" description="Policy stored per site; toggles apply immediately">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Plugin auto-updates</p>
                      <p className="text-xs text-muted-foreground">Apply plugin updates as they appear on wordpress.org</p>
                    </div>
                    <Switch checked={site.autoPlugins} onCheckedChange={(v) => patchSettings({ autoPlugins: v })} aria-label="Plugin auto-updates" />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Theme auto-updates</p>
                      <p className="text-xs text-muted-foreground">Apply theme updates as they appear on wordpress.org</p>
                    </div>
                    <Switch checked={site.autoThemes} onCheckedChange={(v) => patchSettings({ autoThemes: v })} aria-label="Theme auto-updates" />
                  </div>
                  <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">wp-config.php present</span>
                      {scan ? <StatusChip status={scan.wpConfig ? "ok" : "fail"} label={scan.wpConfig ? "present" : "missing"} /> : <StatusChip status="na" label="not scanned" />}
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Authentication salts set</span>
                      {scan ? (
                        <StatusChip status={scan.saltsPresent ? "ok" : "warn"} label={scan.saltsPresent ? "all 8 keys strong" : "placeholder / missing salts"} />
                      ) : (
                        <StatusChip status="na" label="not scanned" />
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Only these booleans are ever read from wp-config.php — file contents and secrets are never exposed.
                    </p>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="One-click admin login" description="Single-use link, valid for 15 minutes" className="md:col-span-2">
                <div className="space-y-3">
                  {!adminLogin ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <Button size="sm" onClick={() => adminLoginMut.mutate()} disabled={adminLoginMut.isPending}>
                        {adminLoginMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
                        Issue admin-login link
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Generates a one-time token (only its SHA-256 hash is stored), then redirects you to the site&apos;s wp-login.php.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-2.5 py-2">
                        <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <code className="min-w-0 flex-1 truncate font-mono text-xs">{adminLogin.url}</code>
                        <CopyBtn text={adminLogin.url} label="Copy the single-use admin login URL" />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="outline" asChild>
                          <a href={adminLogin.url} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open wp-login (consumes the link)
                          </a>
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          Expires {new Date(adminLogin.expiresAt).toLocaleTimeString()} · {!adminLogin.phpRuntime && "no PHP runtime on this host — "}
                          {adminLogin.phpRuntime ? "companion-plugin sign-on available." : "redirects to the standard login page."}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{adminLogin.note}</p>
                    </div>
                  )}
                </div>
              </SectionCard>
            </div>

            <SectionCard
              title="Update history"
              description="Every applied, staged or rolled-back update is recorded with its snapshot"
              actions={scan && scan.history.length > 0 ? <Badge variant="outline">{scan.history.length} entries</Badge> : undefined}
            >
              {!scan || scan.history.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No updates have been applied or staged yet.</p>
              ) : (
                <ul className="max-h-64 overflow-y-auto -mx-1 px-1 space-y-2" aria-label="Update history">
                  {scan.history.map((h, i) => (
                    <li key={`${h.at}-${i}`} className="rounded-lg border bg-muted/25 p-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <StatusChip
                          status={h.result === "applied" ? "ok" : h.result === "staged" ? "info" : "fail"}
                          label={h.result.replace("_", " ")}
                        />
                        <span className="font-medium">{targetLabel(h.target)}</span>
                        <span className="font-mono text-xs text-muted-foreground">{h.from ?? "?"} → {h.to ?? "?"}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{new Date(h.at).toLocaleString()}</span>
                      </div>
                      {h.detail && <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{h.detail}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </TabsContent>

          {/* ——————————— plugins ——————————— */}
          <TabsContent value="plugins" className="mt-4">
            {!scan ? (
              <EmptyState icon={Package} title="Not scanned yet" description="Run a scan to inventory the plugins from their file headers." action={<Button size="sm" variant="outline" onClick={() => runScan.mutate()} disabled={runScan.isPending}>Scan now</Button>} />
            ) : scan.plugins.length === 0 ? (
              <EmptyState icon={Package} title="No plugins found" description="No plugin main files with a “Plugin Name” header exist under wp-content/plugins/." />
            ) : (
              <div className="max-h-[22rem] overflow-y-auto -mx-1 px-1">
                <table className="w-full text-[13px]" aria-label="Installed plugins">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th scope="col" className="py-2 pr-3 font-medium">Plugin</th>
                      <th scope="col" className="py-2 pr-3 font-medium w-24">Version</th>
                      <th scope="col" className="py-2 pr-3 font-medium w-40">Latest (wordpress.org)</th>
                      <th scope="col" className="py-2 font-medium w-28 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scan.plugins.map((p) => {
                      const u = updates?.plugins.find((x) => x.slug === p.slug);
                      return (
                        <tr key={p.slug} className="border-b border-border/60 hover:bg-muted/40 transition-colors">
                          <td className="py-2.5 pr-3">
                            <p className="font-medium truncate" title={p.name}>{p.name}</p>
                            <p className="text-[11px] text-muted-foreground font-mono truncate">{p.file}</p>
                          </td>
                          <td className="py-2.5 pr-3 font-mono text-xs">{p.version}</td>
                          <td className="py-2.5 pr-3 text-xs">
                            {updates?.error ? (
                              <span className="text-muted-foreground">offline</span>
                            ) : !u ? (
                              <span className="text-muted-foreground">not checked</span>
                            ) : u.unknown ? (
                              <span className="text-muted-foreground" title="Not distributed in the wordpress.org directory">not on wordpress.org</span>
                            ) : u.available ? (
                              <span className="text-amber-600 dark:text-amber-400 font-mono">{p.version} → {u.latest}</span>
                            ) : (
                              <span className="text-emerald-600 dark:text-emerald-400">current</span>
                            )}
                          </td>
                          <td className="py-2.5 text-right">
                            {u?.available && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={applyUpdate.isPending}
                                onClick={() => applyUpdate.mutate(`plugin:${p.slug}`)}
                              >
                                {applyUpdate.isPending && applyUpdate.variables === `plugin:${p.slug}` ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                ) : (
                                  <ArrowUpCircle className="h-3.5 w-3.5" aria-hidden />
                                )}
                                Update
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {unknownPlugins.length > 0 && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {unknownPlugins.length} plugin{unknownPlugins.length === 1 ? " is" : "s are"} not distributed on wordpress.org and can only be updated manually.
                  </p>
                )}
              </div>
            )}
          </TabsContent>

          {/* ——————————— themes ——————————— */}
          <TabsContent value="themes" className="mt-4">
            {!scan ? (
              <EmptyState icon={Palette} title="Not scanned yet" description="Run a scan to inventory the themes from their style.css headers." action={<Button size="sm" variant="outline" onClick={() => runScan.mutate()} disabled={runScan.isPending}>Scan now</Button>} />
            ) : scan.themes.length === 0 ? (
              <EmptyState icon={Palette} title="No themes found" description="No themes with a “Theme Name” header exist under wp-content/themes/." />
            ) : (
              <div className="max-h-[22rem] overflow-y-auto -mx-1 px-1">
                <table className="w-full text-[13px]" aria-label="Installed themes">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th scope="col" className="py-2 pr-3 font-medium">Theme</th>
                      <th scope="col" className="py-2 pr-3 font-medium w-24">Version</th>
                      <th scope="col" className="py-2 font-medium w-40">Directory</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scan.themes.map((t) => (
                      <tr key={t.slug} className="border-b border-border/60 hover:bg-muted/40 transition-colors">
                        <td className="py-2.5 pr-3 font-medium truncate" title={t.name}>{t.name}</td>
                        <td className="py-2.5 pr-3 font-mono text-xs">{t.version}</td>
                        <td className="py-2.5 text-[11px] text-muted-foreground font-mono truncate">{t.slug}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          {/* ——————————— updates ——————————— */}
          <TabsContent value="updates" className="mt-4 space-y-4">
            {!scan ? (
              <EmptyState icon={ArrowUpCircle} title="Not scanned yet" description="Run “Check for updates” to compare the installed versions against the live wordpress.org API." action={<Button size="sm" variant="outline" onClick={() => runScan.mutate()} disabled={runScan.isPending}>Check now</Button>} />
            ) : (
              <>
                {updates?.error && (
                  <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3.5 flex items-start gap-2.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">wordpress.org unreachable</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{updates.error} — the inventory above is still the real on-disk state; only the version comparison needs network access to wordpress.org.</p>
                    </div>
                  </div>
                )}

                <SectionCard
                  title="Available updates"
                  description={updates ? `Checked ${timeAgo(updates.checkedAt)} against api.wordpress.org` : "No update check has run yet"}
                  actions={
                    <Button size="sm" variant="outline" onClick={() => runScan.mutate()} disabled={runScan.isPending}>
                      {runScan.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                      Check for updates
                    </Button>
                  }
                >
                  {!updates ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">Run a check to see available updates.</p>
                  ) : !updates.core.available && pluginUpdates.length === 0 ? (
                    <div className="py-6 flex flex-col items-center gap-2 text-center">
                      <ShieldCheck className="h-8 w-8 text-emerald-500" aria-hidden />
                      <p className="text-sm font-medium">Everything is current</p>
                      <p className="text-xs text-muted-foreground">WordPress core and every wordpress.org-distributed plugin are at their latest versions.</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {updates.core.available && (
                        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">WordPress core</p>
                            <p className="font-mono text-xs text-muted-foreground">{updates.core.current} → {updates.core.latest}</p>
                          </div>
                          <Button size="sm" disabled={applyUpdate.isPending} onClick={() => applyUpdate.mutate("core")}>
                            {applyUpdate.isPending && applyUpdate.variables === "core" ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                            ) : (
                              <ArrowUpCircle className="h-3.5 w-3.5" aria-hidden />
                            )}
                            Update core
                          </Button>
                        </div>
                      )}
                      {pluginUpdates.map((p) => {
                        const installed = scan.plugins.find((x) => x.slug === p.slug);
                        return (
                          <div key={p.slug} className="flex flex-wrap items-center gap-3 rounded-lg border p-3.5">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{installed?.name ?? p.slug}</p>
                              <p className="font-mono text-xs text-muted-foreground">{p.current} → {p.latest}</p>
                            </div>
                            <Button size="sm" variant="outline" disabled={applyUpdate.isPending} onClick={() => applyUpdate.mutate(`plugin:${p.slug}`)}>
                              {applyUpdate.isPending && applyUpdate.variables === `plugin:${p.slug}` ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                              ) : (
                                <ArrowUpCircle className="h-3.5 w-3.5" aria-hidden />
                              )}
                              Update
                            </Button>
                          </div>
                        );
                      })}
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Every update writes a snapshot manifest first (<span className="font-mono">data/sites/&lt;id&gt;/wp-snapshots/&lt;ts&gt;.json</span>). After applying, the site URL is health-checked — a 5xx or unreachable site is rolled back automatically.
                      </p>
                    </div>
                  )}
                </SectionCard>
              </>
            )}
          </TabsContent>

          {/* ——————————— staging ——————————— */}
          <TabsContent value="staging" className="mt-4 space-y-4">
            {staging.isLoading ? (
              <div className="h-32 rounded-xl bg-muted/40 hipno-shimmer" />
            ) : !staging.data ? (
              <EmptyState icon={GitBranch} title="Staging status unavailable" description="The staging status could not be read." />
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <SectionCard title="Production" description={site.path}>
                    {staging.data.production ? (
                      <div className="space-y-1.5">
                        <p className="text-2xl font-semibold tracking-tight">{staging.data.production.files.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">files · {fmtBytes(staging.data.production.bytes)}</p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Document root unreadable — check the path exists.</p>
                    )}
                  </SectionCard>
                  <SectionCard title="Staging copy" description={staging.data.staging.exists ? staging.data.staging.path ?? "" : "Not created yet"}>
                    {staging.data.staging.exists ? (
                      <div className="space-y-1.5">
                        <p className="text-2xl font-semibold tracking-tight">{(staging.data.staging.files ?? 0).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">
                          files · {fmtBytes(staging.data.staging.bytes ?? 0)}
                          {staging.data.diff ? ` · diff vs production: ${staging.data.diff.files >= 0 ? "+" : ""}${staging.data.diff.files} files, ${staging.data.diff.bytes >= 0 ? "+" : ""}${fmtBytes(Math.abs(staging.data.diff.bytes))}` : ""}
                        </p>
                        {staging.data.staging.fallback && (
                          <p className="text-[11px] text-muted-foreground">Created under the panel&apos;s data directory (docroot parent not writable).</p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          A real file copy of the document root, created with fs.cp — sibling <span className="font-mono">-staging</span> directory when the parent is writable, otherwise under the panel&apos;s data directory.
                        </p>
                        <Button size="sm" onClick={() => stagingAction.mutate("create")} disabled={stagingAction.isPending}>
                          {stagingAction.isPending && stagingAction.variables === "create" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <GitBranch className="h-3.5 w-3.5" aria-hidden />
                          )}
                          Create staging copy
                        </Button>
                      </div>
                    )}
                  </SectionCard>
                </div>
                {staging.data.staging.exists && (
                  <SectionCard title="Staging lifecycle" description="Push overlays staging onto production; pull refreshes staging from production">
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setPushConfirm(true)} disabled={stagingAction.isPending}>
                        <ArrowUpCircle className="h-3.5 w-3.5" aria-hidden /> Push to production…
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => stagingAction.mutate("pull")} disabled={stagingAction.isPending}>
                        {stagingAction.isPending && stagingAction.variables === "pull" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                        )}
                        Pull from production
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => stagingAction.mutate("delete")} disabled={stagingAction.isPending}>
                        {stagingAction.isPending && stagingAction.variables === "delete" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        )}
                        Delete staging
                      </Button>
                    </div>
                    <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
                      Push overwrites changed files in production (files deleted only in staging are left in place); the production docroot itself is never moved.
                    </p>
                  </SectionCard>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>

        <AlertDialog open={pushConfirm} onOpenChange={setPushConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Push staging onto production?</AlertDialogTitle>
              <AlertDialogDescription>
                Every file that differs in the staging copy overwrites the production document root. This runs immediately — push a fresh scan afterwards and verify the site.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setPushConfirm(false); stagingAction.mutate("push"); }}>
                Push to production
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
