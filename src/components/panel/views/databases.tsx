"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ApiClientError, del, fmtBytes, get, post } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
  Database,
  Server,
  Plus,
  RefreshCw,
  Trash2,
  Loader2,
  Terminal,
  Download,
  Upload,
  Play,
  Info,
  AlertTriangle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// API shapes (server: src/app/api/databases/**)
// ---------------------------------------------------------------------------

interface PanelDbRow {
  id: string;
  name: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  exists?: boolean;
}

interface EngineInfo {
  id: "sqlite" | "mariadb" | "postgresql";
  installed: boolean;
  installCommand?: string;
}

type QueryResult =
  | {
      kind: "select";
      columns: string[];
      rows: Record<string, unknown>[];
      rowCount: number;
      truncated: boolean;
      durationMs: number;
    }
  | {
      kind: "write";
      changes: number;
      lastInsertRowid: string;
      durationMs: number;
    };

const DB_NAME_HINT = "3–41 chars: lowercase letter first, then a–z, 0–9 or _";
const DB_NAME_OK_RE = /^[a-z][a-z0-9_]{2,40}$/;

/** Base-path aware href builder (mirrors buildUrl in src/lib/api.ts). */
function buildHref(path: string): string {
  const base = typeof window !== "undefined" ? window.__HIPNO_BASE__ || "" : "";
  const url = path.startsWith("/") ? path : `/${path}`;
  if (!base) return url;
  const joiner = url.includes("?") ? "&" : "?";
  return `${base}${url}${joiner}XTransformPort=${window.__HIPNO_PORT__ || 3005}`;
}

function errMessage(e: unknown): string {
  return e instanceof ApiClientError ? e.message : "Unexpected error";
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "MMM d, yyyy HH:mm");
  } catch {
    return "—";
  }
}

/** Multipart import — raw fetch so the browser sets the multipart boundary. */
async function importSqlFile(dbId: string, file: File): Promise<{ ok: boolean; importedBytes: number }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(buildHref(`/api/databases/${dbId}/import`), {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });
  let data: { error?: string; code?: string; ok?: boolean; importedBytes?: number } = {};
  try {
    data = (await res.json()) as typeof data;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    throw new ApiClientError(res.status, data.code || "error", data.error || `HTTP ${res.status}`);
  }
  return { ok: !!data.ok, importedBytes: data.importedBytes || 0 };
}

/** Render one SQL result cell (NULL badge, blobs, long values). */
function SqlCell({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <Badge variant="outline" className="cursor-default text-muted-foreground font-mono font-normal">
        NULL
      </Badge>
    );
  }
  if (typeof value === "number") {
    return <span className="font-mono text-xs tabular-nums">{value}</span>;
  }
  if (typeof value === "object") {
    return (
      <span className="font-mono text-xs text-muted-foreground" title={JSON.stringify(value)}>
        {JSON.stringify(value).slice(0, 40)}
        {JSON.stringify(value).length > 40 ? "…" : ""}
      </span>
    );
  }
  const text = String(value);
  return (
    <span className="font-mono text-xs" title={text}>
      {text.length > 80 ? `${text.slice(0, 80)}…` : text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function DatabasesView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const consoleRef = useRef<HTMLDivElement | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PanelDbRow | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [importTarget, setImportTarget] = useState<PanelDbRow | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);

  // console state
  const [consoleDbId, setConsoleDbId] = useState("");
  const [sql, setSql] = useState("");
  const [readOnly, setReadOnly] = useState(true);
  const [roConfirmOpen, setRoConfirmOpen] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);

  const list = useQuery<{ databases: PanelDbRow[] }>({
    queryKey: ["databases"],
    queryFn: () => get<{ databases: PanelDbRow[] }>("/api/databases"),
  });

  const engines = useQuery<{ engines: EngineInfo[] }>({
    queryKey: ["db-engines"],
    queryFn: () => get<{ engines: EngineInfo[] }>("/api/databases/engines"),
    staleTime: 60_000,
  });

  const databases = list.data?.databases ?? [];
  const consoleDb = databases.find((d) => d.id === consoleDbId) ?? null;

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["databases"] });
  }

  const create = useMutation({
    mutationFn: () => post<{ database: PanelDbRow }>("/api/databases", { name: newName.trim() }),
    onSuccess: (data) => {
      toast({
        title: "Database created",
        description: `${data.database.name} — real SQLite file at data/databases/${data.database.fileName}.`,
      });
      setCreateOpen(false);
      setNewName("");
      invalidate();
    },
    onError: (e) => {
      toast({ title: "Could not create database", description: errMessage(e), variant: "destructive" });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => del<{ ok: boolean }>(`/api/databases/${id}`),
    onSuccess: (_data, id) => {
      toast({ title: "Database deleted", description: "File removed from data/databases." });
      setDeleteTarget(null);
      setDeleteText("");
      if (consoleDbId === id) {
        setConsoleDbId("");
        setResult(null);
      }
      invalidate();
    },
    onError: (e) => {
      toast({ title: "Delete failed", description: errMessage(e), variant: "destructive" });
    },
  });

  const execute = useMutation({
    mutationFn: () =>
      post<QueryResult>(`/api/databases/${consoleDbId}/query`, {
        sql: sql.trim(),
        readOnly,
      }),
    onSuccess: (data) => {
      setResult(data);
      invalidate(); // sizes may have changed after a write
    },
    onError: (e) => {
      setResult(null);
      toast({ title: "Query failed", description: errMessage(e), variant: "destructive" });
    },
  });

  const doImport = useMutation({
    mutationFn: () => {
      if (!importTarget || !importFile) return Promise.reject(new Error("no file"));
      return importSqlFile(importTarget.id, importFile);
    },
    onSuccess: (data) => {
      toast({
        title: "Import complete",
        description: `${fmtBytes(data.importedBytes)} of SQL executed against ${importTarget?.name}.`,
      });
      setImportTarget(null);
      setImportFile(null);
      invalidate();
    },
    onError: (e) => {
      toast({ title: "Import failed", description: errMessage(e), variant: "destructive" });
    },
  });

  function openConsole(db: PanelDbRow) {
    setConsoleDbId(db.id);
    setResult(null);
    setSql((prev) => (prev.trim() ? prev : "SELECT name FROM sqlite_master WHERE type='table';"));
    requestAnimationFrame(() => {
      consoleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Databases</h1>
          <p className="text-sm text-muted-foreground">
            Real SQLite database files in <code className="font-mono text-xs">data/databases</code>{" "}
            — with a SQL console, exports and imports.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden /> Create Database
        </Button>
      </div>

      {/* Engine cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {engines.isLoading ? (
          [...Array(3)].map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-xl" />)
        ) : (
          (engines.data?.engines ?? [{ id: "sqlite", installed: true } as EngineInfo]).map((engine) => {
            const isSqlite = engine.id === "sqlite";
            const meta: Record<
              string,
              { title: string; desc: string; icon: typeof Database }
            > = {
              sqlite: {
                title: "SQLite",
                desc: "Bundled with the panel (better-sqlite3). Every database is a real file, managed here.",
                icon: Database,
              },
              mariadb: {
                title: "MariaDB",
                desc: "MySQL-compatible engine for workloads that need it.",
                icon: Server,
              },
              postgresql: {
                title: "PostgreSQL",
                desc: "Advanced relational engine for demanding workloads.",
                icon: Server,
              },
            };
            const m = meta[engine.id];
            const Icon = m.icon;
            return (
              <Card key={engine.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon
                        className={`h-5 w-5 ${isSqlite ? "text-primary" : "text-muted-foreground"}`}
                        aria-hidden
                      />
                      <span className="font-medium">{m.title}</span>
                    </div>
                    {engine.installed ? (
                      <Badge
                        variant="outline"
                        className={`cursor-default ${
                          isSqlite ? "border-primary/40 text-primary" : "text-muted-foreground"
                        }`}
                      >
                        {isSqlite ? "built-in · active" : "installed"}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="cursor-default border-amber-500/50 text-amber-700 dark:text-amber-300"
                      >
                        not installed — installs on the VPS deployment
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{m.desc}</p>
                  {!engine.installed && engine.installCommand && (
                    <div className="rounded-lg border bg-muted/40 px-2.5 py-1.5 font-mono text-xs overflow-x-auto">
                      {engine.installCommand}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Database list */}
      {list.isLoading ? (
        <Card>
          <CardContent className="p-4 space-y-2" role="status" aria-label="Loading databases">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : list.isError ? (
        <Card>
          <CardContent className="py-10 text-center space-y-3" role="alert">
            <p className="text-sm text-muted-foreground">
              Could not load databases. {errMessage(list.error)}
            </p>
            <Button variant="outline" onClick={() => list.refetch()}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : databases.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border bg-muted/40">
              <Database className="h-6 w-6 text-muted-foreground" aria-hidden />
            </div>
            <div className="space-y-1">
              <p className="font-medium">No databases yet</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Create a database — it becomes a real SQLite file you can query, export and
                import from the console below.
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Create Database
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4">
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-3 font-medium">Name</th>
                    <th className="py-2 pr-3 font-medium">Size</th>
                    <th className="py-2 pr-3 font-medium">Created</th>
                    <th className="py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {databases.map((d) => (
                    <tr key={d.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2 font-medium">
                          <Database className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                          {d.name}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono hidden sm:block">
                          {d.fileName}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        {d.exists === false ? (
                          <Badge variant="outline" className="cursor-default text-destructive border-destructive/40">
                            file missing
                          </Badge>
                        ) : (
                          fmtBytes(d.sizeBytes)
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(d.createdAt)}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1.5">
                          <Button variant="outline" size="sm" onClick={() => openConsole(d)}>
                            <Terminal className="h-4 w-4" aria-hidden /> Console
                          </Button>
                          <Button variant="outline" size="sm" asChild>
                            <a
                              href={buildHref(`/api/databases/${d.id}/export`)}
                              download={`${d.name}.sql`}
                              aria-label={`Export ${d.name} as .sql`}
                            >
                              <Download className="h-4 w-4" aria-hidden /> Export
                            </a>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setImportFile(null);
                              setImportTarget(d);
                            }}
                          >
                            <Upload className="h-4 w-4" aria-hidden /> Import
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => {
                              setDeleteText("");
                              setDeleteTarget(d);
                            }}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden /> Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="pt-3 text-xs text-muted-foreground">
              {databases.length} database{databases.length === 1 ? "" : "s"} · SQLite files live
              in <code className="font-mono">data/databases</code>.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Query console */}
      <div ref={consoleRef}>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Terminal className="h-4 w-4 text-muted-foreground" aria-hidden /> SQL Console
              </CardTitle>
              {consoleDb && (
                <span className="text-xs text-muted-foreground font-mono">
                  data/databases/{consoleDb.fileName}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5 min-w-56 flex-1">
                <Label htmlFor="console-db">Database</Label>
                <Select
                  value={consoleDbId || undefined}
                  onValueChange={(v) => {
                    setConsoleDbId(v);
                    setResult(null);
                  }}
                >
                  <SelectTrigger id="console-db" aria-label="Select database for the console">
                    <SelectValue placeholder={databases.length ? "Choose database…" : "No databases"} />
                  </SelectTrigger>
                  <SelectContent>
                    {databases.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        <span className="font-mono">{d.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 pb-1">
                <Switch
                  id="readonly-toggle"
                  checked={readOnly}
                  onCheckedChange={(checked) => {
                    if (!checked) {
                      setRoConfirmOpen(true);
                    } else {
                      setReadOnly(true);
                    }
                  }}
                  aria-label="Read-only mode"
                />
                <Label htmlFor="readonly-toggle" className="text-sm whitespace-nowrap">
                  Read-only
                </Label>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sql-input">SQL statement</Label>
              <Textarea
                id="sql-input"
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                placeholder={
                  readOnly
                    ? "SELECT name FROM sqlite_master WHERE type='table';"
                    : "CREATE TABLE t (x);"
                }
                className="font-mono text-xs min-h-24"
                spellCheck={false}
                aria-required
              />
              <p className="text-xs text-muted-foreground">
                Single statement per run{readOnly ? " — read-only mode accepts SELECT / PRAGMA only" : ""}.
                Writes are audit-logged (statement type only, never the SQL body).
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                disabled={!consoleDbId || !sql.trim() || execute.isPending}
                onClick={() => execute.mutate()}
              >
                {execute.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Play className="h-4 w-4" aria-hidden />
                )}
                Execute
              </Button>
              {result && (
                <span className="text-xs text-muted-foreground">
                  {result.kind === "select"
                    ? `${result.rowCount} row${result.rowCount === 1 ? "" : "s"}`
                    : `${result.changes} change${result.changes === 1 ? "" : "s"}`}{" "}
                  · {result.durationMs} ms
                </span>
              )}
            </div>

            {/* Results */}
            {execute.isError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                <div>
                  <p className="font-medium">Query error</p>
                  <p className="text-xs break-words">{errMessage(execute.error)}</p>
                </div>
              </div>
            )}

            {result?.kind === "select" && (
              <div className="space-y-2">
                <div className="max-h-96 overflow-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-background">
                      <tr className="text-left text-xs text-muted-foreground border-b">
                        {result.columns.map((c) => (
                          <th key={c} className="px-3 py-2 font-mono font-medium whitespace-nowrap">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={Math.max(result.columns.length, 1)}
                            className="px-3 py-6 text-center text-sm text-muted-foreground"
                          >
                            0 rows returned
                          </td>
                        </tr>
                      ) : (
                        result.rows.map((row, i) => (
                          <tr key={i} className="border-b last:border-0 hover:bg-muted/40">
                            {result.columns.map((c) => (
                              <td key={c} className="px-3 py-1.5 max-w-64 truncate">
                                <SqlCell value={row[c]} />
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {result.truncated && (
                  <p className="text-xs text-muted-foreground">
                    Results truncated to the first {result.rows.length} rows / 500KB.
                  </p>
                )}
              </div>
            )}

            {result?.kind === "write" && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm"
              >
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" aria-hidden />
                <p>
                  Statement executed — <span className="font-semibold">{result.changes}</span>{" "}
                  row{result.changes === 1 ? "" : "s"} affected
                  {result.lastInsertRowid && result.lastInsertRowid !== "0" && (
                    <>
                      , last insert rowid{" "}
                      <span className="font-mono">{result.lastInsertRowid}</span>
                    </>
                  )}
                  .
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Database</DialogTitle>
            <DialogDescription>
              Creates a real SQLite file in{" "}
              <code className="font-mono text-xs">data/databases/&lt;name&gt;.db</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="db-name">Name</Label>
            <Input
              id="db-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="shop"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={newName.length > 0 && !DB_NAME_OK_RE.test(newName)}
              aria-describedby="db-name-hint"
            />
            <p id="db-name-hint" className="text-xs text-muted-foreground">
              {DB_NAME_HINT}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!DB_NAME_OK_RE.test(newName.trim()) || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import dialog */}
      <Dialog open={!!importTarget} onOpenChange={(open) => !open && setImportTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import into {importTarget?.name}</DialogTitle>
            <DialogDescription>
              Upload a <span className="font-mono">.sql</span> dump (≤ 20MB). Statements are
              executed inside a transaction; a failure rolls everything back.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="import-file">SQL dump file</Label>
            <Input
              id="import-file"
              type="file"
              accept=".sql,text/sql,application/sql"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              aria-label="Choose .sql file to import"
            />
            {importFile && (
              <p className="text-xs text-muted-foreground">
                {importFile.name} · {fmtBytes(importFile.size)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={!importFile || doImport.isPending}
              onClick={() => doImport.mutate()}
            >
              {doImport.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Read-only disable confirm */}
      <AlertDialog open={roConfirmOpen} onOpenChange={setRoConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable read-only mode?</AlertDialogTitle>
            <AlertDialogDescription>
              Statements will execute against the real database file and can modify or destroy
              data. Every write is audit-logged (statement type only). Keep read-only on for
              safe exploration.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setReadOnly(true)}>Stay read-only</AlertDialogCancel>
            <AlertDialogAction onClick={() => setReadOnly(false)}>
              Allow writes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete dialog — typed name confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete database {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The SQLite file <span className="font-mono">{deleteTarget?.fileName}</span> is
              permanently removed from <code className="font-mono text-xs">data/databases</code>{" "}
              along with its panel entry. Type the database name{" "}
              <span className="font-mono font-semibold text-foreground">{deleteTarget?.name}</span>{" "}
              to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={deleteText}
            onChange={(e) => setDeleteText(e.target.value)}
            placeholder={deleteTarget?.name}
            aria-label="Type the database name to confirm deletion"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={!deleteTarget || deleteText.trim() !== deleteTarget.name || remove.isPending}
              onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}
            >
              {remove.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Delete Database
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
