import { promises as fsp } from "fs";
import path from "path";
import { ApiError } from "@/lib/api-error";
import { FILE_MANAGER_ROOTS, isWithinRoots, isProtectedPath } from "@/lib/validation";
import { TRASH_DIR } from "@/lib/constants";
import { run } from "@/lib/exec";

/**
 * File-manager shared helpers: path validation + realpath resolution +
 * trash management. Every API route MUST funnel user-supplied paths
 * through these functions (spec §5.7 / §7):
 *
 *  1. lexical checks — absolute, no "..", no NUL, within allowed roots;
 *  2. realpath resolution — symlink escapes land outside the roots → reject;
 *  3. destructive/mutation guard — protected trees, the roots themselves and
 *     the trash dir itself are untouchable.
 */

export const MAX_READ_BYTES = 2 * 1024 * 1024; // editor read cap
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // upload cap
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024; // download/archive cap

// ---------------------------------------------------------------------------
// Lexical validation + realpath resolution
// ---------------------------------------------------------------------------

/** Lexical safety checks; returns the normalized path. Throws on any violation. */
function assertLexicalSafe(input: unknown): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new ApiError(400, "invalid_path", "A path is required");
  }
  if (input.length > 4096) {
    throw new ApiError(400, "invalid_path", "Path is too long");
  }
  if (input.includes("\0")) {
    throw new ApiError(400, "invalid_path", "Path contains invalid characters");
  }
  if (!path.isAbsolute(input)) {
    throw new ApiError(400, "invalid_path", "Path must be absolute");
  }
  if (input.split("/").includes("..")) {
    throw new ApiError(403, "forbidden_path", "Path traversal is not allowed");
  }
  const norm = path.normalize(input);
  if (norm.split("/").includes("..")) {
    throw new ApiError(403, "forbidden_path", "Path traversal is not allowed");
  }
  if (!isWithinRoots(norm)) {
    throw new ApiError(403, "forbidden_path", "Path is outside the allowed roots");
  }
  return norm;
}

async function realpathOrNull(p: string): Promise<string | null> {
  try {
    return await fsp.realpath(p);
  } catch {
    return null;
  }
}

export function isRootItself(p: string): boolean {
  return FILE_MANAGER_ROOTS.some((r) => p === r);
}

export function isInsideTrash(p: string): boolean {
  return p === TRASH_DIR || p.startsWith(TRASH_DIR + "/");
}

/** True when the trash folder itself is ready (created on demand). */
export async function ensureTrashDir(): Promise<string> {
  await fsp.mkdir(TRASH_DIR, { recursive: true });
  return TRASH_DIR;
}

/**
 * Mutation-target guard: blocks protected trees (isProtectedPath), the allowed
 * roots themselves and the trash dir itself. Non-destructive reads (list, file
 * read, du, download) do NOT call this — only operations that create/modify.
 */
export function assertMutableTarget(p: string): void {
  if (isProtectedPath(p)) {
    throw new ApiError(403, "protected_path", "This path is protected and cannot be modified");
  }
  if (isRootItself(p)) {
    throw new ApiError(403, "protected_path", "Allowed root directories cannot be modified");
  }
  if (p === TRASH_DIR) {
    throw new ApiError(403, "protected_path", "The trash folder cannot be modified directly");
  }
}

/**
 * Shared path-safety resolver (spec §5.7) — THE single funnel for every
 * user-supplied path in the files API:
 *
 *  1. lexical checks — absolute, no "..", no NUL, inside the allowed roots;
 *  2. fs.realpath the full path when it exists, otherwise the nearest
 *     existing ancestor (symlink escapes therefore land outside the roots
 *     and are rejected);
 *  3. re-verify the resolved path is within the allowed roots;
 *  4. return the resolved path.
 *
 * Any violation ⇒ ApiError(403, "forbidden_path", …).
 */
export async function safeResolve(input: unknown): Promise<string> {
  const norm = assertLexicalSafe(input);
  const real = await realpathOrNull(norm);
  if (real !== null) {
    if (!isWithinRoots(real)) {
      throw new ApiError(403, "forbidden_path", "Path resolves outside the allowed roots");
    }
    return real;
  }
  let parent = path.dirname(norm);
  let realParent = await realpathOrNull(parent);
  while (realParent === null) {
    const next = path.dirname(parent);
    if (next === parent) break;
    parent = next;
    realParent = await realpathOrNull(parent);
  }
  if (realParent === null) {
    // Unreachable while the allowed roots exist, but never leak a pass-through.
    throw new ApiError(404, "not_found", "Parent directory does not exist");
  }
  if (!isWithinRoots(realParent)) {
    throw new ApiError(403, "forbidden_path", "Parent path resolves outside the allowed roots");
  }
  const tail = norm.slice(parent.length);
  const target = tail ? path.join(realParent, tail) : realParent;
  if (!isWithinRoots(target)) {
    throw new ApiError(403, "forbidden_path", "Path is outside the allowed roots");
  }
  return target;
}

/**
 * Validate + resolve a path that must already exist (= safeResolve +
 * existence check). The returned path is the fully symlink-resolved real
 * path and is guaranteed to be within the allowed roots.
 */
export async function resolveExistingPath(input: unknown): Promise<string> {
  const target = await safeResolve(input);
  const real = await realpathOrNull(target);
  if (real === null) {
    throw new ApiError(404, "not_found", "Path does not exist");
  }
  return real;
}

/**
 * Validate a path that may not exist yet (= safeResolve). The nearest
 * existing ancestor is realpath-resolved (symlink escape check) and the
 * returned target is the real parent joined with the missing tail —
 * guaranteed within the allowed roots.
 */
export async function resolveTargetPath(input: unknown): Promise<string> {
  return safeResolve(input);
}

// ---------------------------------------------------------------------------
// Trash (soft-delete) management
// ---------------------------------------------------------------------------

const TRASH_TS_RE = /^(\d{8}T\d{6}Z)-(.+)$/;

function trashTimestamp(): string {
  return new Date().toISOString().replace(/-/g, "").replace(/:/g, "").replace(/\.\d+Z$/, "Z");
}

export function makeTrashName(originalName: string): string {
  return `${trashTimestamp()}-${originalName}`;
}

export function parseTrashName(name: string): { original: string; deletedAt: Date | null } {
  const m = name.match(TRASH_TS_RE);
  if (!m) return { original: name, deletedAt: null };
  const s = m[1];
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;
  const d = new Date(iso);
  return { original: m[2], deletedAt: Number.isNaN(d.getTime()) ? null : d };
}

/**
 * Resolve a user-supplied trash entry name to its real path inside TRASH_DIR.
 * Rejects separators, "..", and anything that realpath-resolves outside the
 * trash folder.
 */
export async function resolveTrashEntry(trashName: unknown): Promise<string> {
  if (
    typeof trashName !== "string" ||
    trashName.length === 0 ||
    trashName.length > 512 ||
    trashName.includes("\0") ||
    trashName.includes("/") ||
    trashName === "." ||
    trashName === ".."
  ) {
    throw new ApiError(400, "invalid_name", "Invalid trash entry name");
  }
  const realTrash = await realpathOrNull(await ensureTrashDir());
  if (!realTrash) {
    throw new ApiError(500, "internal", "Trash folder is unavailable");
  }
  const candidate = path.join(realTrash, trashName);
  const real = await realpathOrNull(candidate);
  if (real === null) {
    throw new ApiError(404, "not_found", "Trash entry does not exist");
  }
  if (real !== realTrash && !real.startsWith(realTrash + path.sep)) {
    throw new ApiError(403, "path_not_allowed", "Invalid trash entry");
  }
  return real;
}

/** Move a path into the trash folder (soft delete). Returns the trash entry name. */
export async function moveToTrash(p: string): Promise<string> {
  await ensureTrashDir();
  const name = path.basename(p);
  let trashName = makeTrashName(name);
  let dest = path.join(TRASH_DIR, trashName);
  for (let i = 1; ; i++) {
    if (await realpathOrNull(dest)) {
      trashName = `${makeTrashName(name)}~${i}`;
      dest = path.join(TRASH_DIR, trashName);
      continue;
    }
    break;
  }
  await movePath(p, dest);
  return trashName;
}

/**
 * Rename/move with EXDEV fallback (e.g. /tmp tmpfs → project fs): copy
 * recursively, then remove the source.
 */
export async function movePath(from: string, to: string): Promise<void> {
  try {
    await fsp.rename(from, to);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "EXDEV") throw err;
    await fsp.cp(from, to, { recursive: true, force: true, dereference: false });
    await fsp.rm(from, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Sizes, modes, names
// ---------------------------------------------------------------------------

/** Recursive size in bytes (lstat-based, manual walk fallback for `du`). */
export async function pathSize(p: string): Promise<number> {
  try {
    const st = await fsp.lstat(p);
    if (!st.isDirectory()) return st.size;
    let total = 0;
    const stack: string[] = [p];
    let guard = 0;
    while (stack.length && guard++ < 200_000) {
      const dir = stack.pop()!;
      const ents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of ents) {
        const full = path.join(dir, e.name);
        const st2 = await fsp.lstat(full).catch(() => null);
        if (!st2) continue;
        if (st2.isDirectory()) stack.push(full);
        else total += st2.size;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/** Size via `du -sb` with a manual-walk fallback. */
export async function diskUsage(p: string): Promise<number> {
  const res = await run("du", ["-sb", p], { timeoutMs: 30_000, maxBuffer: 1024 * 1024 });
  const m = res.stdout.match(/^(\d+)\s/);
  if (res.ok && m) return Number(m[1]);
  return pathSize(p);
}

export function modeToOctal(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, "0");
}

/** Validate an octal permission string ("755" / "0755" / "4755"). */
export function parseModeString(mode: unknown): number {
  if (typeof mode !== "string" || !/^[0-7]{3,4}$/.test(mode)) {
    throw new ApiError(400, "invalid_mode", "Mode must be 3–4 octal digits (e.g. 0755)");
  }
  return parseInt(mode, 8);
}

/** Sanitize an uploaded file name: strip path separators/control chars. */
export function sanitizeUploadName(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new ApiError(400, "invalid_name", "Invalid file name");
  }
  let n = raw.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  n = n.replace(/[\0-\x1f\x7f]/g, "");
  if (!n || n === "." || n === "..") {
    throw new ApiError(400, "invalid_name", "Invalid file name");
  }
  if (n.length > 255) n = n.slice(0, 255);
  return n;
}

/** Validate a single path segment used as a new name (mkdir/touch/rename). */
export function validateNameSegment(name: unknown): string {
  if (typeof name !== "string" || name.length === 0 || name.length > 255) {
    throw new ApiError(400, "invalid_name", "Invalid name");
  }
  if (name.includes("/") || name.includes("\0") || name === "." || name === "..") {
    throw new ApiError(400, "invalid_name", "Invalid name");
  }
  return name;
}

// ---------------------------------------------------------------------------
// Content helpers (language / binary detection)
// ---------------------------------------------------------------------------

const EXT_LANGUAGE: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", jsonc: "json",
  md: "markdown", mdx: "markdown", markdown: "markdown",
  css: "css", scss: "scss", sass: "scss", less: "less",
  html: "html", htm: "html", xml: "xml", svg: "xml",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp",
  php: "php", swift: "swift", kt: "kotlin",
  sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
  yml: "yaml", yaml: "yaml", toml: "ini", ini: "ini", cfg: "ini", conf: "ini", env: "ini",
  sql: "sql", graphql: "graphql", gql: "graphql",
  txt: "plaintext", log: "plaintext", csv: "plaintext",
  dockerfile: "dockerfile", makefile: "makefile", lock: "plaintext",
  prisma: "prisma", vue: "html", svelte: "html",
};

export function languageForPath(p: string): string | undefined {
  const base = path.basename(p).toLowerCase();
  if (base === "dockerfile") return "dockerfile";
  if (base === "makefile") return "makefile";
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
  return EXT_LANGUAGE[ext];
}

const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tif", "tiff", "avif",
  "zip", "gz", "tgz", "tar", "bz2", "xz", "7z", "rar", "zst",
  "pdf", "exe", "dll", "so", "dylib", "bin", "o", "a", "wasm", "class", "jar",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "wav", "ogg", "flac", "mp4", "avi", "mov", "mkv", "webm",
  "sqlite", "db", "sqlite3", "node", "pyc", "pyo", "lockb",
]);

export function looksBinaryByExt(p: string): boolean {
  const base = path.basename(p).toLowerCase();
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
  return BINARY_EXT.has(ext);
}

/** Content sniff: null bytes in the first 8 KB ⇒ binary. */
export async function isBinaryContent(p: string): Promise<boolean> {
  const fh = await fsp.open(p, "r");
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buf, 0, 8192, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } finally {
    await fh.close();
  }
}

export function isArchivePath(p: string): boolean {
  const base = path.basename(p).toLowerCase();
  return (
    base.endsWith(".tar.gz") || base.endsWith(".tgz") ||
    base.endsWith(".tar.bz2") || base.endsWith(".tbz2") ||
    base.endsWith(".tar.xz") || base.endsWith(".txz") ||
    base.endsWith(".tar") || base.endsWith(".zip")
  );
}
