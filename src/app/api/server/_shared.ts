import fs from "fs";
import { db } from "@/lib/db";

/**
 * Shared real-data helpers for the Server module: /proc/net parsing, mount
 * inspection and persisted action state (scheduled reboot).
 */

/* ————————————————————— persisted action state ————————————————————— */

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

export async function deleteSetting(key: string): Promise<void> {
  try {
    await db.setting.delete({ where: { key } });
  } catch {
    /* already absent */
  }
}

/* ————————————————————— /proc/net parsing ————————————————————— */

export const TCP_STATES: Record<string, string> = {
  "01": "ESTABLISHED",
  "02": "SYN_SENT",
  "03": "SYN_RECV",
  "04": "FIN_WAIT1",
  "05": "FIN_WAIT2",
  "06": "TIME_WAIT",
  "07": "CLOSE",
  "08": "CLOSE_WAIT",
  "09": "LAST_ACK",
  "0A": "LISTEN",
  "0B": "CLOSING",
  "0C": "NEW_SYN_RECV",
};

/** "0100007F" (little-endian) → "127.0.0.1" */
export function hexToIpv4(hex: string): string {
  const b = [0, 2, 4, 6].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `${b[3]}.${b[2]}.${b[1]}.${b[0]}`;
}

/** 32-hex-char /proc/net/tcp6 address (per-4-byte little-endian) → IPv6 text. */
export function hexToIpv6(hex: string): string {
  const bytes: number[] = [];
  for (let g = 0; g < 4; g++) {
    const chunk = hex.slice(g * 8, g * 8 + 8);
    // each 8-hex group = 4 bytes stored little-endian
    for (let i = 3; i >= 0; i--) {
      bytes.push(parseInt(chunk.slice(i * 2, i * 2 + 2), 16) || 0);
    }
  }
  const groups: string[] = [];
  for (let i = 0; i < 8; i++) {
    groups.push((((bytes[i * 2] << 8) | bytes[i * 2 + 1]) & 0xffff).toString(16));
  }
  // compress the longest run of zero groups (RFC 5952 style)
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  groups.forEach((g, i) => {
    if (g === "0") {
      if (curStart < 0) {
        curStart = i;
        curLen = 1;
      } else {
        curLen++;
      }
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  });
  if (bestLen < 2) return groups.join(":");
  const head = groups.slice(0, bestStart).join(":");
  const tail = groups.slice(bestStart + bestLen).join(":");
  return `${head}::${tail}`;
}

export interface TcpEntry {
  localAddress: string;
  localPort: number;
  state: string;
}

export function parseTcpFile(path: string, family: "v4" | "v6"): TcpEntry[] {
  let txt: string;
  try {
    txt = fs.readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: TcpEntry[] = [];
  for (const line of txt.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const local = parts[1]; // e.g. 0100007F:A3CD
    const [hexIp, hexPort] = local.split(":");
    if (!hexIp || !hexPort) continue;
    const port = parseInt(hexPort, 16);
    if (!Number.isInteger(port)) continue;
    out.push({
      localAddress: family === "v4" ? hexToIpv4(hexIp) : hexToIpv6(hexIp),
      localPort: port,
      state: parts[3],
    });
  }
  return out;
}

/** Default route from /proc/net/route (hex, little-endian, lowest metric wins). */
export function parseDefaultRoute(): { iface: string; gateway: string; metric: number } | null {
  let txt: string;
  try {
    txt = fs.readFileSync("/proc/net/route", "utf8");
  } catch {
    return null;
  }
  let best: { iface: string; gateway: string; metric: number } | null = null;
  for (const line of txt.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 8) continue;
    const [iface, dest, gateway, flags, , , metric] = parts;
    if (dest !== "00000000") continue;
    // flag 0x2 = gateway (RTF_GATEWAY); without it the route is link-local
    const hasGateway = (parseInt(flags, 16) & 0x2) !== 0;
    const row = {
      iface,
      gateway: hasGateway ? hexToIpv4(gateway) : "link",
      metric: Number(metric) || 0,
    };
    if (!best || row.metric < best.metric) best = row;
  }
  return best;
}

/** DNS resolvers from /etc/resolv.conf (real read). */
export function parseResolvConf(): string[] {
  try {
    const txt = fs.readFileSync("/etc/resolv.conf", "utf8");
    return [
      ...new Set(
        txt
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("nameserver"))
          .map((l) => l.split(/\s+/)[1])
          .filter(Boolean)
      ),
    ];
  } catch {
    return [];
  }
}

/* ————————————————————— known port labels ————————————————————— */

const KNOWN_PORTS: Record<number, string> = {
  21: "ftp",
  22: "ssh",
  25: "smtp",
  53: "dns",
  80: "http",
  81: "caddy gateway",
  110: "pop3",
  143: "imap",
  443: "https",
  465: "smtps",
  587: "submission",
  993: "imaps",
  995: "pop3s",
  3000: "hipno panel",
  3001: "hipno mini-service",
  3002: "hipno mini-service",
  3003: "hipno mini-service",
  3004: "hipno mini-service",
  3005: "hipno relay",
  3306: "mysql",
  5432: "postgresql",
  6379: "redis",
  8080: "alt-http",
  8443: "alt-https",
};

export function knownService(port: number): { service: string; known: boolean } {
  const s = KNOWN_PORTS[port];
  if (s) return { service: s, known: true };
  return { service: `port ${port}`, known: false };
}

/* ————————————————————— mounts + statfs ————————————————————— */

export interface MountInfo {
  path: string;
  device: string;
  fstype: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPct: number;
}

interface StatFsLike {
  bsize: number;
  blocks: number;
  bfree: number;
}

/** Map of mountpoint → {device, fstype} from a real /proc/mounts read. */
export function parseMounts(): Map<string, { device: string; fstype: string }> {
  const map = new Map<string, { device: string; fstype: string }>();
  try {
    const txt = fs.readFileSync("/proc/mounts", "utf8");
    for (const line of txt.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      map.set(parts[1], { device: parts[0], fstype: parts[2] });
    }
  } catch {
    /* no /proc/mounts */
  }
  return map;
}

export function statfsPath(p: string): MountInfo | null {
  try {
    const st: StatFsLike = fs.statfsSync(p) as unknown as StatFsLike;
    const total = st.blocks * st.bsize;
    const free = st.bfree * st.bsize;
    if (total <= 0) return null;
    return {
      path: p,
      device: "",
      fstype: "",
      totalBytes: total,
      usedBytes: total - free,
      freeBytes: free,
      usedPct: ((total - free) / total) * 100,
    };
  } catch {
    return null;
  }
}

/* ————————————————————— locale / timezone reads ————————————————————— */

export function detectLocale(): string | null {
  if (process.env.LANG) return process.env.LANG;
  for (const f of ["/etc/default/locale", "/etc/locale.conf"]) {
    try {
      const txt = fs.readFileSync(f, "utf8");
      const m = txt.match(/^LANG="?([^\n"]+)"?/m);
      if (m?.[1]) return m[1];
    } catch {
      /* next */
    }
  }
  return null;
}

export function readEtcTimezone(): string | null {
  try {
    return fs.readFileSync("/etc/timezone", "utf8").trim() || null;
  } catch {
    return null;
  }
}

/* ————————————————————— apt parsing ————————————————————— */

export interface ParsedUpdate {
  pkg: string;
  current: string | null;
  candidate: string;
  security: boolean;
  repo: string;
}

/** Parse `apt-get -s upgrade` Inst lines (real output, real formats). */
export function parseAptSim(stdout: string): ParsedUpdate[] {
  const updates: ParsedUpdate[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("Inst ")) continue;
    // Inst pkg [current] (candidate repo1 [repo2] [arch])  — current optional
    const m = line.match(/^Inst (\S+)(?: \[([^\]]+)\])? \((\S+)[ )](.*)\)$/);
    if (!m) continue;
    const [, pkg, current, candidate, repoRest] = m;
    const repo = repoRest.replace(/\s+\[[^\]]*\]\)?$/, "").trim();
    updates.push({
      pkg,
      current: current ?? null,
      candidate,
      security: /-security/i.test(repo),
      repo: repo || "local",
    });
  }
  return updates;
}
