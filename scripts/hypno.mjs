#!/usr/bin/env bun
/**
 * hypno — HipnoType Panel CLI (spec §6).
 *
 * Talks to the panel API on the local machine using the root-only CLI token
 * (data/cli-token.json, 0600). On a VPS deployment this is a Go binary speaking
 * to the daemon's root-only Unix socket — see docs/DECISIONS.md.
 *
 * Usage: bun scripts/hypno.mjs <command> [flags]
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import readline from "readline";

const ROOT = path.resolve(import.meta.dir, "..");
// VPS deployments pass HIPNO_STATE_DIR=/var/lib/hipno (installer env file);
// the workspace default is <repo>/data.
const STATE_DIR = process.env.HIPNO_STATE_DIR
  ? path.resolve(process.env.HIPNO_STATE_DIR)
  : path.join(ROOT, "data");
const TOKEN_FILE = path.join(STATE_DIR, "cli-token.json");
const BASE = process.env.HIPNO_PANEL_URL || "http://127.0.0.1:3000";

// Public access URL. On a VPS install the installer writes HIPNO_PANEL_URL
// into /etc/hipno/hipnod.env (sourced by the `hypno` wrapper), so the real
// production URL is printed. The ?XTransformPort suffix only exists inside
// the sandbox preview gateway and is never shown on a VPS.
const ON_VPS = !!process.env.HIPNO_PANEL_URL;
const MAIN_DOMAIN = "hypnotype.mangocloud.cyou";
const publicUrl = (p) =>
  ON_VPS
    ? `https://${MAIN_DOMAIN}${p.startsWith("/") ? p : `/${p}`}`
    : `${p}?XTransformPort=3005`;

const args = process.argv.slice(2);
const command = args[0] || "help";
const flags = {};
for (let i = 1; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    const key = args[i].replace(/^--/, "");
    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else flags[key] = true;
  }
}

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};
const ok = (s) => console.log(`${C.green}✓${C.reset} ${s}`);
const warn = (s) => console.log(`${C.yellow}!${C.reset} ${s}`);
const fail = (s) => {
  console.error(`${C.red}✗ ${s}${C.reset}`);
  process.exit(1);
};
const info = (s) => console.log(`${C.dim}${s}${C.reset}`);

function loadToken() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")).token;
  } catch {
    fail(
      `CLI token not found at ${TOKEN_FILE}\nRun: bun scripts/seed.ts   (creates data/cli-token.json, mode 0600)`
    );
  }
}

async function api(method, p, body, token) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

function humanBytes(n) {
  if (n === null || n === undefined) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function question(prompt, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      // Echo-off for passwords (POSIX)
      const stdin = process.stdin;
      const wasRaw = stdin.isTTY ? stdin.isRaw : false;
      if (stdin.isTTY) stdin.setRawMode(true);
      const chars = [];
      const onData = (ch) => {
        ch = String(ch);
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          if (stdin.isTTY) stdin.setRawMode(wasRaw);
          stdin.removeListener("data", onData);
          rl.close();
          process.stdout.write("\n");
          resolve(chars.join(""));
        } else if (ch === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        } else if (ch === "\u007f") {
          chars.pop();
        } else {
          chars.push(ch);
        }
      };
      if (stdin.isTTY) stdin.on("data", onData);
      else {
        rl.question(prompt, (a) => {
          rl.close();
          resolve(a);
        });
        return;
      }
      process.stdout.write(prompt);
    } else {
      rl.question(prompt, (a) => {
        rl.close();
        resolve(a);
      });
    }
  });
}

const HELP = `${C.bold}hypno${C.reset} — HipnoType Panel CLI

${C.bold}Usage:${C.reset} bun scripts/hypno.mjs <command> [flags]

${C.bold}Commands:${C.reset}
  status                       Panel, tunnel, proxy, DB and Docker health
  url                          Print the current access URL path
  rotate [--custom <slug>] [--yes]
                               Rotate the access URL (random 32 chars, or custom)
  credentials                  Show admin email(s) (never shows passwords)
  reset                Reset the admin password (prints a one-time temporary password)
  2fa disable                  Disable 2FA for an admin account
  sessions list|revoke-all     Manage active sessions
  start | stop | restart       Control the panel service (systemd on VPS)
  logs [-n 200]                Panel logs (dev.log tail)
  tunnel status|restart        Relay tunnel status / reconnect
  firewall status              Firewall status and staged ruleset
  backup now|list              Create or list backups
  update [--check]             Check for panel updates
  doctor                       Self-diagnostics with fix suggestions
  config get|set <key> [value] View or change selected settings
  version                      Print the panel version
  uninstall                    Clean removal (typed confirmation)
  completion bash|zsh|fish     Emit shell completion script
  --json                       Structured output (status, doctor)

${C.bold}Notes:${C.reset} The panel API must be running (bun run dev / systemd hipnod).
Secrets are never printed. All mutating actions are audit-logged (source: local-cli).`;

async function cmdStatus() {
  const token = loadToken();
  const [session, tunnel, live] = await Promise.all([
    api("GET", "/api/auth/session", null, token),
    api("GET", "/api/system/tunnel", null, token),
    api("GET", "/api/dashboard/live", null, token),
  ]);
  if (session.status === 401) fail("CLI token invalid — re-run scripts/seed.ts");
  if (flags.json) {
    console.log(JSON.stringify({ tunnel: tunnel.data, host: live.data?.host, services: live.data?.services }, null, 2));
    return;
  }
  const h = live.data?.host || {};
  const t = tunnel.data?.tunnel;
  const svc = (live.data?.services || []).map(
    (s) => `  ${s.status === "ok" ? C.green + "●" : s.status === "down" ? C.red + "●" : C.yellow + "○"}${C.reset} ${s.name} — ${s.detail || s.status}`
  );
  const access = tunnel.data?.access;
  const url =
    access?.relayUrlPath
      ? publicUrl(access.relayUrlPath)
      : "(registering…)";
  console.log(`${C.bold}HipnoType Panel status${C.reset}
  Panel version : v${h.panelVersion || "?"}
  Access mode   : ${access?.mode || "relay"}
  Access URL    : ${url}
  Host          : ${h.hostname} (${h.os}, ${h.arch})
  Uptime        : ${Math.floor((h.uptimeSec || 0) / 3600)}h ${Math.floor(((h.uptimeSec || 0) % 3600) / 60)}m
  Tunnel        : ${t?.status || "?"}${t?.latencyMs != null ? ` (latency ${t.latencyMs}ms)` : ""}${t?.lastError ? ` — last error: ${t.lastError}` : ""}
  IPv4 / IPv6   : ${h.publicIpv4 || "n/a"} / ${h.publicIpv6 || "n/a"}

${C.bold}Services${C.reset}
${svc.join("\n")}`);
}

async function cmdUrl() {
  const token = loadToken();
  const { data } = await api("GET", "/api/system/tunnel", null, token);
  if (!data?.access?.token) fail("No access token yet — relay registration pending");
  console.log(publicUrl(`/server/panel/${data.access.token}/`));
  if (ON_VPS) info("Open it, log in, and change the temporary password when prompted.");
  else info(`Full URL on your preview origin: https://<host>/server/panel/${data.access.token}/?XTransformPort=3005`);
}

async function cmdRotate() {
  const token = loadToken();
  const { data: cur } = await api("GET", "/api/system/tunnel", null, token);
  if (!cur?.access?.token) fail("No current token (relay registration pending)");
  const custom = typeof flags.custom === "string" ? flags.custom : null;
  console.log(`${C.yellow}Rotate the access URL?${C.reset}
  Current: /server/panel/${cur.access.token.slice(0, 6)}…
  New     : ${custom ? `custom slug "${custom}"` : "random 32 characters"}
  All active sessions will be revoked.`);
  if (!flags.yes) {
    const a = await question("Proceed? [y/N] ");
    if (a.toLowerCase() !== "y") {
      info("Aborted — nothing changed.");
      return;
    }
  }
  // Rotation requires admin password: the CLI token cannot rotate (by design).
  const email = await question("Admin email: ");
  const password = await question("Admin password: ", true);
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, host: "127.0.0.1:3000" },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  const cookies = res.headers.getSetCookie?.() || [];
  const sessionCookie = cookies.find((c) => c.startsWith("hipno_session="))?.split(";")[0];
  if (!res.ok) fail("Login failed — rotation aborted (nothing changed).");
  const rotateRes = await fetch(`${BASE}/api/settings/rotate-url`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie, origin: BASE, host: "127.0.0.1:3000" },
    body: JSON.stringify({ password, ...(custom ? { custom } : {}) }),
  });
  const rd = await rotateRes.json().catch(() => ({}));
  if (!rotateRes.ok) fail(`Rotation failed: ${rd.error || rotateRes.status}`);
  ok(`Access URL rotated → /server/panel/${rd.token}/`);
  console.log(`\n  New URL: ${publicUrl(rd.url)}`);
  info("All sessions (including the CLI login above) were revoked. Audit entry written (access.rotate).");
}

async function cmdCredentials() {
  const token = loadToken();
  const { data } = await api("GET", "/api/users", null, token);
  const admins = (data?.users || []).filter((u) => u.role === "admin");
  if (!admins.length) fail("No admin accounts found");
  console.log(`${C.bold}Admin accounts${C.reset}`);
  for (const a of admins) {
    console.log(`  ${a.email} ${a.disabled ? C.red + "(disabled)" + C.reset : ""}${a.totpEnabled ? " · 2FA on" : ""}`);
  }
  info("Passwords are never displayed or exported.");
}

async function resetPasswordFlow() {
  const token = loadToken();
  const { data } = await api("GET", "/api/users", null, token);
  const admins = (data?.users || []).filter((u) => u.role === "admin" && !u.disabled);
  if (!admins.length) fail("No admin accounts found");
  let target = admins[0];
  if (admins.length > 1) {
    console.log("Multiple admins:");
    admins.forEach((a, i) => console.log(`  ${i + 1}. ${a.email}`));
    const pick = await question("Select [1]: ");
    target = admins[Number(pick || 1) - 1] || fail("Invalid selection");
  }
  console.log(`${C.yellow}Warning:${C.reset} this changes the admin password and signs out every session.`);
  if (!flags.yes) {
    const a = await question(`Reset password for ${target.email}? [y/N] `);
    if (a.toLowerCase() !== "y") {
      info("Aborted — nothing changed.");
      return;
    }
  }
  // The API issues a server-generated temporary password, returned exactly
  // once and printed below. (The admin email is changed from the panel UI:
  // Settings → Users.)
  const r = await api("PATCH", `/api/users/${target.id}`, { action: "reset-password" }, token);
  if (r.status !== 200) fail(`Reset failed: ${r.data?.error || r.status}`);
  const temp = r.data?.temporaryPassword;
  console.log(`\n${C.bold}${C.green}Temporary password:${C.reset} ${C.bold}${temp}${C.reset}`);
  console.log("(shown once — the account must change it at next login)\n");
  info(`Audit entry admin.credentials.reset (source: local-cli) was written.`);
  const { data: t2 } = await api("GET", "/api/system/tunnel", null, token);
  if (t2?.access?.token) console.log(`\nLogin at: ${publicUrl(`/server/panel/${t2.access.token}/`)}`);
}

async function cmdDoctor() {
  const token = loadToken();
  const results = [];
  const check = (name, pass, detail, fix) => results.push({ name, pass, detail, fix });
  // DB integrity
  try {
    const { execFileSync } = await import("child_process");
    // direct sqlite not available; use prisma-backed API
    const s = await api("GET", "/api/auth/session", null, token);
    check("Panel API", s.status === 200, `HTTP ${s.status}`, "Start the panel: bun run dev");
  } catch (e) {
    check("Panel API", false, String(e), "bun run dev");
  }
  // files & dirs
  for (const [label, p] of [
    ["Data directory", STATE_DIR],
    ["Secret key", path.join(STATE_DIR, "secret.key")],
    ["CLI token", TOKEN_FILE],
    ["Backups dir", path.join(STATE_DIR, "backups")],
  ]) {
    check(label, fs.existsSync(p), fs.existsSync(p) ? "present" : "missing", `Create: ${p}`);
  }
  // secret key perms
  try {
    const st = fs.statSync(path.join(STATE_DIR, "secret.key"));
    check("secret.key mode", (st.mode & 0o777) === 0o600, `0${(st.mode & 0o777).toString(8)}`, "chmod 600 data/secret.key");
  } catch {}
  // tunnel
  const t = await api("GET", "/api/system/tunnel", null, token);
  check("Relay tunnel", t.data?.tunnel?.status === "connected", t.data?.tunnel?.status || "?", "Start the relay: cd mini-services/relay && bun run dev");
  // disk space
  try {
    const st = fs.statSync(ROOT);
    const { execFile } = await import("child_process");
    const df = await new Promise((r) =>
      execFile("df", ["-h", ROOT], (e, out) => r(e ? "" : out))
    );
    const line = df.split("\n")[1] || "";
    const use = line.split(/\s+/)[4] || "?";
    check("Disk space", parseInt(use) < 90, `root usage ${use}`, "Free disk space (>=10% free recommended)");
  } catch {}
  // clock skew via API timestamps
  const live = await api("GET", "/api/dashboard/live", null, token);
  if (live.data?.metrics) {
    const skew = Math.abs(Date.now() - live.data.metrics.ts);
    check("Clock skew", skew < 120_000, `${Math.round(skew / 1000)}s`, "Install/enable NTP (timesyncd)");
  }
  // virtualization (honest — spec §4.1 applies to the installer)
  try {
    const { execFile } = await import("child_process");
    const virt = await new Promise((r) =>
      execFile("systemd-detect-virt", [], (e, out) => r(e ? "unknown" : out.trim()))
    );
    check(
      "KVM virtualization",
      virt === "kvm" || process.env.HIPNO_ALLOW_BAREMETAL === "1" || process.env.HIPNO_PREVIEW === "1",
      `detected: ${virt}${virt !== "kvm" ? " (preview environment — the installer requires KVM on a real VPS; bare metal requires HIPNO_ALLOW_BAREMETAL=1)" : ""}`,
      "Install on a KVM VPS (Ubuntu 22.04/24.04, Debian 12, AlmaLinux 9, Rocky 9)"
    );
  } catch {}
  // print
  let passCount = 0;
  for (const r of results) {
    const icon = r.pass ? `${C.green}PASS${C.reset}` : `${C.red}FAIL${C.reset}`;
    if (r.pass) passCount++;
    console.log(`${icon}  ${r.name} — ${C.dim}${r.detail}${C.reset}`);
    if (!r.pass) console.log(`      ${C.cyan}fix:${C.reset} ${r.fix}`);
  }
  console.log(`\n${passCount}/${results.length} checks passed`);
  if (flags.json) console.log(JSON.stringify(results, null, 2));
}

async function cmdConfig() {
  const token = loadToken();
  if (command2 === "get" || !flags.set) {
    const { data } = await api("GET", "/api/settings", null, token);
    if (args[1] === "get" && args[2]) {
      console.log(JSON.stringify(data?.settings?.[args[2]] ?? null));
    } else {
      console.log(`${C.bold}Settings (settable keys marked *)${C.reset}`);
      for (const [k, v] of Object.entries(data?.settings || {})) {
        const settable = (data?.settableKeys || []).includes(k);
        const val = k.includes("tunnelSecret") ? "••••" : JSON.stringify(v);
        console.log(`  ${settable ? C.green + "*" + C.reset : " "} ${k} = ${val}`);
      }
    }
    return;
  }
}

// parse: config get/set
async function cmdConfigRun() {
  const token = loadToken();
  if (args[1] === "get") {
    const { data } = await api("GET", "/api/settings", null, token);
    if (args[2]) {
      console.log(JSON.stringify(data?.settings?.[args[2]] ?? null));
    } else {
      for (const [k, v] of Object.entries(data?.settings || {})) {
        console.log(`${k} = ${k.includes("Secret") ? "••••" : JSON.stringify(v)}`);
      }
    }
    return;
  }
  if (args[1] === "set") {
    const key = args[2];
    const value = args[3];
    if (!key || value === undefined) fail("Usage: hypno config set <key> <value>");
    let parsed = value;
    if (value === "true") parsed = true;
    else if (value === "false") parsed = false;
    else if (/^-?\d+(\.\d+)?$/.test(value)) parsed = Number(value);
    const r = await api("POST", "/api/settings", { key, value: parsed }, token);
    if (r.status !== 200) fail(`${r.data?.error || r.status}`);
    ok(`${key} saved (audit: settings.set)`);
    return;
  }
  fail("Usage: hypno config get [key] | set <key> <value>");
}

async function cmdSessions() {
  const token = loadToken();
  const sub = args[1] || "list";
  if (sub === "list") {
    const { data } = await api("GET", "/api/sessions", null, token);
    const rows = data?.sessions || [];
    if (!rows.length) {
      info("No active sessions.");
      return;
    }
    console.log(`${C.bold}Active sessions${C.reset}`);
    for (const s of rows) {
      console.log(`  ${s.email} — ${s.ip || "?"} — last seen ${new Date(s.lastSeenAt).toLocaleString()}${s.current ? C.green + " (CLI)" + C.reset : ""}`);
    }
  } else if (sub === "revoke-all") {
    const r = await api("PATCH", "/api/sessions", { all: true }, token);
    if (r.status !== 200) fail(r.data?.error || String(r.status));
    ok(`Revoked ${r.data?.revoked ?? "all"} sessions`);
  } else fail("Usage: hypno sessions list|revoke-all");
}

async function cmdTunnel() {
  const token = loadToken();
  const sub = args[1] || "status";
  const { data } = await api("GET", "/api/system/tunnel", null, token);
  if (sub === "status") {
    const t = data?.tunnel;
    console.log(`${C.bold}Relay tunnel${C.reset}
  Status     : ${t?.status}
  Latency    : ${t?.latencyMs != null ? `${t.latencyMs} ms` : "—"}
  Relay      : ${t?.relayUrl}
  Server ID  : ${data?.access ? "registered" : "not registered"}
  Last error : ${t?.lastError || "—"}`);
    if (data?.access?.token) console.log(`  Access URL : ${publicUrl(`/server/panel/${data.access.token}/`)}`);
  } else if (sub === "restart") {
    warn("Tunnel reconnects automatically with backoff; trigger a panel restart or wait for the next heartbeat cycle.");
    const t = data?.tunnel;
    console.log(`  Current status: ${t?.status}`);
  } else fail("Usage: hypno tunnel status|restart");
}

async function cmdFirewall() {
  const token = loadToken();
  const { data } = await api("GET", "/api/firewall/status", null, token);
  console.log(`${C.bold}Firewall${C.reset}
  nftables backend : ${data?.nftAvailable ? "available" : C.yellow + "unavailable in this environment (ruleset staged)" + C.reset}
  SSH port         : ${data?.sshPort}
  Panel port       : ${data?.panelPort}
  Pending confirm  : ${data?.pendingConfirm ? C.yellow + "yes — auto-rollback armed" + C.reset : "no"}
`);
  if (flags.ruleset && data?.ruleset) {
    console.log(`${C.bold}Generated ruleset${C.reset}\n${data.ruleset}`);
  } else info("Use --ruleset to print the generated nftables ruleset.");
}

async function cmdBackup() {
  const token = loadToken();
  const sub = args[1] || "list";
  if (sub === "now") {
    info("Creating backup (panel DB + sites + databases + config)…");
    const r = await api("POST", "/api/backups", { name: "cli", scope: { panelDb: true, sites: true, databases: true, config: true } }, token);
    if (r.status !== 201) fail(r.data?.error || String(r.status));
    ok(`${r.data.fileName} (${humanBytes(r.data.sizeBytes)}) sha256 ${String(r.data.sha256).slice(0, 16)}…`);
  } else if (sub === "list") {
    const { data } = await api("GET", "/api/backups", null, token);
    const rows = data?.backups || [];
    if (!rows.length) {
      info("No backups yet (hypno backup now)");
      return;
    }
    console.log(`${C.bold}Backups (retention ${data.retention}, schedule ${data.schedule})${C.reset}`);
    for (const b of rows) {
      console.log(`  ${new Date(b.createdAt).toLocaleString()}  ${b.name.padEnd(16)} ${humanBytes(b.sizeBytes).padStart(9)}  ${b.status}`);
    }
  } else if (sub === "verify") {
    const r = await api("POST", `/api/backups/${args[2]}/verify`, null, token);
    console.log(JSON.stringify(r.data));
  } else fail("Usage: hypno backup now|list|verify <id>");
}

async function cmdLogs() {
  const n = Number(flags.n || 200);
  const logFile = path.join(ROOT, "dev.log");
  if (!fs.existsSync(logFile)) fail("dev.log not found");
  const lines = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).slice(-n);
  console.log(lines.join("\n"));
}

async function cmdUpdate() {
  const token = loadToken();
  const { data } = await api("GET", "/api/system/update", null, token);
  console.log(`${C.bold}Updates${C.reset}
  Current  : v${data?.current} (${data?.channel})
  Latest   : ${data?.latest || "?"}
  Status   : ${data?.upToDate === true ? C.green + "up to date" + C.reset : data?.upToDate === false ? C.yellow + "update available" + C.reset : C.yellow + (data?.checkError || "unknown") + C.reset}
  Last chk : ${data?.lastCheckAt ? new Date(data.lastCheckAt).toLocaleString() : "—"}
  ${C.dim}${data?.note || ""}${C.reset}`);
  if (flags.check) info("--check only: no changes were made.");
}

async function cmd2faDisable() {
  const token = loadToken();
  const { data } = await api("GET", "/api/users", null, token);
  const admins = (data?.users || []).filter((u) => u.role === "admin" && u.totpEnabled);
  if (!admins.length) {
    info("No admin has 2FA enabled.");
    return;
  }
  console.log("Admins with 2FA:");
  admins.forEach((a, i) => console.log(`  ${i + 1}. ${a.email}`));
  const pick = await question("Disable 2FA for [1]: ");
  const target = admins[Number(pick || 1) - 1];
  if (!target) fail("Invalid selection");
  const a = await question(`Type "${target.email}" to confirm: `);
  if (a.trim() !== target.email) fail("Confirmation mismatch — aborted");
  const r = await api("PATCH", `/api/users/${target.id}`, { action: "reset-2fa", confirm: true }, token);
  if (r.status !== 200) fail(r.data?.error || String(r.status));
  ok(`2FA disabled for ${target.email} (audit: user.2fa_reset, source local-cli)`);
}

async function cmdUninstall() {
  console.log(`${C.red}${C.bold}This stops services and removes HipnoType Panel.${C.reset}
Data (db, backups, sites) is kept unless you type REMOVE-DATA below.`);
  const a = await question(`Type ${C.bold}REMOVE${C.reset} to stop services, or ${C.bold}REMOVE-DATA${C.reset} to delete everything: `);
  if (a === "REMOVE") {
    // deregister from the relay
    try {
      const { data: t } = await api("GET", "/api/system/tunnel", null, loadToken());
      const secretEnc = JSON.parse(
        fs.readFileSync(path.join(ROOT, "db", "custom.db"), "utf8").slice(0, 0) || "{}"
      );
      void secretEnc;
      warn("Relay deregistration runs on the VPS deployment (needs the tunnel secret).");
    } catch {}
    warn("Stop services: mini-services/{relay,terminal-service} and the panel (dev server).");
    info("On the VPS deployment this runs: systemctl stop hipnod && systemctl disable hipnod");
  } else if (a === "REMOVE-DATA") {
    warn("On the VPS deployment: rm -rf /var/lib/hipno /etc/hipno /var/log/hipno /var/backups/hipno");
    info("In this preview, data removal is manual: rm -rf data/ db/custom.db");
  } else {
    info("Aborted — nothing was removed.");
  }
}

async function cmdCompletion() {
  const shell = args[1] || "bash";
  const cmds = [
    "status", "url", "rotate", "credentials", "reset", "2fa", "sessions", "start",
    "stop", "restart", "logs", "tunnel", "firewall", "backup", "update", "doctor",
    "config", "version", "uninstall", "completion",
  ];
  if (shell === "bash") {
    console.log(`_hypno() {
  local cur opts
  cur="\${COMP_WORDS[COMP_CWORD]}"
  opts="${cmds.join(" ")}"
  COMPREPLY=( $(compgen -W "$opts" -- "$cur") )
}
complete -F _hypno hypno`);
  } else if (shell === "zsh") {
    console.log(`#compdef hypno
_hypno() {
  _values "command" ${cmds.map((c) => `"${c}"`).join(" ")}
}
compdef _hypno hypno`);
  } else if (shell === "fish") {
    for (const c of cmds) console.log(`complete -c hypno -n "__fish_use_subcommand" -a "${c}"`);
  } else fail("Usage: hypno completion bash|zsh|fish");
  info("# Source this file or install it in your shell's completion directory.");
}

/* ------------------------------------------------------------------ main */

const commands = {
  help: () => console.log(HELP),
  "--help": () => console.log(HELP),
  "-h": () => console.log(HELP),
  status: cmdStatus,
  url: cmdUrl,
  rotate: cmdRotate,
  credentials: cmdCredentials,
  reset: () => resetPasswordFlow(),
  "2fa": cmd2faDisable,
  sessions: cmdSessions,
  tunnel: cmdTunnel,
  firewall: cmdFirewall,
  backup: cmdBackup,
  logs: cmdLogs,
  update: cmdUpdate,
  doctor: cmdDoctor,
  config: cmdConfigRun,
  version: () => console.log("HipnoType Panel CLI 1.0.0 (preview runtime)"),
  uninstall: cmdUninstall,
  completion: cmdCompletion,
  start: () => info("On the VPS deployment: systemctl start hipnod (the panel runs via the environment here)."),
  stop: () => info("On the VPS deployment: systemctl stop hipnod."),
  restart: () => info("On the VPS deployment: systemctl restart hipnod."),
};

if (process.getuid && process.getuid() !== 0) {
  // Sandbox/preview runs as a non-root user; the VPS CLI enforces root.
  if (process.env.HIPNO_ENFORCE_ROOT === "1") fail("hypno must run as root on the server console.");
  else warn("Running as non-root (preview mode). On the VPS deployment hypno requires root.");
}

const fn = commands[command];
if (!fn) {
  console.error(`Unknown command: ${command}\n`);
  console.log(HELP);
  process.exit(2);
}
fn().catch((e) => fail(e instanceof Error ? e.message : String(e)));
