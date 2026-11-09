"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useTheme } from "next-themes";
import { get, post, put, ApiClientError, fmtBytes } from "@/lib/api";
import { usePanelStore } from "@/lib/store";
import { hasPermission } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Archive, ChevronRight, Download, File as FileIcon, FileArchive, FilePlus,
  Folder, FolderOpen, FolderPlus, HardDrive, Link2, Loader2, MoreHorizontal,
  Pencil, RotateCw, Search, Trash2, TriangleAlert, Undo2, Upload, X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Monaco (browser-only, loaded on demand)
// ---------------------------------------------------------------------------

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading editor…
    </div>
  ),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink";
  size: number;
  mode: string;
  owner?: { uid: number; gid: number };
  mtime: string;
  target?: string;
}

interface ListResponse {
  path: string;
  parent: string | null;
  truncated?: boolean;
  search?: string;
  entries: FileEntry[];
}

interface TrashEntry {
  name: string;
  original: string;
  deletedAt: string | null;
  type: "file" | "dir" | "symlink";
  size: number;
}

interface TrashResponse {
  trashDir: string;
  entries: TrashEntry[];
}

interface FileContentResponse {
  path: string;
  size: number;
  mtimeMs?: number;
  binary: boolean;
  language?: string;
  content: string;
}

interface OpsResult {
  ok: boolean;
  path?: string;
  trashName?: string;
  bytes?: number;
  count?: number;
  entries?: number;
}

type DialogState =
  | { kind: "closed" }
  | { kind: "mkdir" }
  | { kind: "newfile" }
  | { kind: "rename"; entry: FileEntry }
  | { kind: "move"; entry: FileEntry }
  | { kind: "copy"; entry: FileEntry }
  | { kind: "chmod"; entry: FileEntry }
  | { kind: "archive"; entries: FileEntry[] }
  | { kind: "extract"; entry: FileEntry }
  | { kind: "restore"; entry: TrashEntry };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INITIAL_PATH = "/home/z/my-project";
const EDITOR_PREVIEW_LIMIT = 512 * 1024; // read-only preview above this size

/** Base-path aware href builder (mirrors buildUrl in src/lib/api.ts). */
function buildHref(path: string): string {
  const base = typeof window !== "undefined" ? window.__HIPNO_BASE__ || "" : "";
  const url = path.startsWith("/") ? path : `/${path}`;
  if (!base) return url;
  const joiner = url.includes("?") ? "&" : "?";
  return `${base}${url}${joiner}XTransformPort=${window.__HIPNO_PORT__ || 3005}`;
}

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  mjs: "javascript", cjs: "javascript", json: "json", md: "markdown",
  css: "css", scss: "scss", less: "less", html: "html", xml: "xml",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", c: "c",
  h: "c", cpp: "cpp", cs: "csharp", php: "php", sh: "shell", bash: "shell",
  yml: "yaml", yaml: "yaml", toml: "ini", ini: "ini", env: "ini",
  sql: "sql", txt: "plaintext", log: "plaintext", csv: "plaintext",
};

function languageOf(name: string, serverLang?: string): string {
  if (serverLang) return serverLang;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return EXT_LANG[ext] || "plaintext";
}

const ARCHIVE_RE = /\.(tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|tar|zip)$/i;
function isArchiveName(name: string): boolean {
  return ARCHIVE_RE.test(name);
}

function dirname(p: string): string {
  const idx = p.lastIndexOf("/");
  if (idx <= 0) return "/";
  return p.slice(0, idx);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "MMM d, yyyy HH:mm");
  } catch {
    return "—";
  }
}

/** XHR upload with progress (relative URL, same-origin credentials). */
function uploadFile(
  dir: string,
  file: File,
  onProgress: (pct: number) => void
): Promise<{ name: string; size: number; path: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file);
    xhr.open("POST", buildHref(`/api/files/upload?dir=${encodeURIComponent(dir)}`));
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: { error?: string; code?: string } = {};
      try {
        data = JSON.parse(xhr.responseText) as typeof data;
      } catch {
        /* non-json */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as { name: string; size: number; path: string });
      } else {
        reject(
          new ApiClientError(
            xhr.status,
            data.code || "error",
            data.error || `Upload failed (HTTP ${xhr.status})`
          )
        );
      }
    };
    xhr.onerror = () => reject(new ApiClientError(0, "network", "Upload failed — network error"));
    xhr.send(form);
  });
}

function EntryIcon({ entry }: { entry: { type: string; name: string } }) {
  if (entry.type === "dir") return <Folder className="h-4 w-4 text-primary" aria-hidden />;
  if (entry.type === "symlink") return <Link2 className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />;
  if (isArchiveName(entry.name)) return <FileArchive className="h-4 w-4 text-muted-foreground" aria-hidden />;
  return <FileIcon className="h-4 w-4 text-muted-foreground" aria-hidden />;
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function PromptDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  initialValue: string;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (value: string) => void;
  validate?: (value: string) => string | null;
}) {
  // Mount the inner form fresh on every open — no state-reset effects needed.
  if (!props.open) return null;
  return <PromptDialogForm key={`${props.title}|${props.initialValue}`} {...props} open />;
}

function PromptDialogForm({
  title, description, label, initialValue, submitLabel, busy, onSubmit, validate, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  initialValue: string;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (value: string) => void;
  validate?: (value: string) => string | null;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const v = value.trim();
    const err = validate?.(v) ?? null;
    if (err) {
      setError(err);
      return;
    }
    if (!v) {
      setError("This field is required");
      return;
    }
    onSubmit(v);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="prompt-input">{label}</Label>
          <Input
            id="prompt-input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            aria-invalid={!!error}
            autoFocus
          />
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden /> : null}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChmodDialog(props: {
  entry: FileEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onSubmit: (mode: string) => void;
}) {
  // Mount the form fresh each time it opens (state starts from the entry).
  if (!props.open || !props.entry) return null;
  return <ChmodDialogForm key={props.entry.path} {...props} entry={props.entry} open />;
}

function ChmodDialogForm({
  entry, onOpenChange, busy, onSubmit,
}: {
  entry: FileEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onSubmit: (mode: string) => void;
}) {
  const [mode, setMode] = useState(entry.mode);

  const groups = ["Owner", "Group", "Other"];
  const perms = ["Read", "Write", "Execute"];

  const digits = /^[0-7]{3,4}$/.test(mode)
    ? mode.slice(-3).split("").map(Number)
    : null;

  function digitToBits(d: number): boolean[] {
    return [!!(d & 4), !!(d & 2), !!(d & 1)];
  }
  function bitsToDigit(b: boolean[]): number {
    return (b[0] ? 4 : 0) + (b[1] ? 2 : 0) + (b[2] ? 1 : 0);
  }

  function toggle(groupIdx: number, permIdx: number) {
    if (!digits) return;
    const bits = digits.map(digitToBits);
    bits[groupIdx][permIdx] = !bits[groupIdx][permIdx];
    const next = bits.map(bitsToDigit).join("");
    const special = mode.length === 4 ? mode.slice(0, 1) : "";
    setMode(`${special}${next}`);
  }

  const valid = /^[0-7]{3,4}$/.test(mode);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Permissions</DialogTitle>
          <DialogDescription className="break-all">{entry.path}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="chmod-mode">Octal mode</Label>
            <Input
              id="chmod-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value.trim())}
              placeholder="0755"
              aria-invalid={!valid}
              className="font-mono w-32"
            />
            {!valid ? (
              <p className="text-sm text-destructive" role="alert">
                Mode must be 3–4 octal digits (e.g. 0755)
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-4 gap-2 text-sm" role="group" aria-label="Permission bits">
            <span />
            {perms.map((p) => (
              <span key={p} className="text-center text-xs text-muted-foreground">{p}</span>
            ))}
            {groups.map((g, gi) => (
              <div key={g} className="contents">
                <span className="self-center text-xs font-medium">{g}</span>
                {perms.map((_, pi) => (
                  <span key={`${g}-${pi}`} className="flex justify-center">
                    <Checkbox
                      checked={digits ? digitToBits(digits[gi])[pi] : false}
                      onCheckedChange={() => toggle(gi, pi)}
                      disabled={!digits}
                      aria-label={`${g} ${perms[pi].toLowerCase()}`}
                    />
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(mode)} disabled={busy || !valid}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden /> : null}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RowsSkeleton() {
  return (
    <div className="p-4 space-y-3" role="status" aria-label="Loading files">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 flex-1 max-w-64" />
          <Skeleton className="h-4 w-16 hidden sm:block" />
          <Skeleton className="h-4 w-20 hidden md:block" />
          <Skeleton className="h-4 w-32 hidden lg:block" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function FilesView() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { resolvedTheme } = useTheme();
  const viewer = usePanelStore((s) => s.viewer);
  const canWrite = viewer ? hasPermission(viewer.role, "files:write") : true;

  const [cwd, setCwd] = useState(INITIAL_PATH);
  const [trashMode, setTrashMode] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState>({ kind: "closed" });
  const [confirmDelete, setConfirmDelete] = useState<FileEntry | null>(null);
  const [confirmPurge, setConfirmPurge] = useState<TrashEntry | null>(null);
  const [confirmPurgeAll, setConfirmPurgeAll] = useState(false);
  const [purgeAllDraft, setPurgeAllDraft] = useState("");
  const [viewerPath, setViewerPath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [uploadState, setUploadState] = useState<{ name: string; progress: number } | null>(null);
  const [pathEditing, setPathEditing] = useState(false);
  const [pathDraft, setPathDraft] = useState("");
  const [archiveBusy, setArchiveBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // debounce the search box
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ------------------------------------------------------------- queries

  const listQuery = useQuery<ListResponse>({
    queryKey: ["files", "list", cwd, searchQuery],
    queryFn: () =>
      get<ListResponse>(
        `/api/files/list?path=${encodeURIComponent(cwd)}` +
          (searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : "")
      ),
    enabled: !trashMode,
  });

  const trashQuery = useQuery<TrashResponse>({
    queryKey: ["files", "trash"],
    queryFn: () => get<TrashResponse>("/api/files/trash"),
    enabled: trashMode,
  });

  const viewerQuery = useQuery<FileContentResponse>({
    queryKey: ["files", "file", viewerPath],
    queryFn: () =>
      get<FileContentResponse>(`/api/files/file?path=${encodeURIComponent(viewerPath as string)}`),
    enabled: !!viewerPath,
  });

  // mtime of the loaded version — used for optimistic-concurrency saves
  // (FIX#2 §5: refuse silent overwrites when the file changed on disk).
  const [loadedMtimeMs, setLoadedMtimeMs] = useState<number | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (viewerQuery.data) {
      setEditorContent(viewerQuery.data.content);
      setLoadedMtimeMs(viewerQuery.data.mtimeMs ?? null);
      setDirty(false);
    }
  }, [viewerQuery.data]);

  // ------------------------------------------------------------- mutations

  const opsMutation = useMutation<OpsResult, Error, Record<string, unknown>>({
    mutationFn: (body) => post<OpsResult>("/api/files/ops", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["files"] });
    },
  });

  const saveMutation = useMutation<
    { path: string; size: number; mtimeMs?: number },
    Error,
    { path: string; content: string; expectedMtimeMs?: number; overwrite?: boolean }
  >({
    mutationFn: (b) => put<{ path: string; size: number; mtimeMs?: number }>("/api/files/file", b),
    onSuccess: (d, v) => {
      toast({ title: "File saved", description: v.path });
      setLoadedMtimeMs(d.mtimeMs ?? null);
      setDirty(false);
      setConflictOpen(false);
      qc.invalidateQueries({ queryKey: ["files"] });
    },
    onError: (e, v) => {
      if (e instanceof ApiClientError && e.code === "file_conflict" && !v.overwrite) {
        setConflictOpen(true);
      } else {
        toast({ title: "Save failed", description: e.message, variant: "destructive" });
      }
    },
  });

  const busy = opsMutation.isPending;

  const runOp = useCallback(
    (body: Record<string, unknown>, successMessage: (data: OpsResult) => string) => {
      opsMutation.mutate(body, {
        onSuccess: (data) => {
          toast({ title: successMessage(data) });
          setSelection(new Set());
          setDialog({ kind: "closed" });
          setConfirmDelete(null);
          setConfirmPurge(null);
          setConfirmPurgeAll(false);
          setPurgeAllDraft("");
        },
        onError: (e) => {
          toast({
            title: "Operation failed",
            description: e instanceof ApiClientError ? `${e.message}` : e.message,
            variant: "destructive",
          });
        },
      });
    },
    [opsMutation, toast]
  );

  // ------------------------------------------------------------- actions

  const navigate = useCallback((p: string) => {
    const clean = p.replace(/\/+$/, "");
    setCwd(clean === "" ? "/" : clean);
    setSearchInput("");
    setSearchQuery("");
    setSelection(new Set());
    setPathEditing(false);
    setTrashMode(false);
  }, []);

  function openEntry(entry: FileEntry) {
    if (entry.type === "dir") {
      navigate(entry.path);
    } else {
      setViewerPath(entry.path);
      setEditorContent("");
    }
  }

  function download(entry: { path: string; name: string; type: string }) {
    const isDir = entry.type === "dir";
    // Plain relative href — downloads resolve correctly under the relay base
    // path automatically (spec §4.3), no base/XTransformPort prefix needed.
    const href = `/api/files/download?path=${encodeURIComponent(entry.path)}${isDir ? "&archive=1" : ""}`;
    const a = document.createElement("a");
    a.href = href;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast({
      title: isDir ? "Preparing folder archive…" : "Download started",
      description: isDir ? `${entry.name}.tar.gz` : entry.name,
    });
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files).slice(0, 20)) {
      setUploadState({ name: file.name, progress: 0 });
      try {
        await uploadFile(cwd, file, (pct) => setUploadState({ name: file.name, progress: pct }));
        toast({ title: "Upload complete", description: `${file.name} → ${cwd}` });
      } catch (e) {
        toast({
          title: `Upload failed: ${file.name}`,
          description: e instanceof Error ? e.message : "Unknown error",
          variant: "destructive",
        });
      }
    }
    setUploadState(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    qc.invalidateQueries({ queryKey: ["files"] });
  }

  const entries = listQuery.data?.entries ?? [];
  const trashEntries = trashQuery.data?.entries ?? [];
  const selectedEntries = useMemo(
    () => entries.filter((e) => selection.has(e.path)),
    [entries, selection]
  );
  const selectedArchive = selectedEntries.length === 1 && isArchiveName(selectedEntries[0].name)
    ? selectedEntries[0]
    : null;

  function toggleSelected(path: string, checked: boolean) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  }

  const crumbs = useMemo(() => {
    const parts = cwd.split("/").filter(Boolean);
    const out: { label: string; path: string }[] = [];
    let acc = "";
    for (const part of parts) {
      acc += `/${part}`;
      out.push({ label: part, path: acc });
    }
    return out;
  }, [cwd]);

  const viewerData = viewerQuery.data;
  const viewerReadonly = !!viewerData && (viewerData.size > EDITOR_PREVIEW_LIMIT || viewerData.binary);
  const viewerError = viewerPath && viewerQuery.isError ? viewerQuery.error : null;

  // ------------------------------------------------------------- render

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary" aria-hidden /> Files
          </h1>
          <p className="text-sm text-muted-foreground">
            Browse and manage files inside the allowed roots
          </p>
        </div>
        <Button
          variant={trashMode ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setTrashMode((t) => !t);
            setSelection(new Set());
          }}
          aria-pressed={trashMode}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          {trashMode ? "Back to files" : "Trash"}
          {trashEntries.length > 0 && trashMode ? (
            <Badge variant="secondary" className="ml-1">{trashEntries.length}</Badge>
          ) : null}
        </Button>
      </div>

      {/* Toolbar */}
      <Card className="p-4 gap-3">
        {/* path row */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate(listQuery.data?.parent ?? dirname(cwd))}
            disabled={!listQuery.data?.parent}
            aria-label="Go to parent folder"
            title="Up one level"
          >
            <span className="text-base leading-none" aria-hidden>↑</span>
          </Button>

          {pathEditing ? (
            <form
              className="flex flex-1 min-w-56 items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                navigate(pathDraft);
              }}
            >
              <Input
                value={pathDraft}
                onChange={(e) => setPathDraft(e.target.value)}
                placeholder="/home/z/my-project"
                className="font-mono text-sm h-8"
                autoFocus
                aria-label="Current path"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setPathEditing(false);
                }}
              />
              <Button type="submit" size="sm" className="h-8">Go</Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPathEditing(false)}
                aria-label="Cancel path edit"
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </form>
          ) : (
            <nav
              className="flex flex-1 min-w-0 items-center gap-1 text-sm overflow-x-auto"
              aria-label="Current path"
            >
              <button
                className="px-1.5 py-0.5 rounded hover:bg-muted font-mono shrink-0"
                onClick={() => navigate("/home/z/my-project")}
                aria-label="Go to project root"
              >
                /
              </button>
              {crumbs.map((c, i) => (
                <span key={c.path} className="flex items-center gap-1 shrink-0">
                  <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden />
                  <button
                    className={`px-1.5 py-0.5 rounded hover:bg-muted font-mono truncate max-w-40 ${
                      i === crumbs.length - 1 ? "font-semibold text-primary" : ""
                    }`}
                    onClick={() => navigate(c.path)}
                    aria-label={`Go to ${c.label}`}
                  >
                    {c.label}
                  </button>
                </span>
              ))}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 ml-1 shrink-0"
                onClick={() => {
                  setPathDraft(cwd);
                  setPathEditing(true);
                }}
                aria-label="Edit path"
                title="Edit path"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </nav>
          )}
        </div>

        {/* actions row */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => listQuery.refetch()}
            disabled={trashMode ? trashQuery.isFetching : listQuery.isFetching}
            aria-label="Refresh listing"
          >
            <RotateCw
              className={`h-4 w-4 ${(trashMode ? trashQuery.isFetching : listQuery.isFetching) ? "animate-spin" : ""}`}
              aria-hidden
            />
            Refresh
          </Button>

          {canWrite && !trashMode ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "mkdir" })}>
                <FolderPlus className="h-4 w-4" aria-hidden /> New folder
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "newfile" })}>
                <FilePlus className="h-4 w-4" aria-hidden /> New file
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" aria-hidden /> Upload
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDialog({ kind: "archive", entries: selectedEntries })}
                disabled={selection.size === 0}
                title="Archive selected entries"
              >
                <Archive className="h-4 w-4" aria-hidden /> Archive
                {selection.size > 0 ? ` (${selection.size})` : ""}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => selectedArchive && setDialog({ kind: "extract", entry: selectedArchive })}
                disabled={!selectedArchive}
                title="Extract the selected archive"
              >
                <FileArchive className="h-4 w-4" aria-hidden /> Extract
              </Button>
            </>
          ) : null}

          {canWrite && trashMode && trashEntries.length > 0 ? (
            <Button variant="destructive" size="sm" onClick={() => setConfirmPurgeAll(true)}>
              <Trash2 className="h-4 w-4" aria-hidden /> Empty trash
            </Button>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            {searchOpen && !trashMode ? (
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={`Search names under ${cwd.split("/").pop() || "/"}…`}
                className="h-8 w-56 font-sm"
                autoFocus
                aria-label="Search file names"
              />
            ) : null}
            <Button
              variant={searchOpen ? "secondary" : "outline"}
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setSearchOpen((s) => !s);
                if (searchOpen) {
                  setSearchInput("");
                  setSearchQuery("");
                }
              }}
              aria-pressed={searchOpen}
              aria-label={searchOpen ? "Close search" : "Open search"}
              title="Search (recursive)"
              disabled={trashMode}
            >
              {searchOpen ? <X className="h-4 w-4" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
            </Button>
          </div>
        </div>

        {/* upload progress */}
        {uploadState ? (
          <div className="space-y-1" role="status" aria-label="Upload progress">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate">Uploading {uploadState.name}</span>
              <span>{uploadState.progress}%</span>
            </div>
            <Progress value={uploadState.progress} aria-label={`Upload progress ${uploadState.progress}%`} />
          </div>
        ) : null}
      </Card>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleUpload(e.target.files)}
        aria-hidden
        tabIndex={-1}
      />

      {/* Content */}
      {!trashMode ? (
        listQuery.isLoading ? (
          <Card className="p-0"><RowsSkeleton /></Card>
        ) : listQuery.isError ? (
          <Card className="p-6">
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <TriangleAlert className="h-8 w-8 text-destructive" aria-hidden />
              <p className="text-sm text-muted-foreground max-w-md">
                {listQuery.error instanceof ApiClientError
                  ? listQuery.error.message
                  : "Could not load this folder."}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => listQuery.refetch()}>
                  <RotateCw className="h-4 w-4" aria-hidden /> Retry
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate(INITIAL_PATH)}>
                  <FolderOpen className="h-4 w-4" aria-hidden /> Project root
                </Button>
              </div>
            </div>
          </Card>
        ) : entries.length === 0 ? (
          <Card className="p-6">
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <FolderOpen className="h-10 w-10 text-muted-foreground" aria-hidden />
              {searchQuery ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    No results for “{searchQuery}” under {cwd}
                  </p>
                  <Button
                    variant="outline" size="sm"
                    onClick={() => {
                      setSearchInput("");
                      setSearchQuery("");
                    }}
                  >
                    Clear search
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    This folder is empty — create a file or folder
                  </p>
                  {canWrite ? (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "mkdir" })}>
                        <FolderPlus className="h-4 w-4" aria-hidden /> New folder
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "newfile" })}>
                        <FilePlus className="h-4 w-4" aria-hidden /> New file
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </Card>
        ) : (
          <Card className="p-0">
            {searchQuery ? (
              <div className="flex items-center gap-2 border-b px-4 py-2 text-sm text-muted-foreground">
                <Search className="h-4 w-4" aria-hidden />
                <span>
                  {entries.length} result{entries.length === 1 ? "" : "s"} for “{searchQuery}”
                  {listQuery.data?.truncated ? " (capped at 200)" : ""}
                </span>
                <Button
                  variant="ghost" size="sm" className="ml-auto h-7"
                  onClick={() => {
                    setSearchInput("");
                    setSearchQuery("");
                  }}
                >
                  Clear
                </Button>
              </div>
            ) : null}
            {listQuery.data?.truncated && !searchQuery ? (
              <div className="border-b px-4 py-2 text-xs text-muted-foreground">
                Listing capped at 5,000 entries — use search to find specific files.
              </div>
            ) : null}
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={entries.length > 0 && entries.every((e) => selection.has(e.path))}
                        onCheckedChange={(checked) =>
                          setSelection(checked ? new Set(entries.map((e) => e.path)) : new Set())
                        }
                        aria-label="Select all entries"
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden sm:table-cell w-20 text-right">Size</TableHead>
                    <TableHead className="hidden md:table-cell w-24">Mode</TableHead>
                    <TableHead className="hidden lg:table-cell w-44">Modified</TableHead>
                    <TableHead className="w-10" aria-label="Row actions" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow
                      key={entry.path}
                      className="cursor-pointer"
                      onClick={() => openEntry(entry)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selection.has(entry.path)}
                          onCheckedChange={(checked) => toggleSelected(entry.path, checked === true)}
                          aria-label={`Select ${entry.name}`}
                        />
                      </TableCell>
                      <TableCell className="max-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <EntryIcon entry={entry} />
                          <span className="truncate font-medium" title={entry.path}>
                            {entry.name}
                          </span>
                          {entry.type === "symlink" && entry.target ? (
                            <span className="truncate text-xs text-muted-foreground" title={entry.target}>
                              → {entry.target}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-right text-muted-foreground">
                        {entry.type === "dir" ? "—" : fmtBytes(entry.size)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell font-mono text-xs text-muted-foreground">
                        {entry.mode}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground">
                        {fmtDate(entry.mtime)}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={`Actions for ${entry.name}`}
                            >
                              <MoreHorizontal className="h-4 w-4" aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem onClick={() => openEntry(entry)}>
                              {entry.type === "dir" ? (
                                <FolderOpen className="h-4 w-4" aria-hidden />
                              ) : (
                                <Pencil className="h-4 w-4" aria-hidden />
                              )}
                              {entry.type === "dir" ? "Open" : "Open / Edit"}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => download(entry)}>
                              <Download className="h-4 w-4" aria-hidden /> Download
                              {entry.type === "dir" ? " (.tar.gz)" : ""}
                            </DropdownMenuItem>
                            {canWrite ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => setDialog({ kind: "rename", entry })}>
                                  <Pencil className="h-4 w-4" aria-hidden /> Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setDialog({ kind: "move", entry })}>
                                  <HardDrive className="h-4 w-4" aria-hidden /> Move to…
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setDialog({ kind: "copy", entry })}>
                                  <FolderPlus className="h-4 w-4" aria-hidden /> Copy to…
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setDialog({ kind: "archive", entries: [entry] })}
                                >
                                  <Archive className="h-4 w-4" aria-hidden /> Archive…
                                </DropdownMenuItem>
                                {entry.type === "file" && isArchiveName(entry.name) ? (
                                  <DropdownMenuItem onClick={() => setDialog({ kind: "extract", entry })}>
                                    <FileArchive className="h-4 w-4" aria-hidden /> Extract…
                                  </DropdownMenuItem>
                                ) : null}
                                {entry.type === "dir" ? (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      runOp(
                                        { op: "du", path: entry.path },
                                        (d) => `${entry.name}: ${fmtBytes(d.bytes ?? 0)}`
                                      )
                                    }
                                  >
                                    <HardDrive className="h-4 w-4" aria-hidden /> Folder size
                                  </DropdownMenuItem>
                                ) : null}
                                <DropdownMenuItem onClick={() => setDialog({ kind: "chmod", entry })}>
                                  <FolderPlus className="h-4 w-4" aria-hidden /> Permissions…
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => setConfirmDelete(entry)}
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden /> Delete
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )
      ) : trashQuery.isLoading ? (
        <Card className="p-0"><RowsSkeleton /></Card>
      ) : trashQuery.isError ? (
        <Card className="p-6">
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <TriangleAlert className="h-8 w-8 text-destructive" aria-hidden />
            <p className="text-sm text-muted-foreground">Could not load the trash folder.</p>
            <Button variant="outline" size="sm" onClick={() => trashQuery.refetch()}>
              <RotateCw className="h-4 w-4" aria-hidden /> Retry
            </Button>
          </div>
        </Card>
      ) : trashEntries.length === 0 ? (
        <Card className="p-6">
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Trash2 className="h-10 w-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">The trash is empty.</p>
          </div>
        </Card>
      ) : (
        <Card className="p-0">
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>Original name</TableHead>
                  <TableHead className="hidden sm:table-cell w-20">Type</TableHead>
                  <TableHead className="hidden md:table-cell w-44">Deleted</TableHead>
                  <TableHead className="hidden sm:table-cell w-20 text-right">Size</TableHead>
                  <TableHead className="w-10" aria-label="Row actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {trashEntries.map((t) => (
                  <TableRow key={t.name}>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-0">
                        <EntryIcon entry={{ type: t.type, name: t.original }} />
                        <span className="truncate font-medium" title={t.name}>{t.original}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground capitalize">
                      {t.type}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {fmtDate(t.deletedAt)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right text-muted-foreground">
                      {fmtBytes(t.size)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`Actions for ${t.original}`}
                          >
                            <MoreHorizontal className="h-4 w-4" aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          {canWrite ? (
                            <>
                              <DropdownMenuItem onClick={() => setDialog({ kind: "restore", entry: t })}>
                                <Undo2 className="h-4 w-4" aria-hidden /> Restore…
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setConfirmPurge(t)}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden /> Delete permanently
                              </DropdownMenuItem>
                            </>
                          ) : (
                            <DropdownMenuItem disabled>No actions available</DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* ---------------------------------------------------- file viewer */}
      <Dialog
        open={!!viewerPath}
        onOpenChange={(open) => {
          if (!open) {
            setViewerPath(null);
            setEditorContent("");
          }
        }}
      >
        <DialogContent className="sm:max-w-4xl w-[95vw]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono text-sm break-all">
              <FileIcon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              {viewerPath}
            </DialogTitle>
            <DialogDescription>
              {viewerData
                ? `${fmtBytes(viewerData.size)} · ${viewerData.binary ? "binary file" : `editable text`}`
                : "Loading…"}
            </DialogDescription>
          </DialogHeader>

          <div className="h-[60vh] rounded-md border overflow-hidden bg-muted/30">
            {viewerQuery.isLoading ? (
              <div className="h-full flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading file…
              </div>
            ) : viewerError ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-6">
                <TriangleAlert className="h-8 w-8 text-destructive" aria-hidden />
                <p className="text-sm text-muted-foreground max-w-md">
                  {viewerError instanceof ApiClientError ? viewerError.message : "Could not open this file."}
                </p>
                {viewerPath ? (
                  <Button
                    variant="outline" size="sm"
                    onClick={() => download({ path: viewerPath, name: viewerPath.split("/").pop() || "file", type: "file" })}
                  >
                    <Download className="h-4 w-4" aria-hidden /> Download anyway
                  </Button>
                ) : null}
              </div>
            ) : viewerData?.binary ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-6">
                <FileIcon className="h-10 w-10 text-muted-foreground" aria-hidden />
                <p className="text-sm text-muted-foreground">
                  This file is binary ({fmtBytes(viewerData.size)}) and cannot be previewed as text.
                </p>
                {viewerPath ? (
                  <Button
                    variant="outline" size="sm"
                    onClick={() => download({ path: viewerPath, name: viewerPath.split("/").pop() || "file", type: "file" })}
                  >
                    <Download className="h-4 w-4" aria-hidden /> Download
                  </Button>
                ) : null}
              </div>
            ) : (
              <MonacoEditor
                height="100%"
                language={languageOf(viewerPath?.split("/").pop() || "file.txt", viewerData?.language)}
                theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
                value={editorContent}
                onChange={(v) => {
                  setEditorContent(v ?? "");
                  setDirty((v ?? "") !== (viewerQuery.data?.content ?? ""));
                }}
                options={{
                  readOnly: viewerReadonly || !canWrite || saveMutation.isPending,
                  minimap: { enabled: false },
                  fontSize: 13,
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  automaticLayout: true,
                }}
                aria-label="File content editor"
              />
            )}
          </div>

          {viewerData && !viewerData.binary && viewerData.size > EDITOR_PREVIEW_LIMIT ? (
            <p className="text-xs text-muted-foreground">
              File is larger than 512 KB — showing a read-only preview.
            </p>
          ) : null}

          <DialogFooter>
            {viewerData && !viewerData.binary && !viewerReadonly && canWrite && viewerPath ? (
              <>
                {dirty && <span className="text-xs text-muted-foreground self-center pr-2">● unsaved changes</span>}
                <Button
                  onClick={() =>
                    saveMutation.mutate({
                      path: viewerPath,
                      content: editorContent,
                      ...(loadedMtimeMs !== null ? { expectedMtimeMs: loadedMtimeMs } : {}),
                    })
                  }
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden />
                  ) : null}
                  Save
                </Button>
              </>
            ) : null}
            <Button variant="outline" onClick={() => setViewerPath(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save conflict — the file changed on disk after it was opened (FIX#2 §5) */}
      <AlertDialog open={conflictOpen} onOpenChange={setConflictOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>File changed on disk</AlertDialogTitle>
            <AlertDialogDescription>
              {viewerPath} was modified after you opened it (another editor, terminal command or deploy).
              Overwriting will discard those changes; reloading will discard yours.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConflictOpen(false)}>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConflictOpen(false);
                viewerQuery.refetch();
              }}
            >
              Reload from disk
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                if (viewerPath) {
                  saveMutation.mutate(
                    { path: viewerPath, content: editorContent, overwrite: true },
                    { onSuccess: () => setConflictOpen(false) }
                  );
                }
              }}
            >
              Overwrite anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------------------------------------------------- dialogs */}

      <PromptDialog
        open={dialog.kind === "mkdir"}
        onOpenChange={(o) => !o && setDialog({ kind: "closed" })}
        title="New folder"
        description={`Create a folder under ${cwd}`}
        label="Folder name"
        initialValue=""
        submitLabel="Create"
        busy={busy}
        validate={(v) =>
          !v || v.includes("/") || v === "." || v === ".." ? "Enter a valid folder name" : null
        }
        onSubmit={(name) =>
          runOp({ op: "mkdir", path: `${cwd}/${name}` }, () => `Folder created: ${name}`)
        }
      />

      <PromptDialog
        open={dialog.kind === "newfile"}
        onOpenChange={(o) => !o && setDialog({ kind: "closed" })}
        title="New file"
        description={`Create an empty file under ${cwd}`}
        label="File name"
        initialValue=""
        submitLabel="Create"
        busy={busy}
        validate={(v) =>
          !v || v.includes("/") || v === "." || v === ".." ? "Enter a valid file name" : null
        }
        onSubmit={(name) =>
          runOp({ op: "touch", path: `${cwd}/${name}` }, () => `File created: ${name}`)
        }
      />

      <PromptDialog
        open={dialog.kind === "rename" && !!dialog.entry}
        onOpenChange={(o) => !o && setDialog({ kind: "closed" })}
        title="Rename"
        description={dialog.kind === "rename" ? dialog.entry.path : ""}
        label="New name"
        initialValue={dialog.kind === "rename" ? dialog.entry.name : ""}
        submitLabel="Rename"
        busy={busy}
        validate={(v) =>
          !v || v.includes("/") || v === "." || v === ".." ? "Enter a valid name" : null
        }
        onSubmit={(name) => {
          if (dialog.kind !== "rename" || !dialog.entry) return;
          runOp(
            { op: "rename", from: dialog.entry.path, to: `${dirname(dialog.entry.path)}/${name}` },
            () => `Renamed to ${name}`
          );
        }}
      />

      <PromptDialog
        open={dialog.kind === "move" && !!dialog.entry}
        onOpenChange={(o) => !o && setDialog({ kind: "closed" })}
        title="Move"
        description={dialog.kind === "move" ? dialog.entry.path : ""}
        label="Destination directory"
        initialValue={cwd}
        submitLabel="Move"
        busy={busy}
        validate={(v) => (!v.startsWith("/") ? "Destination must be an absolute path" : null)}
        onSubmit={(toDir) => {
          if (dialog.kind !== "move" || !dialog.entry) return;
          runOp({ op: "move", from: dialog.entry.path, toDir }, () => `Moved to ${toDir}`);
        }}
      />

      <PromptDialog
        open={dialog.kind === "copy" && !!dialog.entry}
        onOpenChange={(o) => !o && setDialog({ kind: "closed" })}
        title="Copy"
        description={dialog.kind === "copy" ? dialog.entry.path : ""}
        label="Destination directory"
        initialValue={cwd}
        submitLabel="Copy"
        busy={busy}
        validate={(v) => (!v.startsWith("/") ? "Destination must be an absolute path" : null)}
        onSubmit={(toDir) => {
          if (dialog.kind !== "copy" || !dialog.entry) return;
          runOp({ op: "copy", from: dialog.entry.path, toDir }, () => `Copied to ${toDir}`);
        }}
      />

      <PromptDialog
        open={dialog.kind === "archive" && dialog.entries.length > 0}
        onOpenChange={(o) => !o && setDialog({ kind: "closed" })}
        title="Create archive"
        description={
          dialog.kind === "archive"
            ? `${dialog.entries.length} item(s): ${dialog.entries.map((e) => e.name).join(", ").slice(0, 160)}`
            : ""
        }
        label="Archive destination (.tar.gz)"
        initialValue={
          dialog.kind === "archive" && dialog.entries.length === 1
            ? `${cwd}/${dialog.entries[0].name}.tar.gz`
            : `${cwd}/archive-${format(new Date(), "yyyyMMdd-HHmmss")}.tar.gz`
        }
        submitLabel="Archive"
        validate={(v) => (!v.toLowerCase().endsWith(".tar.gz") ? "Destination must end with .tar.gz" : null)}
        busy={archiveBusy || busy}
        onSubmit={(dest) => {
          if (dialog.kind !== "archive") return;
          createArchive(dialog.entries.map((e) => e.path), dest);
        }}
      />

      <PromptDialog
        open={dialog.kind === "extract" && !!dialog.entry}
        onOpenChange={(o) => !o && setDialog({ kind: "closed" })}
        title="Extract archive"
        description={dialog.kind === "extract" ? dialog.entry.path : ""}
        label="Extract into directory"
        initialValue={cwd}
        submitLabel="Extract"
        busy={archiveBusy}
        validate={(v) => (!v.startsWith("/") ? "Destination must be an absolute path" : null)}
        onSubmit={(destDir) => {
          if (dialog.kind !== "extract" || !dialog.entry) return;
          extractArchive(dialog.entry.path, destDir);
        }}
      />

      <PromptDialog
        open={dialog.kind === "restore" && !!dialog.entry}
        onOpenChange={(o) => !o && setDialog({ kind: "closed" })}
        title="Restore from trash"
        description={dialog.kind === "restore" ? `Restore ${dialog.entry.original} to a folder` : ""}
        label="Restore into directory"
        initialValue={cwd}
        submitLabel="Restore"
        busy={busy}
        validate={(v) => (!v.startsWith("/") ? "Destination must be an absolute path" : null)}
        onSubmit={(toDir) => {
          if (dialog.kind !== "restore" || !dialog.entry) return;
          runOp(
            { op: "restore", trashName: dialog.entry.name, toDir },
            (d) => `Restored to ${d.path ?? toDir}`
          );
        }}
      />

      <ChmodDialog
        open={dialog.kind === "chmod" && !!dialog.entry}
        onOpenChange={(o) => !o && setDialog({ kind: "closed" })}
        entry={dialog.kind === "chmod" ? dialog.entry : null}
        busy={busy}
        onSubmit={(mode) => {
          if (dialog.kind !== "chmod" || !dialog.entry) return;
          runOp({ op: "chmod", path: dialog.entry.path, mode }, () => `Permissions set to ${mode}`);
        }}
      />

      {/* ---------------------------------------------------- confirms */}

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{confirmDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.path} will be moved to the trash. You can restore it later from the
              trash view.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (!confirmDelete) return;
                runOp(
                  { op: "delete", path: confirmDelete.path },
                  () => `Moved to trash: ${confirmDelete.name}`
                );
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden /> : null}
              Move to trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmPurge} onOpenChange={(o) => !o && setConfirmPurge(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              “{confirmPurge?.original}” will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (!confirmPurge) return;
                runOp(
                  { op: "purge", trashName: confirmPurge.name },
                  () => `Permanently deleted: ${confirmPurge.original}`
                );
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden /> : null}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmPurgeAll}
        onOpenChange={(o) => {
          setConfirmPurgeAll(o);
          if (!o) setPurgeAllDraft("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Empty the trash?</AlertDialogTitle>
            <AlertDialogDescription>
              All {trashEntries.length} item(s) in the trash will be permanently deleted. This
              cannot be undone. Type <span className="font-mono font-semibold">EMPTY</span> to
              confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={purgeAllDraft}
            onChange={(e) => setPurgeAllDraft(e.target.value)}
            placeholder='Type "EMPTY" to confirm'
            aria-label='Type EMPTY to confirm emptying the trash'
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy || purgeAllDraft !== "EMPTY"}
              onClick={(e) => {
                e.preventDefault();
                runOp({ op: "purge-all" }, (d) => `Trash emptied (${d.count ?? 0} items removed)`);
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden /> : null}
              Empty trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  // --------------------------------------------------------- archive/extract flows

  async function createArchive(paths: string[], dest: string) {
    setArchiveBusy(true);
    try {
      await post("/api/files/archive", { paths, dest });
      toast({ title: "Archive created", description: dest });
      setSelection(new Set());
      setDialog({ kind: "closed" });
      qc.invalidateQueries({ queryKey: ["files"] });
    } catch (e) {
      toast({
        title: "Archive failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setArchiveBusy(false);
    }
  }

  async function extractArchive(path: string, destDir: string) {
    setArchiveBusy(true);
    try {
      const res = await post<{ entries: number }>("/api/files/extract", { path, destDir });
      toast({ title: "Archive extracted", description: `${res.entries} entr${res.entries === 1 ? "y" : "ies"} → ${destDir}` });
      setDialog({ kind: "closed" });
      qc.invalidateQueries({ queryKey: ["files"] });
    } catch (e) {
      toast({
        title: "Extract failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setArchiveBusy(false);
    }
  }
}
