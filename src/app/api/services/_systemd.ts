import fs from "fs";
import { run, binaryExists } from "@/lib/exec";

/**
 * Shared systemd detection for the Services module.
 * Honest about the environment: in a container (this preview) systemd is not
 * PID 1, so unit management only applies to the VPS deployment.
 */

export const CRITICAL_UNITS = ["sshd", "hipnod", "networking"];

export function isCriticalUnit(unit: string): boolean {
  const base = unit.replace(/\.service$/, "");
  if (CRITICAL_UNITS.includes(base)) return true;
  return base.startsWith("systemd-");
}

export async function detectSystemd(): Promise<boolean> {
  if (!fs.existsSync("/run/systemd/system")) return false;
  return binaryExists("systemctl");
}

export interface SystemdUnit {
  unit: string;
  load: string;
  active: string;
  sub: string;
  description: string;
  key: boolean;
}

const KEY_UNITS = ["sshd", "docker", "caddy", "cron", "hipnod", "fail2ban", "nginx"];

/** Parse `systemctl list-units` output into structured unit rows (cap 200). */
export function parseListUnits(stdout: string, cap = 200): SystemdUnit[] {
  const units: SystemdUnit[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.replace(/^[●○◍◌◦∙·*]\s*/, "").trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    const unit = parts[0];
    if (!unit.endsWith(".service")) continue;
    const base = unit.replace(/\.service$/, "");
    units.push({
      unit,
      load: parts[1],
      active: parts[2],
      sub: parts[3],
      description: parts.slice(4).join(" "),
      key: KEY_UNITS.some((k) => base === k || base.startsWith(k + "@")),
    });
    if (units.length >= cap) break;
  }
  return units;
}

const KNOWN_PANEL_PROCESS_NAMES = ["caddy", "node", "bun", "next", "hipno"];

export interface PanelProcess {
  name: string;
  pid: number;
  command: string;
}

/** Detect panel-related processes from `ps` (used when systemd is unavailable). */
export async function findPanelProcesses(): Promise<PanelProcess[]> {
  const res = await run("ps", ["-eo", "pid,comm,args", "--no-headers"], { timeoutMs: 10_000 });
  if (!res.ok) return [];
  const out: PanelProcess[] = [];
  for (const line of res.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) continue;
    const pid = Number(parts[0]);
    if (!Number.isInteger(pid)) continue;
    const comm = parts[1];
    const command = parts.slice(2).join(" ");
    const lower = `${comm} ${command}`.toLowerCase();
    const match = KNOWN_PANEL_PROCESS_NAMES.find(
      (k) => comm.toLowerCase().includes(k) || lower.includes(k)
    );
    if (match) {
      out.push({ name: match, pid, command: command || comm });
    }
    if (out.length >= 50) break;
  }
  return out;
}
