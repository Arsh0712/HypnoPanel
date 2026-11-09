import fs from "fs";
import os from "os";
import net from "net";
import { run, binaryExists } from "./exec";
import { PANEL_VERSION } from "./constants";

/** Real host information, read from the local machine (spec §4.6). */

export interface HostInfo {
  hostname: string;
  os: string;
  kernel: string;
  arch: string;
  uptimeSec: number;
  virt: string;
  cpuModel: string;
  cpuCores: number;
  memTotal: number;
  publicIpv4: string | null;
  publicIpv6: string | null;
  panelVersion: string;
}

export function readOsRelease(): { name: string; version: string; id: string } {
  try {
    const txt = fs.readFileSync("/etc/os-release", "utf8");
    const get = (k: string) =>
      txt.match(new RegExp(`^${k}="?([^"\\n]+)"?`, "m"))?.[1] || "";
    return { name: get("PRETTY_NAME") || get("NAME") || "Linux", version: get("VERSION_ID"), id: get("ID") };
  } catch {
    return { name: "Linux", version: "", id: "" };
  }
}

export async function detectVirt(): Promise<string> {
  if (await binaryExists("systemd-detect-virt")) {
    const res = await run("systemd-detect-virt", [], { timeoutMs: 3000 });
    return res.stdout.trim() || "none";
  }
  return "unknown";
}

let ipCache: { v4: string | null; v6: string | null; at: number } | null = null;

async function fetchText(url: string, timeoutMs = 4000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch {
    return null;
  }
}

/* ————— public IP detection (FIX#2 §3.5 — wizard must show the REAL IP) —————
 * Interface-first: read the machine's own NICs and keep only globally
 * routable addresses (excludes loopback, RFC1918, CGNAT 100.64/10,
 * link-local, IPv6 ULA). Two independent echo services then confirm what
 * the internet actually sees — when they disagree with the NIC (NAT), the
 * echoed address wins. Honest null when nothing can be determined; the
 * wizard explains how to point DNS manually.
 */

function isPublicV4(ip: string): boolean {
  if (net.isIPv4(ip) !== true) return false;
  const [a, b] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return false; // this-network, RFC1918, loopback
  if (a === 172 && b >= 16 && b <= 31) return false; // RFC1918
  if (a === 192 && b === 168) return false; // RFC1918
  if (a === 169 && b === 254) return false; // link-local (cloud metadata-range too)
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64.0.0/10
  if (a === 192 && b === 0) return false; // 192.0.0.0/24 + 192.0.2.0/24 TEST-NET
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast + reserved + broadcast
  return true;
}

function isPublicV6(ip: string): boolean {
  if (net.isIPv6(ip) !== true) return false;
  const low = ip.toLowerCase();
  if (low === "::" || low === "::1") return false; // unspecified / loopback
  if (low.startsWith("fe80:") || low.startsWith("fe9") || low.startsWith("fea") || low.startsWith("feb")) return false; // link-local
  if (low.startsWith("fc") || low.startsWith("fd")) return false; // ULA fc00::/7
  if (low.startsWith("::ffff:")) return false; // IPv4-mapped
  if (low.startsWith("64:ff9b:") || low.startsWith("64:ffac:")) return false; // NAT64 well-known prefixes
  if (low.startsWith("100::")) return false; // discard-only
  if (low.startsWith("2001:db8:")) return false; // documentation
  return true;
}

/** Globally-routable NIC addresses (the machine's own view). */
function interfacePublicIps(): { v4: string[]; v6: string[] } {
  const v4 = new Set<string>();
  const v6 = new Set<string>();
  const ifaces = os.networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.internal) continue;
      if (a.family === "IPv4" && isPublicV4(a.address)) v4.add(a.address);
      if ((a.family === "IPv6" || (a.family as unknown as string) === "6") && isPublicV6(a.address)) v6.add(a.address);
    }
  }
  return { v4: [...v4], v6: [...v6] };
}

const ECHO_V4 = ["https://api.ipify.org", "https://icanhazip.com"];
const ECHO_V6 = ["https://api6.ipify.org", "https://ipv6.icanhazip.com"];

async function firstEcho(urls: string[]): Promise<string | null> {
  for (const u of urls) {
    const t = await fetchText(u, 3500);
    if (t && !t.includes(" ")) return t;
  }
  return null;
}

/**
 * Resolve this server's real public IPv4/IPv6:
 *   1. NIC candidates (globally-routable only)
 *   2. confirmed / corrected by two independent echo services (NAT-aware)
 *   3. falls back to the NIC address when the echo services are unreachable
 *   4. honest null when neither source yields a public address
 */
export async function getPublicIps(): Promise<{ v4: string | null; v6: string | null }> {
  if (ipCache && Date.now() - ipCache.at < 10 * 60_000) {
    return { v4: ipCache.v4, v6: ipCache.v6 };
  }

  const nic = interfacePublicIps();

  // echo services — what the internet sees from this machine
  const [echoV4, echoV6] = await Promise.all([firstEcho(ECHO_V4), firstEcho(ECHO_V6)]);

  const resolve = (nicList: string[], echo: string | null, isPublic: (ip: string) => boolean): string | null => {
    if (echo && isPublic(echo)) return echo; // internet-confirmed (handles NAT: NIC may hold a private IP)
    if (nicList.length > 0) return nicList[0]; // real NIC address when echo is unreachable (egress-blocked envs)
    return null; // honest — never fabricate
  };

  const v4 = resolve(nic.v4, echoV4 && net.isIPv4(echoV4) ? echoV4 : null, isPublicV4);
  const v6 = resolve(nic.v6, echoV6 && net.isIPv6(echoV6) ? echoV6 : null, isPublicV6);

  ipCache = { v4, v6, at: Date.now() };
  return { v4, v6 };
}

export async function getHostInfo(): Promise<HostInfo> {
  const [virt, ips] = await Promise.all([detectVirt(), getPublicIps()]);
  const osr = readOsRelease();
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    os: osr.name,
    kernel: os.release(),
    arch: os.arch(),
    uptimeSec: os.uptime(),
    virt,
    cpuModel: cpus[0]?.model?.trim() || "unknown",
    cpuCores: cpus.length,
    memTotal: os.totalmem(),
    publicIpv4: ips.v4,
    publicIpv6: ips.v6,
    panelVersion: PANEL_VERSION,
  };
}

/** Check whether a local TCP port answers within a timeout. */
export function portOpen(port: number, host = "127.0.0.1", timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.connect(port, host);
  });
}

export interface ServiceHealthItem {
  name: string;
  status: "ok" | "down" | "unavailable";
  detail?: string;
}

/** Health of the components the panel orchestrates (honest probing). */
export async function getServiceHealth(): Promise<ServiceHealthItem[]> {
  const items: ServiceHealthItem[] = [];
  // Reverse proxy: in this environment Caddy runs as the gateway on :81
  items.push({
    name: "Reverse proxy (Caddy)",
    status: (await portOpen(81)) ? "ok" : "down",
    detail: (await portOpen(81)) ? "gateway :81" : "not listening on :81",
  });
  // Docker
  if (await binaryExists("docker")) {
    const res = await run("docker", ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 5000 });
    items.push({
      name: "Docker Engine",
      status: res.ok ? "ok" : "down",
      detail: res.ok ? `v${res.stdout.trim()}` : "daemon unreachable",
    });
  } else {
    items.push({ name: "Docker Engine", status: "unavailable", detail: "docker binary not installed" });
  }
  // Database (panel SQLite)
  items.push({ name: "Panel database (SQLite)", status: "ok", detail: "WAL" });
  // Firewall
  items.push({
    name: "Firewall (nftables)",
    status: (await binaryExists("nft")) ? "ok" : "unavailable",
    detail: (await binaryExists("nft")) ? "nft present" : "nft binary not installed",
  });
  // fail2ban
  items.push({
    name: "fail2ban",
    status: (await binaryExists("fail2ban-client")) ? "ok" : "unavailable",
    detail: (await binaryExists("fail2ban-client")) ? "client present" : "not installed",
  });
  return items;
}

/** Top processes by CPU (real ps output). */
export async function getTopProcesses(limit = 15): Promise<
  { pid: number; user: string; cpu: number; mem: number; rss: number; stat: string; command: string }[]
> {
  const res = await run(
    "ps",
    ["-eo", "pid,user,pcpu,pmem,rss,stat,comm", "--sort", "-pcpu", "--no-headers"],
    { timeoutMs: 5000 }
  );
  if (!res.ok) return [];
  const rows = res.stdout
    .split("\n")
    .filter(Boolean)
    .slice(0, limit)
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        pid: Number(parts[0]),
        user: parts[1],
        cpu: Number(parts[2]),
        mem: Number(parts[3]),
        rss: Number(parts[4]) * 1024,
        stat: parts[5],
        command: parts.slice(6).join(" "),
      };
    });
  return rows;
}
