import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-error";
import { run, binaryExists } from "@/lib/exec";
import { SITES_DIR } from "@/lib/constants";
import { randomBase62, sha256Hex } from "@/lib/crypto";

/**
 * WordPress Toolkit — shared server logic.
 *
 * Everything here operates on REAL files with node:fs: the scanner parses
 * wp-includes/version.php, plugin main-file headers and theme style.css
 * headers; update checks talk to the real api.wordpress.org endpoints;
 * snapshots are real on-disk copies so rollback restores byte-for-byte.
 * Booleans are the only thing ever reported about wp-config.php contents.
 */

export const PHP_VERSIONS = ["8.1", "8.2", "8.3", "8.4"] as const;
export const AUTO_CORE_POLICIES = ["off", "minor", "major"] as const;
const WP_API_TIMEOUT_MS = 9_000;

/* ------------------------------------------------------------------ types */

export interface WpPluginInfo {
  slug: string;
  name: string;
  version: string;
  /** plugin file relative to wp-content/plugins (e.g. "hello-dolly/hello-dolly.php") */
  file: string;
}

export interface WpThemeInfo {
  slug: string;
  name: string;
  version: string;
}

export interface WpUpdatePlugin {
  slug: string;
  current: string;
  latest: string | null;
  available: boolean;
  /** true = the slug is not known to wordpress.org at all */
  unknown?: boolean;
}

export interface WpUpdateInfo {
  checkedAt: string;
  core: { current: string | null; latest: string | null; available: boolean };
  plugins: WpUpdatePlugin[];
  /** set when wordpress.org was unreachable (offline / egress-blocked) */
  error?: string;
}

export type WpUpdateResult = "applied" | "rolled_back" | "staged";

export interface WpHistoryEntry {
  target: string;
  from: string | null;
  to: string | null;
  at: string;
  result: WpUpdateResult;
  detail?: string;
}

export interface WpAdminLoginSettings {
  tokenHash: string;
  issuedAt: string;
  expiresAt: string;
  issuedBy: string;
}

export interface WpScanData {
  core?: { version: string | null };
  plugins?: WpPluginInfo[];
  themes?: WpThemeInfo[];
  wpConfig?: boolean;
  saltsPresent?: boolean;
  updates?: WpUpdateInfo;
  history?: WpHistoryEntry[];
  settings?: { adminLogin?: WpAdminLoginSettings | null };
}

/* ------------------------------------------------------------- site lookup */

export async function getSiteOr404(id: string) {
  const site = await db.wpSite.findUnique({ where: { id } });
  if (!site) throw new ApiError(404, "not_found", "WordPress site not found");
  return site;
}

export function parseScanJson(raw: string | null | undefined): WpScanData {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as WpScanData;
    return {};
  } catch {
    return {};
  }
}

/** Merge scan results into the stored scanJson, preserving settings + history. */
export function mergeScanData(prev: WpScanData, patch: WpScanData): WpScanData {
  return { ...prev, ...patch, settings: prev.settings, history: prev.history };
}

/** The panel's per-site working directory (snapshots, staging fallback, tmp). */
export function siteDataDir(siteId: string): string {
  return path.join(SITES_DIR, siteId);
}

/* -------------------------------------------------------------- validation */

const SYSTEM_PATH_DENYLIST = new Set([
  "/", "/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/root",
  "/run", "/sbin", "/srv", "/sys", "/usr", "/var", "/opt",
]);

export function validateDocRoot(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new ApiError(400, "invalid_path", "Document root path is required");
  }
  const t = input.trim();
  if (t.length > 4096 || t.includes("\0")) {
    throw new ApiError(400, "invalid_path", "Invalid path");
  }
  if (!t.startsWith("/")) {
    throw new ApiError(400, "invalid_path", "Path must be absolute (e.g. /var/www/blog)");
  }
  const norm = path.normalize(t);
  if (SYSTEM_PATH_DENYLIST.has(norm)) {
    throw new ApiError(400, "invalid_path", `Refusing to operate on system path ${norm}`);
  }
  return norm;
}

export function validateSiteUrl(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new ApiError(400, "invalid_url", "Site URL is required");
  }
  const t = input.trim();
  if (t.length > 2000) throw new ApiError(400, "invalid_url", "URL too long");
  let parsed: URL;
  try {
    parsed = new URL(t);
  } catch {
    throw new ApiError(400, "invalid_url", "URL must be a valid http(s) URL (e.g. https://blog.example.com)");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiError(400, "invalid_url", "Only http and https URLs are supported");
  }
  return t.replace(/\/+$/, "");
}

export function validatePhpVersion(input: unknown): string {
  if (typeof input !== "string" || !(PHP_VERSIONS as readonly string[]).includes(input)) {
    throw new ApiError(400, "invalid_php_version", `PHP version must be one of ${PHP_VERSIONS.join(", ")}`);
  }
  return input;
}

/* ------------------------------------------------------------ file reading */

function readFirst8k(file: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, 8192, 0);
    return buf.subarray(0, n).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* best effort */
      }
    }
  }
}

/** Parse a WordPress file header field ("Plugin Name", "Version", …). */
function headerValue(text: string, field: string): string | null {
  const m = text.match(new RegExp(`^[ \\t]*\\*?[ \\t]*${field}[ \\t]*:[ \\t]*(.+?)[ \\t]*$`, "mi"));
  return m ? m[1].trim() : null;
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ scanner */

export interface ScanInventory {
  pathExists: boolean;
  isDirectory: boolean;
  versionPhp: boolean;
  wpConfig: boolean;
  wpContent: boolean;
  pluginDirs: number;
  themeDirs: number;
}

export type ScanOutcome =
  | { ok: true; result: { core: { version: string | null }; plugins: WpPluginInfo[]; themes: WpThemeInfo[]; wpConfig: boolean; saltsPresent: boolean } }
  | { ok: false; inventory: ScanInventory; message: string };

const SALT_KEYS = [
  "AUTH_KEY", "SECURE_AUTH_KEY", "LOGGED_IN_KEY", "NONCE_KEY",
  "AUTH_SALT", "SECURE_AUTH_SALT", "LOGGED_IN_SALT", "NONCE_SALT",
];

/** Report ONLY booleans about wp-config.php — never its contents. */
function checkSalts(docRoot: string): { wpConfig: boolean; saltsPresent: boolean } {
  // WordPress itself looks one level above the docroot as a fallback.
  const candidates = [path.join(docRoot, "wp-config.php"), path.join(docRoot, "..", "wp-config.php")];
  for (const file of candidates) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    let allPresent = true;
    for (const key of SALT_KEYS) {
      const m = text.match(new RegExp(`define\\(\\s*['"]${key}['"]\\s*,\\s*['"]([^'"]*)['"]`));
      const value = m?.[1] ?? "";
      if (!value || value === "put your unique phrase here" || /^x+$/i.test(value)) {
        allPresent = false;
        break;
      }
    }
    return { wpConfig: true, saltsPresent: allPresent };
  }
  return { wpConfig: false, saltsPresent: false };
}

/** Main plugin file for a plugin directory: <dir>/<dir>.php first, else the
 *  first .php file in the directory root carrying a "Plugin Name" header. */
function findPluginMainFile(pluginDir: string, dirName: string): string | null {
  const canonical = path.join(pluginDir, `${dirName}.php`);
  if (fs.existsSync(canonical)) return canonical;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(pluginDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(".php")) {
      const text = readFirst8k(path.join(pluginDir, e.name));
      if (text && headerValue(text, "Plugin Name")) return path.join(pluginDir, e.name);
    }
  }
  return null;
}

export function scanWpInstall(docRoot: string): ScanOutcome {
  const inventory: ScanInventory = {
    pathExists: false,
    isDirectory: false,
    versionPhp: false,
    wpConfig: false,
    wpContent: false,
    pluginDirs: 0,
    themeDirs: 0,
  };

  let st: fs.Stats;
  try {
    st = fs.statSync(docRoot);
  } catch {
    return {
      ok: false,
      inventory,
      message: `Path ${docRoot} does not exist on this server — nothing was scanned.`,
    };
  }
  inventory.pathExists = true;
  if (!st.isDirectory()) {
    return {
      ok: false,
      inventory,
      message: `Path ${docRoot} exists but is not a directory.`,
    };
  }
  inventory.isDirectory = true;

  // Core version from wp-includes/version.php
  let coreVersion: string | null = null;
  const versionFile = path.join(docRoot, "wp-includes", "version.php");
  const versionText = readFirst8k(versionFile);
  if (versionText) {
    inventory.versionPhp = true;
    const m = versionText.match(/\$wp_version\s*=\s*['"]([^'"]+)['"]/);
    if (m) coreVersion = m[1];
  }

  const { wpConfig, saltsPresent } = checkSalts(docRoot);
  inventory.wpConfig = wpConfig;

  // Plugins
  const plugins: WpPluginInfo[] = [];
  const pluginsDir = path.join(docRoot, "wp-content", "plugins");
  inventory.wpContent = isDirectory(path.join(docRoot, "wp-content"));
  if (isDirectory(pluginsDir)) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        const dir = path.join(pluginsDir, e.name);
        const main = findPluginMainFile(dir, e.name);
        if (!main) continue;
        const text = readFirst8k(main);
        if (!text) continue;
        const name = headerValue(text, "Plugin Name");
        if (!name) continue;
        inventory.pluginDirs++;
        plugins.push({
          slug: e.name,
          name,
          version: headerValue(text, "Version") || "0.0",
          file: `${e.name}/${path.basename(main)}`,
        });
      } else if (e.name.endsWith(".php")) {
        // single-file plugin living directly in wp-content/plugins/
        const text = readFirst8k(path.join(pluginsDir, e.name));
        if (!text) continue;
        const name = headerValue(text, "Plugin Name");
        if (!name) continue;
        plugins.push({
          slug: e.name.replace(/\.php$/, ""),
          name,
          version: headerValue(text, "Version") || "0.0",
          file: e.name,
        });
      }
    }
  }

  // Themes
  const themes: WpThemeInfo[] = [];
  const themesDir = path.join(docRoot, "wp-content", "themes");
  if (isDirectory(themesDir)) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(themesDir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const text = readFirst8k(path.join(themesDir, e.name, "style.css"));
      if (!text) continue;
      const name = headerValue(text, "Theme Name");
      if (!name) continue;
      inventory.themeDirs++;
      themes.push({
        slug: e.name,
        name,
        version: headerValue(text, "Version") || "0.0",
      });
    }
  }

  if (!coreVersion) {
    const found: string[] = [];
    found.push(`wp-includes/version.php ${inventory.versionPhp ? "present (no parsable version)" : "missing"}`);
    found.push(`wp-config.php ${wpConfig ? "present" : "missing"}`);
    found.push(`wp-content/ ${inventory.wpContent ? "present" : "missing"}`);
    found.push(`${inventory.pluginDirs} plugin dir(s)`);
    found.push(`${inventory.themeDirs} theme dir(s)`);
    return {
      ok: false,
      inventory,
      message: `${docRoot} is not a WordPress install — no parsable $wp_version in wp-includes/version.php. What was found: ${found.join("; ")}.`,
    };
  }

  return {
    ok: true,
    result: { core: { version: coreVersion }, plugins, themes, wpConfig, saltsPresent },
  };
}

/* ------------------------------------------------------- wordpress.org APIs */

interface PluginCheckEntry {
  slug?: string;
  new_version?: string;
  package?: string | false;
}

interface PluginCheckResponse {
  plugins?: Record<string, PluginCheckEntry>;
  no_update?: Record<string, PluginCheckEntry>;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Real update check against https://api.wordpress.org/plugins/update-check/1.1/
 * (POST, form-encoded, exactly the payload format WP core sends).
 */
export async function checkPluginUpdates(plugins: WpPluginInfo[]): Promise<{
  plugins: WpUpdatePlugin[];
  packages: Record<string, string>;
  error?: string;
}> {
  if (!plugins.length) return { plugins: [], packages: {} };
  try {
    const body = new URLSearchParams();
    body.set(
      "plugins",
      JSON.stringify({
        plugins: Object.fromEntries(
          plugins.map((p) => [p.file, { Name: p.name, Version: p.version }])
        ),
        active: plugins.map((p) => p.file),
      })
    );
    body.set("locale", "en_US");
    // `all=true` makes wordpress.org also report up-to-date plugins in
    // `no_update` — without it current plugins simply disappear from the answer.
    body.set("all", "true");
    body.set("translations", "[]");
    const res = await fetchWithTimeout(
      "https://api.wordpress.org/plugins/update-check/1.1/",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "HipnoType-Panel/1.0; wordpress-toolkit",
        },
        body: body.toString(),
      },
      WP_API_TIMEOUT_MS
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as PluginCheckResponse;
    const updates = data.plugins || {};
    const noUpdate = data.no_update || {};
    const out: WpUpdatePlugin[] = [];
    const packages: Record<string, string> = {};
    for (const p of plugins) {
      const upd = updates[p.file];
      const cur = noUpdate[p.file];
      if (upd) {
        out.push({ slug: p.slug, current: p.version, latest: upd.new_version || null, available: true });
        if (typeof upd.package === "string") packages[p.slug] = upd.package;
      } else if (cur) {
        out.push({ slug: p.slug, current: p.version, latest: cur.new_version || p.version, available: false });
      } else {
        out.push({ slug: p.slug, current: p.version, latest: null, available: false, unknown: true });
      }
    }
    return { plugins: out, packages };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return {
      plugins: [],
      packages: {},
      error: `wordpress.org plugin update check failed: ${reason}`,
    };
  }
}

/** Real core version check against https://api.wordpress.org/core/version-check/1.7/ */
export async function checkCoreVersion(): Promise<{ latest: string | null; downloadUrl: string | null; error?: string }> {
  try {
    const res = await fetchWithTimeout(
      "https://api.wordpress.org/core/version-check/1.7/?locale=en_US",
      { headers: { "user-agent": "HipnoType-Panel/1.0; wordpress-toolkit" } },
      WP_API_TIMEOUT_MS
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { offers?: { current?: string; download?: string }[] };
    const offer = data.offers?.[0];
    return {
      latest: offer?.current ?? null,
      downloadUrl: offer?.download ?? null,
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { latest: null, downloadUrl: null, error: `wordpress.org core version check failed: ${reason}` };
  }
}

/* ----------------------------------------------------------- fs utilities */

/** Recursive size inventory of a directory (files + bytes), symlinks skipped. */
export function dirStats(root: string, maxEntries = 300_000): { files: number; bytes: number } | null {
  let files = 0;
  let bytes = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > 24 || files > maxEntries) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (e.isFile()) {
        files++;
        try {
          bytes += fs.statSync(full).size;
        } catch {
          /* unreadable file — skip */
        }
      }
    }
  };
  try {
    if (!isDirectory(root)) return null;
    walk(root, 0);
    return { files, bytes };
  } catch {
    return null;
  }
}

/** List all files under a directory, relative to it. */
export function listFilesRel(root: string, maxEntries = 100_000): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    if (out.length > maxEntries) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk(root, "");
  return out;
}

export function isWritableDir(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------- snapshots */

export function snapshotsDir(siteId: string): string {
  return path.join(siteDataDir(siteId), "wp-snapshots");
}

export interface SnapshotManifest {
  siteId: string;
  siteName: string;
  target: string;
  previousVersion: string | null;
  newVersion: string | null;
  /** files touched by the update, relative to the docroot */
  files: string[];
  /** directory holding the byte-for-byte pre-update copies */
  snapshotDir: string | null;
  zipFile: string | null;
  staged: boolean;
  createdAt: string;
}

/** Write the pre-update snapshot manifest (files touched + previous version)
 *  plus a real copy of everything the update will replace. */
export function writeSnapshot(
  site: { id: string; name: string },
  target: string,
  previousVersion: string | null,
  newVersion: string | null,
  sources: { copy: string; destRel: string }[],
  filesTouched: string[]
): { manifest: SnapshotManifest; manifestFile: string; snapshotDir: string } {
  const ts = Date.now();
  const safeName = target.replace(/[^a-z0-9.-]+/gi, "-");
  const dir = path.join(snapshotsDir(site.id), `${ts}-${safeName}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const s of sources) {
    if (!fs.existsSync(s.copy)) continue;
    const dest = path.join(dir, s.destRel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(s.copy, dest, { recursive: true });
  }
  const manifest: SnapshotManifest = {
    siteId: site.id,
    siteName: site.name,
    target,
    previousVersion,
    newVersion,
    files: filesTouched,
    snapshotDir: dir,
    zipFile: null,
    staged: false,
    createdAt: new Date().toISOString(),
  };
  const manifestFile = path.join(snapshotsDir(site.id), `${ts}.json`);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  return { manifest, manifestFile, snapshotDir: dir };
}

/** Restore a snapshot directory back over its original locations. */
export function restoreSnapshot(
  snapshotDir: string,
  sources: { copy: string; destRel: string }[]
): void {
  for (const s of sources) {
    const backup = path.join(snapshotDir, s.destRel);
    if (!fs.existsSync(backup)) continue;
    fs.rmSync(s.copy, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(s.copy), { recursive: true });
    fs.cpSync(backup, s.copy, { recursive: true });
  }
}

/* ------------------------------------------------------------ downloading */

export async function downloadToFile(url: string, destFile: string, timeoutMs = 90_000): Promise<number> {
  const res = await fetchWithTimeout(
    url,
    { headers: { "user-agent": "HipnoType-Panel/1.0; wordpress-toolkit" } },
    timeoutMs
  );
  if (!res.ok) throw new Error(`download failed with HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.writeFileSync(destFile, buf);
  return buf.length;
}

export async function unzipAvailable(): Promise<boolean> {
  return binaryExists("unzip");
}

export async function unzipInto(zipFile: string, destDir: string): Promise<{ ok: boolean; error?: string }> {
  fs.mkdirSync(destDir, { recursive: true });
  const res = await run("unzip", ["-o", "-q", zipFile, "-d", destDir], { timeoutMs: 120_000 });
  if (!res.ok) {
    return { ok: false, error: (res.stderr || res.stdout || "unzip failed").trim().slice(0, 300) };
  }
  return { ok: true };
}

/** Locate the extracted archive root (WP zips carry one top-level folder). */
export function extractedRoot(extractDir: string, expect?: string): string {
  if (expect) {
    const candidate = path.join(extractDir, expect);
    if (isDirectory(candidate)) return candidate;
  }
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(extractDir, { withFileTypes: true });
  } catch {
    return extractDir;
  }
  const dirs = entries.filter((e) => e.isDirectory() && e.name !== "__MACOSX");
  if (dirs.length === 1) return path.join(extractDir, dirs[0].name);
  return extractDir;
}

/** Snapshot sources for a plugin update (whole plugin dir, or the single file). */
export function pluginSnapshotSources(docRoot: string, pluginSlug: string, pluginFile: string) {
  const pluginsDir = path.join(docRoot, "wp-content", "plugins");
  if (!pluginFile.includes("/")) {
    const single = path.join(pluginsDir, pluginFile);
    return {
      sources: [{ copy: single, destRel: `plugins/${pluginFile}` }],
      touched: [`wp-content/plugins/${pluginFile}`],
    };
  }
  const dir = path.join(pluginsDir, pluginSlug);
  return {
    sources: [{ copy: dir, destRel: `plugins/${pluginSlug}` }],
    touched: listFilesRel(dir).map((f) => `wp-content/plugins/${pluginSlug}/${f}`),
  };
}

/** Snapshot sources for a core update (wp-includes, wp-admin, root php files).
 *  wp-config.php is never touched by a core update, so it is never copied. */
export function coreSnapshotSources(docRoot: string) {
  const sources: { copy: string; destRel: string }[] = [];
  const touched: string[] = [];
  for (const part of ["wp-includes", "wp-admin"]) {
    const dir = path.join(docRoot, part);
    if (isDirectory(dir)) {
      sources.push({ copy: dir, destRel: part });
      for (const f of listFilesRel(dir)) touched.push(`${part}/${f}`);
    }
  }
  try {
    for (const e of fs.readdirSync(docRoot, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith(".php") && e.name !== "wp-config.php") {
        sources.push({ copy: path.join(docRoot, e.name), destRel: `root/${e.name}` });
        touched.push(e.name);
      }
    }
  } catch {
    /* unreadable docroot — snapshot what we have */
  }
  return { sources, touched };
}

/* ------------------------------------------------------------ health check */

/** Fetch the site URL and return the HTTP status (null = unreachable). */
export async function healthCheck(url: string, timeoutMs = 12_000): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(
      url,
      { redirect: "follow", headers: { "user-agent": "HipnoType-Panel/1.0; health-check" } },
      timeoutMs
    );
    return res.status;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- staging */

export function resolveStagingPath(site: { id: string; path: string }): { stagingPath: string; fallback: boolean } {
  const parent = path.dirname(site.path);
  const preferred = path.join(parent, `${path.basename(site.path)}-staging`);
  if (isWritableDir(parent)) {
    return { stagingPath: preferred, fallback: false };
  }
  return { stagingPath: path.join(siteDataDir(site.id), "staging"), fallback: true };
}

/* ------------------------------------------------------------ admin login */

export function issueAdminLoginToken(issuedBy: string): { token: string; settings: WpAdminLoginSettings } {
  const token = randomBase62(32);
  const now = new Date();
  return {
    token,
    settings: {
      tokenHash: sha256Hex(token),
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
      issuedBy,
    },
  };
}
