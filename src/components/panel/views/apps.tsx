"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, del, ApiClientError, fmtBytes } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Boxes,
  Globe,
  Play,
  Square,
  RotateCw,
  Trash2,
  MoreHorizontal,
  Copy,
  Eye,
  EyeOff,
  GitBranch,
  Rocket,
  Package,
  History,
  Settings2,
  RefreshCw,
  Loader2,
  Undo2,
  ScrollText,
  TerminalSquare,
} from "lucide-react";

interface EnvVarSpec {
  key: string;
  label: string;
  type: "string" | "secret" | "port" | "number";
  default?: string;
  required: boolean;
  hint?: string;
}

interface AppTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  version: string;
  env: EnvVarSpec[];
  ports: string[];
  volumes: string[];
  compose: string;
}

interface AppRow {
  id: string;
  name: string;
  slug: string;
  templateId: string | null;
  templateName: string | null;
  status: string;
  domains: string[];
  note: string | null;
  createdAt: string;
  updatedAt: string;
  lastDeployAt: string | null;
  releaseCount: number;
  latestRelease: { id: string; version: number; status: string; note: string | null; createdAt: string } | null;
}

interface AppDetail {
  app: AppRow & { composeYaml: string | null; envJson: string | null };
  releases: { id: string; version: number; status: string; note: string | null; createdAt: string }[];
  docker: { available: boolean; version: string | null; error: string | null };
}

const CATEGORY_LABELS: Record<string, string> = {
  cms: "CMS", automation: "Automation", security: "Security", files: "Files",
  dev: "Dev", database: "Database", analytics: "Analytics",
};

function statusBadge(status: string) {
  switch (status) {
    case "running":
      return <Badge variant="default">running</Badge>;
    case "configured":
      return <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">configured — not deployed</Badge>;
    case "stopped":
      return <Badge variant="outline">stopped</Badge>;
    default:
      return <Badge variant="destructive">{status}</Badge>;
  }
}

export function AppsView() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [deployOpen, setDeployOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AppRow | null>(null);
  const [deleteText, setDeleteText] = useState("");

  const templates = useQuery<{ templates: AppTemplate[] }>({
    queryKey: ["app-templates"],
    queryFn: () => get("/api/apps/templates"),
  });
  const apps = useQuery<{ apps: AppRow[] }>({
    queryKey: ["apps"],
    queryFn: () => get("/api/apps"),
    refetchInterval: 20_000,
  });

  const action = useMutation({
    mutationFn: async ({ id, act }: { id: string; act: string }) =>
      post(`/api/apps/${id}/action`, { action: act }),
    onSuccess: (_d, v) => {
      toast({ title: `Action “${v.act}” sent` });
      qc.invalidateQueries({ queryKey: ["apps"] });
      qc.invalidateQueries({ queryKey: ["app-detail"] });
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.code === "docker_unavailable") {
        toast({ title: "Docker backend unavailable", description: e.message, variant: "destructive" });
      } else {
        toast({ title: "Failed", description: e instanceof Error ? e.message : "error", variant: "destructive" });
      }
    },
  });

  const deleteApp = useMutation({
    mutationFn: (id: string) => del(`/api/apps/${id}`),
    onSuccess: () => {
      toast({ title: "App deleted" });
      setDeleteTarget(null);
      setDeleteText("");
      qc.invalidateQueries({ queryKey: ["apps"] });
    },
    onError: (e) => toast({ title: "Delete failed", description: String(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Apps</h2>
        <Badge variant="outline" className="cursor-default">{templates.data?.templates.length ?? "…"} templates</Badge>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setGitOpen(true)}>
            <GitBranch className="h-4 w-4" aria-hidden /> Deploy from Git
          </Button>
          <Button size="sm" onClick={() => setDeployOpen(true)}>
            <Rocket className="h-4 w-4" aria-hidden /> Deploy App
          </Button>
        </div>
      </div>

      {/* Docker availability banner — honest, probed live */}
      <Card>
        <CardContent className="p-4 flex items-start gap-3 text-sm">
          <Package className="h-4 w-4 mt-0.5 text-primary shrink-0" aria-hidden />
          <p className="text-muted-foreground">
            Apps deploy for real on Docker Engine (one-command <span className="font-mono text-xs">docker compose up</span>). The
            backend is probed live — when Docker is missing, deploys are <strong>refused with an error</strong> (never faked):
            install Docker and press Deploy. Nothing is ever reported running unless it actually is.
          </p>
        </CardContent>
      </Card>

      {/* Apps list */}
      {apps.isLoading ? (
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      ) : apps.isError ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          Could not load apps. <Button variant="link" onClick={() => apps.refetch()}>Retry</Button>
        </CardContent></Card>
      ) : !apps.data?.apps.length ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Boxes className="h-10 w-10 mx-auto text-muted-foreground" aria-hidden />
            <p className="font-medium">No apps yet</p>
            <p className="text-sm text-muted-foreground">Deploy your first app from the catalogue — WordPress, n8n, Uptime Kuma, and more.</p>
            <Button onClick={() => setDeployOpen(true)}><Rocket className="h-4 w-4" aria-hidden /> Deploy App</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {apps.data.apps.map((a) => (
            <Card key={a.id} className="hover:shadow-sm transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate cursor-pointer hover:text-primary" onClick={() => setDetailId(a.id)}>
                      {a.name}
                    </CardTitle>
                    <CardDescription className="truncate">{a.templateName || "custom"}</CardDescription>
                  </div>
                  {statusBadge(a.status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {a.domains.length > 0 && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                    <Globe className="h-3 w-3" aria-hidden /> {a.domains.join(", ")}
                  </p>
                )}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{a.releaseCount} release{a.releaseCount === 1 ? "" : "s"}</span>
                  <span>{a.lastDeployAt ? `deployed ${new Date(a.lastDeployAt).toLocaleString()}` : "never deployed"}</span>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => action.mutate({ id: a.id, act: "redeploy" })}>
                    <Play className="h-3.5 w-3.5" aria-hidden /> Deploy
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDetailId(a.id)}>
                    <Settings2 className="h-3.5 w-3.5" aria-hidden /> Manage
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost" aria-label={`Actions for ${a.name}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => action.mutate({ id: a.id, act: "start" })}>
                        <Play className="h-4 w-4" aria-hidden /> Start
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => action.mutate({ id: a.id, act: "stop" })}>
                        <Square className="h-4 w-4" aria-hidden /> Stop
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => action.mutate({ id: a.id, act: "restart" })}>
                        <RotateCw className="h-4 w-4" aria-hidden /> Restart
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => { setDeleteTarget(a); setDeleteText(""); }}>
                        <Trash2 className="h-4 w-4" aria-hidden /> Delete…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {deployOpen && (
        <DeployWizard
          templates={templates.data?.templates || []}
          onClose={() => setDeployOpen(false)}
          onDone={() => {
            setDeployOpen(false);
            qc.invalidateQueries({ queryKey: ["apps"] });
          }}
        />
      )}
      {gitOpen && (
        <GitDeployDialog
          onClose={() => setGitOpen(false)}
          onDone={() => {
            setGitOpen(false);
            qc.invalidateQueries({ queryKey: ["apps"] });
          }}
        />
      )}
      {detailId && (
        <AppDetailPanel
          id={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ["apps"] });
            qc.invalidateQueries({ queryKey: ["app-detail"] });
          }}
        />
      )}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the app and its release history. Type <strong>{deleteTarget?.slug}</strong> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={deleteText}
            onChange={(e) => setDeleteText(e.target.value)}
            placeholder={deleteTarget?.slug}
            aria-label="Type the app slug to confirm deletion"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteText !== deleteTarget?.slug}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteApp.mutate(deleteTarget.id)}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ wizard */

function DeployWizard({
  templates,
  onClose,
  onDone,
}: {
  templates: AppTemplate[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<AppTemplate | null>(null);
  const [name, setName] = useState("");
  const [env, setEnv] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [domains, setDomains] = useState("");
  const [busy, setBusy] = useState(false);

  function pick(t: AppTemplate) {
    setSelected(t);
    const init: Record<string, string> = {};
    for (const e of t.env) init[e.key] = e.default || "";
    setEnv(init);
    setName(t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""));
  }

  async function generateSecret(key: string) {
    const res = await fetch("/api/apps/templates").catch(() => null); // keep query warm
    void res;
    // Client-side generation preview; server generates authoritative secrets
    const arr = new Uint8Array(24);
    crypto.getRandomValues(arr);
    const b62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    for (const b of arr) if (b < 256 - (256 % 62)) out += b62[b % 62];
    setEnv((e) => ({ ...e, [key]: out.slice(0, 24) }));
    setRevealed((r) => ({ ...r, [key]: true }));
  }

  async function deploy() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await post<{
        app: AppRow;
        deployment: { attempted: boolean; ok: boolean; dockerAvailable: boolean; version?: number; error?: string };
      }>("/api/apps", {
        name,
        templateId: selected.id,
        env,
        domains: domains.split(",").map((d) => d.trim()).filter(Boolean),
      });
      const dep = res.deployment;
      if (dep?.ok) {
        toast({ title: `${selected.name} deployed`, description: `Running on Docker (release v${dep.version}).` });
      } else if (dep && !dep.dockerAvailable) {
        toast({
          title: `${selected.name} saved — NOT deployed`,
          description: "Docker Engine is unavailable on this server. The configuration is stored; install Docker, then press Deploy.",
          variant: "destructive",
        });
      } else {
        toast({
          title: `${selected.name} saved — deployment failed`,
          description: dep?.error ?? "docker compose failed",
          variant: "destructive",
        });
      }
      qc.invalidateQueries({ queryKey: ["apps"] });
      onDone();
    } catch (e) {
      toast({ title: "Deploy failed", description: e instanceof Error ? e.message : "error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const byCategory = useMemo(() => {
    const m = new Map<string, AppTemplate[]>();
    for (const t of templates) {
      const arr = m.get(t.category) || [];
      arr.push(t);
      m.set(t.category, arr);
    }
    return m;
  }, [templates]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        {!selected ? (
          <>
            <DialogHeader>
              <DialogTitle>App catalogue</DialogTitle>
              <DialogDescription>Original one-click templates with env schema, secrets and health checks.</DialogDescription>
            </DialogHeader>
            <div className="space-y-5">
              {[...byCategory.entries()].map(([cat, list]) => (
                <div key={cat}>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                    {CATEGORY_LABELS[cat] || cat}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {list.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => pick(t)}
                        className="text-left rounded-lg border p-3 hover:border-primary/50 hover:bg-muted/40 transition-colors"
                      >
                        <p className="font-medium text-sm">{t.name}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{t.description}</p>
                        <p className="text-[11px] text-muted-foreground mt-1.5">v{t.version}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Deploy {selected.name}</DialogTitle>
              <DialogDescription>
                v{selected.version} · ports {selected.ports.join(", ") || "—"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="app-name">App name</Label>
                <Input id="app-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-app" />
              </div>
              <div className="space-y-2">
                <Label>Environment</Label>
                {selected.env.length === 0 && <p className="text-sm text-muted-foreground">No configuration needed.</p>}
                {selected.env.map((e) => (
                  <div key={e.key} className="flex items-center gap-2">
                    <div className="w-40 shrink-0">
                      <p className="text-sm truncate" title={e.key}>{e.label}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{e.key}</p>
                    </div>
                    <div className="relative flex-1">
                      <Input
                        type={e.type === "secret" && !revealed[e.key] && env[e.key] ? "password" : "text"}
                        value={env[e.key] || ""}
                        onChange={(ev) => setEnv((s) => ({ ...s, [e.key]: ev.target.value }))}
                        placeholder={e.hint || e.type}
                        aria-label={`${e.label} (${e.key})`}
                      />
                      {e.type === "secret" && env[e.key] && (
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                          onClick={() => setRevealed((r) => ({ ...r, [e.key]: !r[e.key] }))}
                          aria-label={revealed[e.key] ? "Hide secret" : "Reveal secret"}
                        >
                          {revealed[e.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      )}
                    </div>
                    {e.type === "secret" && (
                      <Button type="button" size="sm" variant="outline" onClick={() => generateSecret(e.key)}>
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Generate
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <Label htmlFor="app-domains">Domains (optional, comma separated)</Label>
                <Input id="app-domains" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="app.example.com" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setSelected(null)}>Back</Button>
                <Button className="flex-1" disabled={busy || !name} onClick={deploy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Rocket className="h-4 w-4" aria-hidden />}
                  Stage deployment
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------- git deploy */

function GitDeployDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [dockerfilePath, setDockerfilePath] = useState("./Dockerfile");
  const [hostPort, setHostPort] = useState("3000");
  const [containerPort, setContainerPort] = useState("3000");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await post("/api/apps/git", {
        name,
        repoUrl,
        branch,
        dockerfilePath,
        hostPort: Number(hostPort),
        containerPort: Number(containerPort),
      });
      toast({ title: "Git app saved — NOT deployed", description: "Webhook secret + build config stored. Deployment needs Docker Engine; press Deploy once it is installed.", variant: "destructive" });
      onDone();
    } catch (e) {
      toast({ title: "Failed", description: e instanceof Error ? e.message : "error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><GitBranch className="h-4 w-4" aria-hidden /> Deploy from Git</DialogTitle>
          <DialogDescription>
            Stages a build config. Private repos use deploy keys on the VPS deployment; webhooks are HMAC-verified.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="git-name">App name</Label>
            <Input id="git-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-service" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="git-repo">Repository URL</Label>
            <Input id="git-repo" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/user/repo" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="git-branch">Branch</Label>
              <Input id="git-branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="git-docker">Dockerfile path</Label>
              <Input id="git-docker" value={dockerfilePath} onChange={(e) => setDockerfilePath(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="git-hport">Host port</Label>
              <Input id="git-hport" inputMode="numeric" value={hostPort} onChange={(e) => setHostPort(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="git-cport">Container port</Label>
              <Input id="git-cport" inputMode="numeric" value={containerPort} onChange={(e) => setContainerPort(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Git builds require the Docker backend — on the VPS deployment every push rebuilds with zero-downtime swap and rollback.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={busy || !name || !repoUrl} onClick={submit}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Stage Git app
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------------------------------------- detail */

function AppDetailPanel({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const detail = useQuery<AppDetail>({
    queryKey: ["app-detail", id],
    queryFn: () => get<AppDetail>(`/api/apps/${id}`),
  });
  const [secrets, setSecrets] = useState<Record<string, string> | null>(null);
  const [rollbackConfirm, setRollbackConfirm] = useState<string | null>(null);

  const rollback = useMutation({
    mutationFn: (releaseId: string) => post(`/api/apps/${id}/rollback`, { releaseId }),
    onSuccess: () => {
      toast({ title: "Rollback requested" });
      setRollbackConfirm(null);
      onChanged();
      detail.refetch();
    },
    onError: (e) =>
      toast({
        title: "Rollback not applied",
        description: e instanceof ApiClientError && e.code === "docker_unavailable" ? e.message : String(e),
        variant: "destructive",
      }),
  });

  if (detail.isLoading) {
    return (
      <Dialog open onOpenChange={() => onClose()}>
        <DialogContent className="max-w-3xl">
          <div className="h-64 rounded-lg bg-muted animate-pulse" />
        </DialogContent>
      </Dialog>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Dialog open onOpenChange={() => onClose()}>
        <DialogContent className="max-w-3xl">
          <p className="text-sm text-destructive">Could not load app details.</p>
        </DialogContent>
      </Dialog>
    );
  }

  const { app, releases, docker } = detail.data;

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {app.name} {statusBadge(app.status)}
          </DialogTitle>
          <DialogDescription>
            {app.templateName || "git/custom"} · slug {app.slug}
          </DialogDescription>
        </DialogHeader>

        {/* Docker banner */}
        <div
          className={`rounded-lg border p-3 text-sm ${
            docker.available
              ? "border-primary/40 bg-primary/5 text-foreground"
              : "border-amber-500/40 bg-amber-500/5 text-foreground"
          }`}
          role="status"
        >
          {docker.available ? (
            <>Docker Engine v{docker.version} detected — actions run for real.</>
          ) : (
            <>Docker Engine is <strong>unavailable</strong> on this server ({docker.error}). Deploys/logs/console are refused honestly — install Docker, then press Deploy. The Compose file below is ready to go.</>
          )}
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="env">Environment</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="releases">Releases</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => { post(`/api/apps/${id}/action`, { action: "redeploy" }).then(onChanged).catch((e) => toast({ title: "Deploy failed", description: String(e), variant: "destructive" })); }}>
                <Play className="h-3.5 w-3.5" aria-hidden /> Deploy / Redeploy
              </Button>
              <Button size="sm" variant="outline" onClick={() => { post(`/api/apps/${id}/action`, { action: "restart" }).then(onChanged).catch((e) => toast({ title: "Failed", description: String(e) })); }}>
                <RotateCw className="h-3.5 w-3.5" aria-hidden /> Restart
              </Button>
              <Button size="sm" variant="outline" onClick={() => { post(`/api/apps/${id}/action`, { action: "stop" }).then(onChanged).catch((e) => toast({ title: "Failed", description: String(e) })); }}>
                <Square className="h-3.5 w-3.5" aria-hidden /> Stop
              </Button>
              <Button
                size="sm"
                variant="outline"
                title={docker.available ? "Open a shell inside the app's first container (Terminal module)" : "Needs Docker"}
                disabled={!docker.available}
                onClick={() => {
                  onChanged();
                  // open the panel terminal with the exec command pre-typed via clipboard hint
                  const cmd = `docker compose -f /var/lib/hipno/apps/${app.slug}/compose.yaml exec \$(docker compose -f /var/lib/hipno/apps/${app.slug}/compose.yaml ps -q main 2>/dev/null || docker compose -f /var/lib/hipno/apps/${app.slug}/compose.yaml ps -q | head -1) sh`;
                  navigator.clipboard?.writeText(cmd).catch(() => {});
                  toast({
                    title: "Console command copied",
                    description: "Open Terminal and paste to get a shell inside the container. (The exact docker compose exec command is on your clipboard.)",
                  });
                }}
              >
                <TerminalSquare className="h-3.5 w-3.5" aria-hidden /> Console
              </Button>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-sm font-medium">Generated docker-compose.yml</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(app.composeYaml || "");
                    toast({ title: "Copied compose file" });
                  }}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden /> Copy
                </Button>
              </div>
              <pre className="rounded-lg border bg-muted/50 p-3 text-xs font-mono max-h-72 overflow-auto whitespace-pre-wrap">
                {app.composeYaml || "—"}
              </pre>
            </div>
          </TabsContent>
          <TabsContent value="env" className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Environment variables</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      const r = await get<{ secrets: Record<string, string> }>(`/api/apps/${id}/secrets`);
                      setSecrets(r.secrets);
                      toast({ title: "Secrets revealed", description: "They are masked again when you close this dialog." });
                    } catch (e) {
                      toast({ title: "Cannot reveal", description: String(e), variant: "destructive" });
                    }
                  }}
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden /> Reveal secrets
                </Button>
              </div>
            </div>
            <div className="rounded-lg border max-h-72 overflow-y-auto">
              {(() => {
                let plain: Record<string, string> = {};
                try {
                  plain = app.envJson ? JSON.parse(app.envJson) : {};
                } catch {}
                const all = { ...plain, ...(secrets || {}) };
                const secretKeys = new Set(Object.keys(secrets || {}));
                const entries = Object.entries(all);
                if (!entries.length) return <p className="p-3 text-sm text-muted-foreground">No environment variables.</p>;
                return (
                  <table className="w-full text-sm">
                    <tbody>
                      {entries.map(([k, v]) => (
                        <tr key={k} className="border-b last:border-0">
                          <td className="p-2 font-mono text-xs w-48 align-top">{k}</td>
                          <td className="p-2 font-mono text-xs break-all">
                            {secretKeys.has(k) ? v : v}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
            <p className="text-xs text-muted-foreground">
              Secrets are encrypted at rest (AES-256-GCM) and only decrypted for authorized reveals — every reveal is audit-logged.
            </p>
          </TabsContent>
          <TabsContent value="logs" className="space-y-3">
            <AppLogsPanel id={id} slug={app.slug} dockerAvailable={docker.available} />
          </TabsContent>
          <TabsContent value="releases" className="space-y-2">
            {releases.length === 0 && <p className="text-sm text-muted-foreground">No releases yet.</p>}
            {releases.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-lg border p-3">
                <History className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    v{r.version} <span className="text-muted-foreground font-normal">· {r.status}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()} {r.note ? `· ${r.note}` : ""}
                  </p>
                </div>
                {releases.length > 1 && r.version !== releases[0].version && (
                  <Button size="sm" variant="outline" onClick={() => setRollbackConfirm(r.id)}>
                    <Undo2 className="h-3.5 w-3.5" aria-hidden /> Rollback here
                  </Button>
                )}
              </div>
            ))}
          </TabsContent>
        </Tabs>

        <AlertDialog open={!!rollbackConfirm} onOpenChange={(o) => !o && setRollbackConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Roll back to this release?</AlertDialogTitle>
              <AlertDialogDescription>
                The compose file of the selected release becomes active and is redeployed. Without the Docker backend the rollback is only recorded — nothing is faked.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => rollbackConfirm && rollback.mutate(rollbackConfirm)}>Rollback</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

/** Real container logs — `docker compose logs`, honest 409 without Docker. */
function AppLogsPanel({ id, slug, dockerAvailable }: { id: string; slug: string; dockerAvailable: boolean }) {
  const [tail, setTail] = useState(200);
  const logs = useQuery<{ slug: string; tail: number; logs: string[] }>({
    queryKey: ["app-logs", id, tail],
    queryFn: () => get(`/api/apps/${id}/logs?tail=${tail}`),
    enabled: dockerAvailable,
    refetchInterval: 10_000,
    retry: false,
  });

  if (!dockerAvailable) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm" role="status">
        Docker Engine is unavailable on this server — container logs cannot be read here. Once Docker is installed, the
        last lines refresh every 10 s.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          <ScrollText className="inline h-3.5 w-3.5 mr-1 -mt-0.5" aria-hidden />
          <span className="font-mono">docker compose logs</span> · {slug}
        </p>
        <div className="flex items-center gap-2">
          <Select value={String(tail)} onValueChange={(v) => setTail(Number(v))}>
            <SelectTrigger className="h-8 w-24" aria-label="Lines to show">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="50">50 lines</SelectItem>
              <SelectItem value="200">200 lines</SelectItem>
              <SelectItem value="500">500 lines</SelectItem>
              <SelectItem value="1000">1000 lines</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => logs.refetch()} disabled={logs.isFetching}>
            {logs.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            Refresh
          </Button>
        </div>
      </div>
      {logs.isError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {logs.error instanceof Error ? logs.error.message : "Could not read logs"}
        </div>
      ) : logs.isLoading ? (
        <div className="h-40 rounded-lg bg-muted animate-pulse" />
      ) : (
        <pre className="rounded-lg border bg-muted/50 p-3 text-xs font-mono max-h-80 overflow-auto whitespace-pre-wrap">
          {logs.data?.logs?.length ? logs.data.logs.join("\n") : "(no output yet)"}
        </pre>
      )}
      <p className="text-xs text-muted-foreground">Live from the Docker backend, refreshed every 10 seconds.</p>
    </div>
  );
}
