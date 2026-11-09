import { NextRequest, NextResponse } from "next/server";
import os from "os";
import { guard } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import { PANEL_VERSION } from "@/lib/constants";
import { getMetricsEngine } from "@/lib/metrics";
import { readOsRelease, detectVirt } from "@/lib/sysinfo";
import { run } from "@/lib/exec";
import {
  TCP_STATES,
  parseTcpFile,
  parseDefaultRoute,
  parseResolvConf,
  knownService,
  detectLocale,
  readEtcTimezone,
  getSettingJson,
} from "../_shared";

export const runtime = "nodejs";

/**
 * GET /api/server/overview — host identity, network overview, listening ports
 * and current action state. Every value is a real read from os / /proc / /etc.
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "server:read" });

  const osr = readOsRelease();
  const virt = await detectVirt();
  const cpus = os.cpus();

  /* ————— info grid ————— */
  let systemTz: string | null = null;
  let tzSource = "Intl resolved";
  try {
    systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    systemTz = null;
  }
  const etcTz = readEtcTimezone();
  if (!systemTz && etcTz) {
    systemTz = etcTz;
    tzSource = "/etc/timezone";
  }
  const panelTz = await getSettingJson<string>("server.timezone");

  const info = {
    hostname: os.hostname(),
    distro: osr.name || "Linux",
    kernel: os.release(),
    arch: os.arch(),
    virt,
    uptimeSec: os.uptime(),
    bootTime: new Date(Date.now() - os.uptime() * 1000).toISOString(),
    panelVersion: PANEL_VERSION,
    timezone: { system: systemTz, panel: panelTz, source: systemTz ? tzSource : "unavailable" },
    locale: detectLocale(),
    cpuModel: cpus[0]?.model?.trim() || "unknown",
    cpuCores: cpus.length,
  };

  /* ————— network overview ————— */
  const ifaces: {
    name: string;
    addr: string;
    cidr: string | null;
    family: string;
    mac: string;
    internal: boolean;
  }[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      const cidr = a.family === "IPv4" && a.netmask && !a.netmask.includes(":") ? netmaskToCidr(a.netmask) : null;
      ifaces.push({
        name,
        addr: a.address,
        cidr,
        family: a.family,
        mac: a.mac,
        internal: a.internal,
      });
    }
  }

  const tcp4 = parseTcpFile("/proc/net/tcp", "v4");
  const tcp6 = parseTcpFile("/proc/net/tcp6", "v6");
  const stateCounts = new Map<string, number>();
  for (const e of [...tcp4, ...tcp6]) {
    const name = TCP_STATES[e.state] || `RAW_${e.state}`;
    stateCounts.set(name, (stateCounts.get(name) || 0) + 1);
  }
  const tcpStates = [...stateCounts.entries()]
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const engine = getMetricsEngine();
  if (engine.ring.length === 0) engine.sample();
  const snap = engine.latest();

  const network = {
    interfaces: ifaces,
    defaultRoute: parseDefaultRoute(),
    dns: parseResolvConf(),
    tcpStates,
    bandwidth: {
      rxBytesSec: snap?.netRx ?? 0,
      txBytesSec: snap?.netTx ?? 0,
    },
  };

  /* ————— listening ports (state 0A) ————— */
  const seen = new Set<string>();
  const ports: {
    port: number;
    proto: "v4" | "v6";
    address: string;
    service: string;
    known: boolean;
  }[] = [];
  for (const [entries, proto] of [
    [tcp4, "v4"],
    [tcp6, "v6"],
  ] as const) {
    for (const e of entries) {
      if (e.state !== "0A") continue;
      const key = `${proto}-${e.localPort}`;
      if (seen.has(key)) continue; // one row per port+proto
      seen.add(key);
      const svc = knownService(e.localPort);
      ports.push({ port: e.localPort, proto, address: e.localAddress, service: svc.service, known: svc.known });
    }
  }
  ports.sort((a, b) => a.port - b.port || a.proto.localeCompare(b.proto));

  /* ————— actions state ————— */
  const rebootAt = await getSettingJson<string>("server.reboot.at");
  let ntp: { available: boolean; status: string | null; detail: string | null } = {
    available: false,
    status: null,
    detail: null,
  };
  const td = await run("timedatectl", ["show"], { timeoutMs: 4000 });
  if (td.ok) {
    const get = (k: string) => td.stdout.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() || null;
    const ntpOn = get("NTP");
    const sync = get("NTPSynchronized");
    ntp = {
      available: true,
      status: ntpOn === "yes" && sync === "yes" ? "synchronised" : ntpOn === "yes" ? "not yet synced" : "disabled",
      detail: get("Timezone") ? `timedatectl: ${get("Timezone")}` : null,
    };
  } else {
    ntp = {
      available: false,
      status: null,
      detail:
        "timedatectl cannot reach systemd-timedated (PID 1 is not systemd in this environment) — NTP status applies to the VPS deployment.",
    };
  }

  return NextResponse.json({
    info,
    network,
    ports,
    actions: {
      reboot: { scheduledAt: rebootAt },
      ntp,
    },
  });
});

/** Convert a dotted netmask to a CIDR prefix length. */
function netmaskToCidr(mask: string): string {
  const bits = mask
    .split(".")
    .map((o) => Number(o).toString(2).replace(/0+$/, "").length)
    .reduce((a, b) => a + b, 0);
  return String(bits);
}
