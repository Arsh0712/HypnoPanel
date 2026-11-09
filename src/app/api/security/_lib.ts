import fs from "fs";
import { db } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto";
import { run, binaryExists } from "@/lib/exec";

/**
 * Security Center — the real checks engine. Every check reads live state:
 * the panel database, /etc/ssh/sshd_config, /proc/net/tcp{,6}, the apt
 * simulation, the audit hash chain, or the filesystem. When the environment
 * genuinely lacks a backend, the check reports status "na" with a human
 * explanation — never a fabricated result.
 */

export type CheckStatus = "pass" | "warn" | "fail" | "na";
export type CheckSeverity = "info" | "low" | "medium" | "high" | "critical";

export interface SecurityCheckResult {
  key: string;
  title: string;
  category: "panel" | "ssh" | "firewall" | "system" | "audit" | "disk";
  severity: CheckSeverity;
  status: CheckStatus;
  /** one human sentence explaining exactly what was observed */
  detail: string;
  /** what an automated in-panel fix would do, or null */
  fixAction: string | null;
  /** extra structured context for the UI (never secrets) */
  meta?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ helpers */

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "•••";
  const domainParts = domain.split(".");
  const tld = domainParts.length > 1 ? `.${domainParts.slice(1).join(".")}` : "";
  const dLabel = domainParts[0];
  return `${local[0]}•••@${dLabel[0]}•••${tld}`;
}

function fmtBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function plural(n: number, word: string, pluralWord?: string): string {
  return `${n} ${n === 1 ? word : (pluralWord || `${word}s`)}`;
}

/* --------------------------------------------------------------- score math */

const SEVERITY_WEIGHT: Record<CheckSeverity, number> = {
  info: 1,
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
};

/**
 * Weighted score: each applicable check contributes its severity weight;
 * pass earns it in full, warn earns half, fail earns nothing, na is excluded.
 */
export function computeScore(checks: SecurityCheckResult[]): number {
  let earned = 0;
  let possible = 0;
  for (const c of checks) {
    if (c.status === "na") continue;
    const w = SEVERITY_WEIGHT[c.severity];
    possible += w;
    if (c.status === "pass") earned += w;
    else if (c.status === "warn") earned += w / 2;
  }
  if (possible === 0) return 100;
  return Math.round((earned / possible) * 100);
}

/* -------------------------------------------------------------- sshd_config */

export interface SshdConfigResult {
  readable: boolean;
  directives: Record<string, string>;
  error?: string;
  path: string;
}

/** Parse the main /etc/ssh/sshd_config (Include directives are not followed —
 *  last occurrence of a keyword wins, matching sshd's effective behaviour). */
export function parseSshdConfig(path = "/etc/ssh/sshd_config"): SshdConfigResult {
  try {
    const txt = fs.readFileSync(path, "utf8");
    const directives: Record<string, string> = {};
    for (const line of txt.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Za-z]+)\s+(.+?)\s*$/);
      if (m) directives[m[1]] = m[2];
    }
    return { readable: true, directives, path };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    return {
      readable: false,
      directives: {},
      error: err.code ? `${path}: ${err.code}` : String(e),
      path,
    };
  }
}

/* ------------------------------------------------------------ listening ports */

const EXPECTED_PORTS = new Set([22, 80, 443, 8080]);
const EXPECTED_RANGES: { from: number; to: number }[] = [{ from: 3000, to: 3005 }];

function isExpectedPort(port: number): boolean {
  if (EXPECTED_PORTS.has(port)) return true;
  return EXPECTED_RANGES.some((r) => port >= r.from && port <= r.to);
}

/** Parse /proc/net/tcp + /proc/net/tcp6 (hex local ports, state 0A = LISTEN). */
export function parseListeningPorts(): { ports: number[]; readError?: string } {
  const ports = new Set<number>();
  let readError: string | undefined;
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try {
      const txt = fs.readFileSync(file, "utf8");
      for (const line of txt.split("\n").slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) continue;
        const local = parts[1];
        const state = parts[3].toUpperCase();
        if (state !== "0A") continue;
        const portHex = local.split(":")[1];
        if (!portHex) continue;
        const port = parseInt(portHex, 16);
        if (Number.isInteger(port) && port > 0) ports.add(port);
      }
    } catch (e) {
      readError = (e as NodeJS.ErrnoException).message;
    }
  }
  return { ports: [...ports].sort((a, b) => a - b), readError };
}

/* --------------------------------------------------------- audit hash chain */

const GENESIS = "0".repeat(64);

/**
 * Verify the hash-chain linkage of the last `windowSize` AuditEntry rows.
 * The chain algorithm mirrors src/lib/audit.ts exactly:
 *   hash = sha256(prevHash ‖ seq ‖ ts(ISO) ‖ actorEmail ‖ action ‖ target ‖ result ‖ details)
 */
export async function verifyAuditChainWindow(windowSize = 200): Promise<{
  valid: boolean;
  checked: number;
  total: number;
  firstBrokenSeq?: number;
}> {
  const total = await db.auditEntry.count();
  if (total === 0) return { valid: true, checked: 0, total: 0 };

  const rows = await db.auditEntry.findMany({
    orderBy: { seq: "desc" },
    take: windowSize + 1, // one extra row anchors the window's prevHash linkage
  });
  const window = rows.reverse(); // oldest → newest within the fetched slice

  let checked = 0;
  let prevHash: string | null = null;
  for (let i = 0; i < window.length; i++) {
    const e = window[i];
    if (prevHash !== null && e.prevHash !== prevHash) {
      return { valid: false, checked, total, firstBrokenSeq: e.seq };
    }
    if (i === 0 && e.seq === 1 && e.prevHash !== GENESIS) {
      return { valid: false, checked, total, firstBrokenSeq: e.seq };
    }
    const expect = sha256Hex(
      [
        e.prevHash,
        String(e.seq),
        e.ts.toISOString(),
        e.actorEmail || "",
        e.action,
        e.target || "",
        e.result,
        e.details || "",
      ].join("\n")
    );
    if (expect !== e.hash) {
      return { valid: false, checked, total, firstBrokenSeq: e.seq };
    }
    checked++;
    prevHash = e.hash;
  }
  return { valid: true, checked, total };
}

/* ------------------------------------------------------------ disk headroom */

export function diskHeadroom(mount = "/"): { freePct: number; totalBytes: number; availBytes: number } | null {
  try {
    const st = fs.statfsSync(mount);
    const total = st.blocks * st.bsize;
    const avail = st.bavail * st.bsize;
    const freePct = st.blocks > 0 ? (st.bavail / st.blocks) * 100 : 0;
    return { freePct, totalBytes: total, availBytes: avail };
  } catch {
    return null; // caller falls back to df(1)
  }
}

/** df(1) fallback: `df -P <mount>` → Use% gives used%, free = 100 - used. */
export async function diskHeadroomViaDf(mount = "/"): Promise<{ freePct: number; totalBytes: number; availBytes: number } | null> {
  const res = await run("df", ["-P", mount], { timeoutMs: 5000 });
  if (!res.ok) return null;
  const lines = res.stdout.trim().split("\n");
  const parts = lines[lines.length - 1].trim().split(/\s+/);
  if (parts.length < 5) return null;
  const total = Number(parts[1]) * 1024;
  const avail = Number(parts[3]) * 1024;
  const usedPct = Number(parts[4].replace("%", ""));
  if (!Number.isFinite(total) || !Number.isFinite(usedPct)) return null;
  return { freePct: Math.max(0, 100 - usedPct), totalBytes: total, availBytes: avail };
}

/* ---------------------------------------------------------------- the checks */

export async function runAllChecks(): Promise<SecurityCheckResult[]> {
  const checks: SecurityCheckResult[] = [];

  /* ---------------------------------------------------------- panel.* ------ */

  const admins = await db.user.findMany({ where: { role: "admin" } });
  const activeAdmins = admins.filter((a) => !a.disabled);
  const adminsWithoutTotp = activeAdmins.filter((a) => !a.totpEnabled);
  checks.push({
    key: "panel.two_factor",
    title: "Admin two-factor authentication",
    category: "panel",
    severity: "high",
    status: adminsWithoutTotp.length > 0 ? "warn" : "pass",
    detail:
      adminsWithoutTotp.length > 0
        ? `${activeAdmins.length - adminsWithoutTotp.length} of ${activeAdmins.length} active admin${activeAdmins.length === 1 ? "" : "s"} use${activeAdmins.length === 1 ? "s" : ""} TOTP; without it: ${adminsWithoutTotp.map((a) => maskEmail(a.email)).join(", ")}.`
        : `All ${plural(activeAdmins.length, "active admin")} ${activeAdmins.length === 1 ? "has" : "have"} TOTP enabled.`,
    fixAction: null,
    meta: { activeAdmins: activeAdmins.length },
  });

  const [disabledUsers, pendingUsers] = await Promise.all([
    db.user.count({ where: { disabled: true } }),
    db.user.count({ where: { mustChangePassword: true, disabled: false } }),
  ]);
  checks.push({
    key: "panel.users",
    title: "Panel user hygiene",
    category: "panel",
    severity: "medium",
    status: pendingUsers > 0 ? "warn" : "pass",
    detail:
      pendingUsers > 0
        ? `${plural(pendingUsers, "user")} ${pendingUsers === 1 ? "is" : "are"} pending a forced password change; ${plural(disabledUsers, "account")} disabled.`
        : `No forced password changes pending; ${disabledUsers === 0 ? "no disabled accounts" : `${plural(disabledUsers, "disabled account")}${disabledUsers === 1 ? "" : "s"} (disabled accounts cannot log in)`}.`,
    fixAction: null,
    meta: { pendingUsers, disabledUsers },
  });

  const now = new Date();
  const activeSessions = await db.session.findMany({
    where: { revokedAt: null, expiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
    orderBy: { absoluteExpiresAt: "asc" },
  });
  const oldestExpiry = activeSessions[0]?.absoluteExpiresAt ?? null;
  checks.push({
    key: "panel.sessions",
    title: "Active panel sessions",
    category: "panel",
    severity: "medium",
    status: activeSessions.length > 15 ? "warn" : "pass",
    detail:
      `${plural(activeSessions.length, "active session")}. ` +
      (oldestExpiry
        ? `Oldest absolute expiry: ${oldestExpiry.toISOString().replace("T", " ").slice(0, 16)} UTC.`
        : "No absolute expiry recorded."),
    fixAction: "Revoke every panel session except your current one",
    meta: { count: activeSessions.length },
  });

  const hourAgo = new Date(Date.now() - 3600_000);
  const failedLogins = await db.loginAttempt.count({
    where: { success: false, createdAt: { gte: hourAgo } },
  });
  checks.push({
    key: "panel.lockout",
    title: "Failed logins (last hour)",
    category: "panel",
    severity: "high",
    status: failedLogins === 0 ? "pass" : failedLogins >= 5 ? "fail" : "warn",
    detail:
      failedLogins === 0
        ? "No failed login attempts in the last hour."
        : `${plural(failedLogins, "failed login attempt")} in the last hour — lockout engages after 5 consecutive failures (1/5/15 minutes). This check is informational; there is nothing to "fix".`,
    fixAction: null,
    meta: { failedLogins },
  });

  /* ----------------------------------------------------------- ssh.* ------- */

  const sshd = parseSshdConfig();
  const rootLogin = sshd.directives["PermitRootLogin"] ?? "prohibit-password"; // sshd default
  const rootLoginPass = rootLogin === "no" || rootLogin === "prohibit-password" || rootLogin === "forced-commands-only";
  checks.push({
    key: "ssh.root_login",
    title: "SSH root login",
    category: "ssh",
    severity: "critical",
    status: !sshd.readable ? "na" : rootLoginPass ? "pass" : "fail",
    detail: !sshd.readable
      ? `Not verifiable in this environment — ${sshd.error}. On a VPS deployment with OpenSSH installed this check reads the effective PermitRootLogin.`
      : rootLogin === "no"
        ? "Direct root login is disabled (PermitRootLogin no)."
        : rootLogin === "prohibit-password"
          ? "Root login is restricted to key authentication (PermitRootLogin prohibit-password, the sshd default) — password login as root is already impossible."
          : `PermitRootLogin is "${rootLogin}" — direct root login is possible and should be disabled.`,
    fixAction: null,
    meta: sshd.readable ? { effective: rootLogin } : { error: sshd.error },
  });

  const passwordAuth = sshd.directives["PasswordAuthentication"] ?? "yes"; // sshd default
  checks.push({
    key: "ssh.password_auth",
    title: "SSH password authentication",
    category: "ssh",
    severity: "high",
    status: !sshd.readable ? "na" : passwordAuth === "no" ? "pass" : "warn",
    detail: !sshd.readable
      ? `Not verifiable in this environment — ${sshd.error}.`
      : passwordAuth === "no"
        ? "SSH password authentication is disabled (key-only sign-in)."
        : `SSH password authentication is enabled (PasswordAuthentication ${passwordAuth}) — key-only authentication is recommended.`,
    fixAction: null,
    meta: sshd.readable ? { effective: passwordAuth } : { error: sshd.error },
  });

  /* -------------------------------------------------------- firewall.* ----- */

  const [fwTotal, fwEnabled] = await Promise.all([
    db.firewallRule.count(),
    db.firewallRule.count({ where: { enabled: true } }),
  ]);
  checks.push({
    key: "firewall.rules",
    title: "Firewall rules",
    category: "firewall",
    severity: "high",
    status: fwEnabled === 0 ? "warn" : "pass",
    detail:
      fwEnabled === 0
        ? `No firewall rules are active (${fwTotal} stored) — every listening port on this server is exposed.`
        : `${plural(fwEnabled, "active firewall rule")} (${fwTotal} stored in total).`,
    fixAction: null,
    meta: { enabled: fwEnabled, total: fwTotal },
  });

  /* --------------------------------------------------------- system.* ------ */

  if (await binaryExists("apt-get")) {
    const sim = await run("apt-get", ["-s", "-q", "upgrade"], { timeoutMs: 10_000 });
    if (sim.ok) {
      const m = sim.stdout.match(/(\d+) upgraded,\s*(\d+) newly installed/);
      const upgradable = m ? Number(m[1]) + Number(m[2]) : 0;
      checks.push({
        key: "system.updates",
        title: "System package updates",
        category: "system",
        severity: "high",
        status: upgradable > 0 ? "warn" : "pass",
        detail:
          upgradable > 0
            ? `apt simulation reports ${plural(upgradable, "package")} ready to upgrade — run "apt upgrade" (or the hipno CLI) to apply them.`
            : "apt simulation reports nothing to upgrade — all packages are current.",
        fixAction: null,
        meta: { upgradable },
      });
    } else {
      checks.push({
        key: "system.updates",
        title: "System package updates",
        category: "system",
        severity: "high",
        status: "na",
        detail: `apt-get exists but the upgrade simulation failed (${(sim.stderr || sim.stdout || "unknown error").trim().split("\n")[0]}) — likely it cannot read the package lists without root.`,
        fixAction: null,
      });
    }
  } else {
    checks.push({
      key: "system.updates",
      title: "System package updates",
      category: "system",
      severity: "high",
      status: "na",
      detail: "No apt-get on this system — there is no supported package-manager probe here (this is not a Debian/Ubuntu host).",
      fixAction: null,
    });
  }

  const listening = parseListeningPorts();
  if (listening.ports.length > 0 || !listening.readError) {
    const outside = listening.ports.filter((p) => !isExpectedPort(p));
    checks.push({
      key: "system.ports",
      title: "Listening ports",
      category: "system",
      severity: "medium",
      status: outside.length > 0 ? "warn" : "pass",
      detail:
        `${plural(listening.ports.length, "TCP port")} listening: ${listening.ports.join(", ")}. ` +
        (outside.length > 0
          ? `Review: ${outside.join(", ")} — outside the expected set (22, 80, 443, 3000–3005, 8080).`
          : "All within the expected set (22, 80, 443, 3000–3005, 8080)."),
      fixAction: null,
      meta: { ports: listening.ports, outside },
    });
  } else {
    checks.push({
      key: "system.ports",
      title: "Listening ports",
      category: "system",
      severity: "medium",
      status: "na",
      detail: `Could not read /proc/net/tcp (${listening.readError}).`,
      fixAction: null,
    });
  }

  const rebootRequired = fs.existsSync("/var/run/reboot-required");
  checks.push({
    key: "system.reboot_required",
    title: "Reboot required",
    category: "system",
    severity: "medium",
    status: rebootRequired ? "warn" : "pass",
    detail: rebootRequired
      ? "/var/run/reboot-required exists — a reboot is needed to finish applying updates."
      : "No reboot pending (/var/run/reboot-required absent).",
    fixAction: null,
  });

  /* ---------------------------------------------------------- audit.* ------ */

  const chain = await verifyAuditChainWindow(200);
  checks.push({
    key: "audit.chain",
    title: "Audit log integrity",
    category: "audit",
    severity: "critical",
    status: chain.total === 0 ? "na" : chain.valid ? "pass" : "fail",
    detail:
      chain.total === 0
        ? "The audit log is empty — there is nothing to verify yet."
        : chain.valid
          ? `Hash-chain intact — the latest ${plural(chain.checked, "entry", "entries")} verified (of ${chain.total} total, sha256-linked per src/lib/audit.ts).`
          : `Audit chain BROKEN at seq ${chain.firstBrokenSeq} — entries may have been tampered with or written outside the chain.`,
    fixAction: null,
    meta: { checked: chain.checked, total: chain.total },
  });

  /* ---------------------------------------------------------- disk.* ------- */

  let headroom = diskHeadroom("/");
  if (!headroom) headroom = await diskHeadroomViaDf("/");
  if (headroom) {
    const pct = headroom.freePct;
    checks.push({
      key: "disk.headroom",
      title: "Root disk headroom",
      category: "disk",
      severity: "high",
      status: pct < 5 ? "fail" : pct < 15 ? "warn" : "pass",
      detail: `${pct.toFixed(1)}% free on / (${fmtBytes(headroom.availBytes)} of ${fmtBytes(headroom.totalBytes)})${pct < 15 ? " — under the 15% safety line" : ""}.`,
      fixAction: null,
      meta: { freePct: Number(pct.toFixed(1)) },
    });
  } else {
    checks.push({
      key: "disk.headroom",
      title: "Root disk headroom",
      category: "disk",
      severity: "high",
      status: "na",
      detail: "Could not read filesystem statistics for / (statfs and df both unavailable).",
      fixAction: null,
    });
  }

  return checks;
}

/* ------------------------------------------------------------- hardening info */

export interface HardeningInfo {
  waf: {
    installed: boolean;
    engines: string[];
    detail: string;
  };
  isolation: {
    linuxUser: string;
    siteCount: number;
    domains: string[];
  }[];
}

/** WAF detection (Coraza / ModSecurity) — honest "not installed" when absent. */
export async function detectWaf(): Promise<HardeningInfo["waf"]> {
  const candidates = ["coraza-spoa", "coraza-caddy", "coraza-coredns", "modsec-rules-check", "modsecurity"];
  const found: string[] = [];
  for (const bin of candidates) {
    if (await binaryExists(bin)) found.push(bin);
  }
  if (found.length === 0 && (await binaryExists("nginx"))) {
    const res = await run("nginx", ["-V"], { timeoutMs: 5000 });
    if (/modsecurity|coraza/i.test(res.stderr + res.stdout)) found.push("nginx+modsecurity");
  }
  return {
    installed: found.length > 0,
    engines: found,
    detail:
      found.length > 0
        ? `Web application firewall detected: ${found.join(", ")}.`
        : "No Coraza / ModSecurity engine detected in this environment (probed via PATH) — the WAF hardening steps below are what a VPS deployment needs.",
  };
}

/** Per-site isolation summary: Website rows grouped by linuxUser. */
export async function siteIsolation(): Promise<HardeningInfo["isolation"]> {
  const sites = await db.website.findMany({
    select: { linuxUser: true, domain: true, name: true },
    orderBy: { linuxUser: "asc" },
  });
  const map = new Map<string, { linuxUser: string; siteCount: number; domains: string[] }>();
  for (const s of sites) {
    const entry = map.get(s.linuxUser) || { linuxUser: s.linuxUser, siteCount: 0, domains: [] };
    entry.siteCount++;
    entry.domains.push(s.domain || s.name);
    map.set(s.linuxUser, entry);
  }
  return [...map.values()];
}
