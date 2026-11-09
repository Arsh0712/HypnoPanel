import fs from "fs";
import os from "os";
import path from "path";
import type { FirewallRule } from "@prisma/client";
import { db } from "@/lib/db";
import { run, binaryExists } from "@/lib/exec";
import { isValidPort, isValidCidr } from "@/lib/validation";

/**
 * Firewall engine (spec §5.8): nftables ruleset generation + apply with a
 * 60-second confirm window and automatic rollback.
 *
 * Internal settings keys (NOT part of PanelSettings — stored via direct
 * db.setting upsert):
 *  - firewall.pendingConfirm  → JSON { deadline: number, appliedAt: string } | absent
 *  - firewall.rollbackRules   → JSON string of the previous ruleset text
 *  - firewall.lastApplied     → JSON string of the last applied ruleset text
 */

export const FIREWALL_PENDING_KEY = "firewall.pendingConfirm";
export const FIREWALL_ROLLBACK_KEY = "firewall.rollbackRules";
export const FIREWALL_LAST_APPLIED_KEY = "firewall.lastApplied";

/** Confirm window before automatic rollback (spec §5.8). */
export const FIREWALL_CONFIRM_WINDOW_MS = 60_000;

export interface PendingConfirm {
  deadline: number;
  appliedAt: string;
}

// ---------------------------------------------------------------- internal settings

async function getInternalSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function setInternalSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

async function clearInternalSetting(key: string): Promise<void> {
  await db.setting.delete({ where: { key } }).catch(() => {
    /* already absent */
  });
}

// ---------------------------------------------------------------- ruleset generation

/**
 * Generate a complete nftables ruleset for `table inet hipno` from the panel's
 * rule list. Base policy is accept with sensible default allows (established /
 * related, loopback, ICMP). Deny rules are emitted before allow rules so that
 * explicit blocks always win. Every panel rule carries a `# hipno rule <id>`
 * comment for traceability.
 */
export function generateRuleset(rules: FirewallRule[]): string {
  const enabled = rules.filter((r) => r.enabled);
  const deny = enabled.filter((r) => r.action === "deny");
  const allow = enabled.filter((r) => r.action === "allow");

  const ruleLine = (r: FirewallRule): string => {
    const parts: string[] = [];
    if (r.source !== "any") parts.push(`ip saddr ${r.source}`);
    const ports = r.portStart === r.portEnd ? `${r.portStart}` : `${r.portStart}-${r.portEnd}`;
    if (r.protocol === "both") {
      parts.push("meta l4proto { tcp, udp }", `th dport ${ports}`);
    } else if (r.protocol === "tcp") {
      parts.push(`tcp dport ${ports}`);
    } else {
      parts.push(`udp dport ${ports}`);
    }
    parts.push(r.action === "deny" ? "drop" : "accept");
    return `    ${parts.join(" ")} # hipno rule ${r.id}`;
  };

  const lines: string[] = [
    "#!/usr/sbin/nft -f",
    "# HipnoType Panel — generated nftables ruleset (spec §5.8)",
    "# Base policy is accept; deny rules are emitted before allow rules.",
    "flush ruleset",
    "",
    "table inet hipno {",
    "  chain input {",
    "    type filter hook input priority filter; policy accept;",
    "    ct state established,related accept",
    "    iifname \"lo\" accept",
    "    meta l4proto { icmp, icmpv6 } accept",
  ];
  for (const r of deny) lines.push(ruleLine(r));
  for (const r of allow) lines.push(ruleLine(r));
  lines.push("  }", "}");
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------- apply

/** Locate the nft binary (full path) or null when not installed. */
export async function findNftBinary(): Promise<string | null> {
  const res = await run("which", ["nft"], { timeoutMs: 3000 });
  const p = res.stdout.trim();
  return res.ok && p ? p : null;
}

/**
 * Apply a ruleset by writing it to a 0600 temp file under os.tmpdir() and
 * running `nft -c -f` (syntax check) followed by `nft -f` (apply).
 * The temp file is always deleted afterwards.
 */
export async function applyRuleset(
  nftBinary: string | null,
  text: string
): Promise<{ applied: boolean; error?: string }> {
  if (!nftBinary) return { applied: false, error: "nft binary not available in this environment" };
  const tmp = path.join(
    os.tmpdir(),
    `hipno-nft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.conf`
  );
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    const check = await run(nftBinary, ["-c", "-f", tmp], { timeoutMs: 10_000 });
    if (!check.ok) {
      return { applied: false, error: `nft syntax check failed: ${check.stderr.trim().slice(0, 400)}` };
    }
    const apply = await run(nftBinary, ["-f", tmp], { timeoutMs: 15_000 });
    if (!apply.ok) {
      return { applied: false, error: `nft apply failed: ${apply.stderr.trim().slice(0, 400)}` };
    }
    return { applied: true };
  } catch (e) {
    return { applied: false, error: `failed to apply ruleset: ${(e as Error).message}` };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ---------------------------------------------------------------- state

export async function getPendingConfirm(): Promise<PendingConfirm | null> {
  const raw = await getInternalSetting(FIREWALL_PENDING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingConfirm;
    if (
      parsed &&
      typeof parsed.deadline === "number" &&
      typeof parsed.appliedAt === "string" &&
      parsed.deadline > Date.now()
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setPendingConfirm(p: PendingConfirm): Promise<void> {
  await setInternalSetting(FIREWALL_PENDING_KEY, JSON.stringify(p));
}

export async function clearPendingConfirm(): Promise<void> {
  await clearInternalSetting(FIREWALL_PENDING_KEY);
}

export async function getRollbackRules(): Promise<string | null> {
  const raw = await getInternalSetting(FIREWALL_ROLLBACK_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as string;
  } catch {
    return null;
  }
}

export async function setRollbackRules(text: string): Promise<void> {
  await setInternalSetting(FIREWALL_ROLLBACK_KEY, JSON.stringify(text));
}

export async function clearRollbackRules(): Promise<void> {
  await clearInternalSetting(FIREWALL_ROLLBACK_KEY);
}

export async function getLastAppliedRules(): Promise<string | null> {
  const raw = await getInternalSetting(FIREWALL_LAST_APPLIED_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as string;
  } catch {
    return null;
  }
}

export async function setLastAppliedRules(text: string): Promise<void> {
  await setInternalSetting(FIREWALL_LAST_APPLIED_KEY, JSON.stringify(text));
}

export async function getFirewallState(): Promise<{
  nftAvailable: boolean;
  pendingConfirm: PendingConfirm | null;
}> {
  const nftAvailable = await binaryExists("nft");
  const pendingConfirm = await getPendingConfirm();
  return { nftAvailable, pendingConfirm };
}

// ---------------------------------------------------------------- validation

export interface RuleInput {
  action: "allow" | "deny";
  protocol: "tcp" | "udp" | "both";
  portStart: number;
  portEnd: number;
  source: string;
  note: string | null;
}

/** Validate a firewall rule payload; returns the normalized value or an error. */
export function validateRuleInput(
  body: Record<string, unknown>
): { ok: true; value: RuleInput } | { ok: false; error: string } {
  const action = body.action;
  if (action !== "allow" && action !== "deny") {
    return { ok: false, error: "Action must be allow or deny" };
  }
  const protocol = body.protocol;
  if (protocol !== "tcp" && protocol !== "udp" && protocol !== "both") {
    return { ok: false, error: "Protocol must be tcp, udp or both" };
  }
  const portStart = Number(body.portStart);
  const portEnd = Number(body.portEnd);
  if (!isValidPort(portStart) || !isValidPort(portEnd)) {
    return { ok: false, error: "Ports must be between 1 and 65535" };
  }
  if (portStart > portEnd) {
    return { ok: false, error: "Port start must not exceed port end" };
  }
  const source = String(body.source ?? "any").trim();
  if (source !== "any" && !isValidCidr(source)) {
    return { ok: false, error: "Source must be 'any' or a valid IPv4 CIDR (e.g. 203.0.113.0/24)" };
  }
  const noteRaw = body.note === undefined || body.note === null ? "" : String(body.note);
  const note = noteRaw.trim() === "" ? null : noteRaw.trim().slice(0, 200);
  return {
    ok: true,
    value: { action, protocol, portStart, portEnd, source: source === "any" ? "any" : source, note },
  };
}

/**
 * Safety check (spec §5.8): would any enabled deny rule with source 'any'
 * block one of the given protected TCP ports? Returns the offending rule.
 */
export function findBlockingRule(
  rules: FirewallRule[],
  protectedPorts: number[]
): FirewallRule | null {
  for (const r of rules) {
    if (!r.enabled || r.action !== "deny") continue;
    if (r.source !== "any") continue;
    if (r.protocol !== "tcp" && r.protocol !== "both") continue;
    for (const port of protectedPorts) {
      if (port >= r.portStart && port <= r.portEnd) return r;
    }
  }
  return null;
}
