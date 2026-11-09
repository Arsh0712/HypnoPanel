import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { run, binaryExists } from "@/lib/exec";

/**
 * Shared real-data helpers for the Performance module. Everything here reads
 * genuine host state (/proc, /etc, ps) — nothing is mocked.
 */

/* ————————————————————— persisted panel preferences ————————————————————— */

export async function getSettingJson<T>(key: string): Promise<T | null> {
  try {
    const row = await db.setting.findUnique({ where: { key } });
    if (!row) return null;
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function setSettingJson(key: string, value: unknown): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value: JSON.stringify(value) },
    create: { key, value: JSON.stringify(value) },
  });
}

/* ————————————————————— PHP-FPM advisor ————————————————————— */

export interface PhpTuning {
  "pm.max_children": number;
  "pm.start_servers": number;
  "pm.min_spare_servers": number;
  "pm.max_spare_servers": number;
  memory_limit: string;
  "opcache.memory_consumption": number;
  "opcache.max_accelerated_files": number;
  realpath_cache_size: string;
  realpath_cache_ttl: number;
}

/** Tuning keys persisted individually under the `perf.php.*` Setting namespace. */
const PHP_SETTING_KEYS: (keyof PhpTuning)[] = [
  "pm.max_children",
  "pm.start_servers",
  "pm.min_spare_servers",
  "pm.max_spare_servers",
  "memory_limit",
  "opcache.memory_consumption",
  "opcache.max_accelerated_files",
  "realpath_cache_size",
  "realpath_cache_ttl",
];

const PHP_SETTING_PREFIX = "perf.php.";

/** Read the persisted PHP tuning (perf.php.* keys) — null until every key exists. */
export async function getPhpTuning(): Promise<PhpTuning | null> {
  const rows = await db.setting.findMany({
    where: { key: { startsWith: PHP_SETTING_PREFIX } },
  });
  if (rows.length < PHP_SETTING_KEYS.length) return null;
  const map = new Map<string, unknown>();
  for (const row of rows) {
    try {
      map.set(row.key.slice(PHP_SETTING_PREFIX.length), JSON.parse(row.value));
    } catch {
      /* skip corrupt row */
    }
  }
  const out: Record<string, unknown> = {};
  for (const k of PHP_SETTING_KEYS) {
    const v = map.get(k);
    if (v === undefined) return null;
    out[k] = v;
  }
  const parsed = validatePhpTuning(out);
  return parsed;
}

/** Persist a validated tuning object as individual `perf.php.*` Settings. */
export async function savePhpTuning(t: PhpTuning): Promise<void> {
  for (const k of PHP_SETTING_KEYS) {
    await setSettingJson(PHP_SETTING_PREFIX + k, t[k]);
  }
}

/**
 * Real computation from host RAM: budget 75% of RAM for PHP-FPM at an average
 * 512 MB per worker, then derive the dynamic-pm spare values (spec §5.4).
 */
export function computePhpTuning(totalRam: number): PhpTuning {
  const maxChildren = Math.max(2, Math.floor((totalRam * 0.75) / (512 * 1024 * 1024)));
  const minSpare = Math.max(1, Math.ceil(maxChildren / 8));
  return {
    "pm.max_children": maxChildren,
    "pm.start_servers": Math.max(2, Math.ceil(maxChildren / 4)),
    "pm.min_spare_servers": minSpare,
    "pm.max_spare_servers": Math.max(minSpare + 1, Math.floor(maxChildren * 0.75)),
    memory_limit: "256M",
    "opcache.memory_consumption": 192,
    "opcache.max_accelerated_files": 130000,
    realpath_cache_size: "4096k",
    realpath_cache_ttl: 600,
  };
}

export function phpSnippet(t: PhpTuning): string {
  return [
    "; — HipnoType Panel · PHP-FPM pool (www.conf) —",
    "pm = dynamic",
    `pm.max_children = ${t["pm.max_children"]}`,
    `pm.start_servers = ${t["pm.start_servers"]}`,
    `pm.min_spare_servers = ${t["pm.min_spare_servers"]}`,
    `pm.max_spare_servers = ${t["pm.max_spare_servers"]}`,
    "",
    "; — php.ini overrides —",
    `memory_limit = ${t.memory_limit}`,
    "opcache.enable = 1",
    `opcache.memory_consumption = ${t["opcache.memory_consumption"]}`,
    `opcache.max_accelerated_files = ${t["opcache.max_accelerated_files"]}`,
    "opcache.validate_timestamps = 1",
    "opcache.revalidate_freq = 2",
    `realpath_cache_size = ${t.realpath_cache_size}`,
    `realpath_cache_ttl = ${t.realpath_cache_ttl}`,
  ].join("\n");
}

/** Validate a client-supplied tuning object; returns a cleaned copy or null. */
export function validatePhpTuning(v: unknown): PhpTuning | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const int = (key: string, min: number, max: number): number | null => {
    const n = o[key];
    if (!Number.isInteger(n) || (n as number) < min || (n as number) > max) return null;
    return n as number;
  };
  const sizeStr = (key: string, re: RegExp): string | null => {
    const s = o[key];
    return typeof s === "string" && re.test(s) ? s : null;
  };
  const maxChildren = int("pm.max_children", 2, 1000);
  const start = int("pm.start_servers", 1, 1000);
  const minSpare = int("pm.min_spare_servers", 1, 1000);
  const maxSpare = int("pm.max_spare_servers", 1, 1000);
  const opcacheMem = int("opcache.memory_consumption", 16, 1024);
  const opcacheFiles = int("opcache.max_accelerated_files", 1000, 1000000);
  const ttl = int("realpath_cache_ttl", 30, 86400);
  const memoryLimitRaw = sizeStr("memory_limit", /^\d+M$/i);
  const realpathSizeRaw = sizeStr("realpath_cache_size", /^\d+[KM]$/i);
  if (
    maxChildren === null || start === null || minSpare === null || maxSpare === null ||
    opcacheMem === null || opcacheFiles === null || ttl === null ||
    memoryLimitRaw === null || realpathSizeRaw === null
  ) {
    return null;
  }
  if (minSpare > maxSpare || start > maxSpare || start < minSpare) return null;
  return {
    "pm.max_children": maxChildren,
    "pm.start_servers": start,
    "pm.min_spare_servers": minSpare,
    "pm.max_spare_servers": maxSpare,
    memory_limit: memoryLimitRaw.toUpperCase(),
    "opcache.memory_consumption": opcacheMem,
    "opcache.max_accelerated_files": opcacheFiles,
    realpath_cache_size: realpathSizeRaw.toLowerCase(),
    realpath_cache_ttl: ttl,
  };
}

/* ————————————————————— swap ————————————————————— */

export interface SwapDevice {
  name: string;
  type: string;
  sizeBytes: number;
  usedBytes: number;
  priority: number;
}

export interface SwapStatus {
  totalBytes: number;
  usedBytes: number;
  cachedBytes: number;
  devices: SwapDevice[];
  swaponAvailable: boolean;
  source: "swapon --show" | "/proc/swaps" | "none";
}

function readMeminfoSwap(): { total: number; free: number; cached: number } {
  try {
    const txt = fs.readFileSync("/proc/meminfo", "utf8");
    const get = (k: string) => Number(txt.match(new RegExp(`^${k}:\\s+(\\d+) kB`, "m"))?.[1] || 0) * 1024;
    return { total: get("SwapTotal"), free: get("SwapFree"), cached: get("SwapCached") };
  } catch {
    return { total: 0, free: 0, cached: 0 };
  }
}

/**
 * Real swap devices: `swapon --show` when the binary is present (spec §5.4),
 * falling back to /proc/swaps. Totals always come from /proc/meminfo.
 */
export async function readSwapStatus(): Promise<SwapStatus> {
  const mem = readMeminfoSwap();
  const devices: SwapDevice[] = [];
  let source: SwapStatus["source"] = "none";

  if (await binaryExists("swapon")) {
    // Default --show columns: NAME TYPE SIZE USED PRIO (--bytes → raw bytes).
    const res = await run("swapon", ["--show", "--bytes", "--noheadings"], {
      timeoutMs: 5000,
    });
    if (res.ok) {
      source = "swapon --show";
      for (const line of res.stdout.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5 || !parts[0]) continue;
        const size = Number(parts[2]);
        const used = Number(parts[3]);
        if (!Number.isFinite(size) || !Number.isFinite(used)) continue;
        devices.push({
          name: parts[0],
          type: parts[1],
          sizeBytes: size,
          usedBytes: used,
          priority: Number(parts[4]) || 0,
        });
      }
    }
  }

  if (source === "none") {
    // Fallback: /proc/swaps (columns: Filename Type Size[kB] Used Priority).
    source = "/proc/swaps";
    try {
      const txt = fs.readFileSync("/proc/swaps", "utf8");
      for (const line of txt.split("\n").slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const size = Number(parts[2]) * 1024;
        const used = Number(parts[3]) * 1024;
        if (!Number.isFinite(size) || !Number.isFinite(used)) continue;
        devices.push({
          name: parts[0],
          type: parts[1],
          sizeBytes: size,
          usedBytes: used,
          priority: Number(parts[4]),
        });
      }
    } catch {
      /* no /proc/swaps */
      source = "none";
    }
  }

  return {
    totalBytes: mem.total,
    usedBytes: mem.total - mem.free,
    cachedBytes: mem.cached,
    devices,
    swaponAvailable: await binaryExists("swapon"),
    source,
  };
}

/* ————————————————————— network sysctls ————————————————————— */

export interface NetSysctlStatus {
  available: boolean;
  congestionControl: string;
  availableAlgorithms: string[];
}

export async function readNetSysctls(): Promise<NetSysctlStatus> {
  try {
    const cc = fs.readFileSync("/proc/sys/net/ipv4/tcp_congestion_control", "utf8").trim();
    const algos = fs
      .readFileSync("/proc/sys/net/ipv4/tcp_available_congestion_control", "utf8")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return { available: true, congestionControl: cc, availableAlgorithms: algos };
  } catch {
    return { available: false, congestionControl: "unknown", availableAlgorithms: [] };
  }
}

/* ————————————————————— Caddyfile features ————————————————————— */

export interface HttpFeatures {
  caddyFile: string | null;
  encode: string[];
  staticCache: boolean;
  tls: boolean;
  note: string;
}

function findCaddyFile(): string | null {
  const candidates = [path.join(process.cwd(), "Caddyfile"), "/etc/caddy/Caddyfile"];
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.R_OK);
      return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Parse the active Caddyfile and report honestly what is configured. */
export async function readHttpFeatures(): Promise<HttpFeatures> {
  const file = findCaddyFile();
  if (!file) {
    return {
      caddyFile: null,
      encode: [],
      staticCache: false,
      tls: false,
      note: "No Caddyfile found — the reverse proxy is installed per-site on the VPS deployment.",
    };
  }
  let txt = "";
  try {
    txt = fs.readFileSync(file, "utf8");
  } catch {
    return {
      caddyFile: file,
      encode: [],
      staticCache: false,
      tls: false,
      note: "Caddyfile found but not readable by the panel process.",
    };
  }
  // encode directive: `encode` or `encode zstd gzip brotli`
  const encodeMatches = [...txt.matchAll(/^\s*encode(?:\s+([a-z ]+))?\s*$/gim)];
  const encoders = new Set<string>();
  for (const m of encodeMatches) {
    for (const a of (m[1] || "").split(/\s+/).filter(Boolean)) encoders.add(a);
    if (!m[1]) encoders.add("default (zstd, gzip)");
  }
  // static caching: any explicit Cache-Control header on responses
  const staticCache = /header[^\n]*Cache-Control|Cache-Control[^\n]*max-age/i.test(txt);
  const tls = /^\s*(\S+\s+)*tls\b|:\s*443/m.test(txt);
  const siteBlocks = (txt.match(/^\s*[^\s#{]+.*\{\s*$/gm) || []).length;
  const notes: string[] = [];
  notes.push(
    encoders.size
      ? `Compression directive present: ${Array.from(encoders).join(", ")}.`
      : "No encode directive in this file — Caddy serves uncompressed unless a site block adds one."
  );
  const listen = txt.match(/^\s*:\d+\s*\{/m)?.[0]?.trim().replace(/\s*\{/, "");
  if (listen) {
    notes.push(`This instance listens on ${listen} (plain HTTP gateway) — TLS terminates at site blocks on the VPS deployment.`);
  }
  notes.push(`${siteBlocks} site block(s) detected.`);
  return {
    caddyFile: file,
    encode: Array.from(encoders),
    staticCache,
    tls,
    note: notes.join(" "),
  };
}

/* ————————————————————— process sampling ————————————————————— */

export interface ProcRow {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  rssBytes: number;
  stat: string;
  command: string;
}

/** Real `ps` with full args (unlike getTopProcesses which uses comm only). */
export async function psTop(sortBy: "cpu" | "mem", limit = 10): Promise<ProcRow[]> {
  const res = await run(
    "ps",
    ["-eo", "pid,user,pcpu,pmem,rss,stat,args", "--sort", `-${sortBy === "cpu" ? "pcpu" : "pmem"}`, "--no-headers"],
    { timeoutMs: 5000 }
  );
  if (!res.ok) return [];
  const rows: ProcRow[] = [];
  for (const line of res.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 7) continue;
    const pid = Number(parts[0]);
    if (!Number.isInteger(pid)) continue;
    rows.push({
      pid,
      user: parts[1],
      cpu: Number(parts[2]) || 0,
      mem: Number(parts[3]) || 0,
      rssBytes: (Number(parts[4]) || 0) * 1024,
      stat: parts[5],
      command: parts.slice(6).join(" "),
    });
    if (rows.length >= limit) break;
  }
  return rows;
}
