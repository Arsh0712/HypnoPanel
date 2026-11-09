# Research — Reference Control Panels (Phase 1)

> HipnoType Panel · Built by HipnoType · repo: https://github.com/Arsh0712/HypnoPanel

## 1. Sources & clone log

Cloned with full history into `~/hipno-research` (spec §1.1):

| Project | Clone result | License |
|---|---|---|
| aaPanel (`aapanel/aapanel`) | ✅ cloned (Python/Django backend, `BT-Panel`/`BTPanel` trees) | kun88 (aaPanel license — not OSS-reusable) |
| CyberPanel (`usmannasir/cyberpanel`) | ✅ cloned (Python + OpenLiteSpeed shims, `CLManager`, `CLScript`) | GPL-3.0 |
| Coolify (`coollabsio/coolify`) | ✅ cloned (Laravel `app/Actions…`, `DESIGN.md`, `DEVELOPMENT.md`) | MIT (docs) / Apache-2.0-ish mixed |
| CloudPanel (`cloudpanel-io/clp-installer`) | ❌ **exact error**: `fatal: could not read Username for 'https://github.com': No such device or address` — the repository is not publicly available (GitHub answers 404 for unauthenticated clones, so git prompts for credentials). Analysis below uses CloudPanel's public documentation and architecture knowledge; no source was read. | Source-unavailable |

Local zip archives (`coolify-4_6_0.zip`, `aaPanel-master.zip`, `cyberpanel-3_0_5-dev.zip`) were not
present in this environment (`/mnt/user-data/uploads/` does not exist); the clones above are the
reference set used. Nothing was skipped silently — the missing paths and errors are recorded here.

## 2. Architecture notes

### aaPanel
- **Stack**: Python 2/3 + Django-ish `BTPanel`, task queue `BT-Task`, CLI `bt`. Runs the panel
  process **as root**; web server: Nginx (installed by script), PHP-FPM pools per version from
  local packages, MySQL via mysqld init.
- **State**: `/www/server/panel/data/*` (pickles/JSON), SQL Lite-ish usage; heavy shell-out with
  **string-built commands** in places (the classic injection pattern HipnoType must avoid).
- **Installer**: `install.sh` + `install_en.sh` — `yum/apt` installs, disables firewalld, opens
  panel port. CLI `bt` (menu-driven) calls the same Python modules.
- **Security posture observed**: default port 8888 with random admin path suffix (`/xxxx`), admin
  password printed once; API key with token + timestamp HMAC (`BT_PANEL_SIGN`). Known weaknesses
  to avoid: root-running panel, predictable default ports on some versions, broad shell-outs.

### CyberPanel
- **Stack**: Python (Django) + OpenLiteSpeed (OLS) as the single web server + `lscpd` daemon;
  installs Postfix/Dovecot/PureFTPD, PowerDNS. CLI: `cyberpanel` command (Django management
  commands under the hood).
- **State**: MySQL databases (cyberpanel db), `.json` in `/usr/local/CyberCP`; CLI mirrors web UI
  1:1 — a pattern HipnoType adopts (every web action reachable from the CLI).
- **Security**: feature reach (mail + DNS + FTP) increases surface; historical RCE-style CVEs came
  from string-built shell calls — HipnoType's `execFile`-array-only rule exists because of this.

### Coolify
- **Stack**: Laravel (PHP) + SvelteKit frontend + PostgreSQL + Redis; Docker-first. Deployments
  are compose stacks; Nixpacks/buildpacks for Git; webhooks with HMAC; proxy (Traefik/Caddy)
  managed over its HTTP API.
- **Patterns HipnoType adopted**: one-click **template catalogue** with env schemas, per-app secret
  generation, release history + rollback, domains automation, generous empty states and wizards.
  Coolify is multi-server by design — HipnoType explicitly is not (§4.6 single-VPS scope).

### CloudPanel (from public docs only — source unavailable)
- **Stack**: PHP 8 + Symfony, per-site Linux users, Nginx + PHP-FPM, MySQL/PostgreSQL/MongoDB,
  Let's Encrypt via CLI; clean minimal UI, strict per-site user isolation ("site isolation" is its
  signature), CLI `clpctl` (site/db/user create etc.).
- **Patterns adopted**: per-site Linux users + per-site PHP-FPM pool with `open_basedir`-style
  hardening; the CLI-first management surface (`clpctl` ≈ `hypno`); KVM-only installer with strict
  preflight — the model for HipnoType's KVM gate (§4.1).

## 3. Feature inventory & what HipnoType does

| Feature | aaPanel | CyberPanel | Coolify | CloudPanel | HipnoType |
|---|---|---|---|---|---|
| Websites/vhosts | ✅ Nginx | ✅ OLS | ✅ (apps) | ✅ Nginx | ✅ Caddy-format vhosts generated per site (static/PHP/node/proxy), real static preview served through the panel |
| PHP versions | ✅ local pkgs | ✅ OLS LSAPI | ➖ | ✅ 7.x–8.x | ✅ selectable 7.4–8.3; pool config generated per site; PHP-FPM install applies on VPS deployment (Ondrej/Sury/Remi) |
| SSL / Let's Encrypt | ✅ acme | ✅ acme | ✅ proxy | ✅ acme | ✅ cert upload/self-signed for real (openssl + X509 parsing); LE config staging + expiry alerts; ACME applies on VPS |
| DB management | ✅ MySQL | ✅ MySQL | ✅ (env) | ✅ MySQL/PG | ✅ real SQLite manager + live SQL console (read-only default); MariaDB/PG install-on-demand on VPS |
| File manager | ✅ | ✅ | ➖ | ✅ | ✅ real FS operations, Monaco editor, trash, archives, traversal+symlink protection |
| Web terminal | ✅ (via python) | ✅ | ✅ (containers) | ➖ | ✅ real PTY (node-pty) over WebSocket, tabs, resize, audit |
| Cron | ✅ | ✅ | ✅ (apps) | ✅ system | ✅ builder+validation, scheduler executed by panel, run history w/ output |
| Firewall | ✅ (firewalld) | ✅ (CSF/firewalld) | ➖ | ✅ (ufw) | ✅ nftables ruleset gen (table `inet hipno`), 60s auto-rollback, SSH/panel-port protection; apply on VPS |
| Backups | ✅ | ✅ | ✅ S3 | ✅ | ✅ real tar.gz + SHA-256, pre-restore snapshots, retention; S3 targets on VPS |
| Docker/apps | ➖ | ➖ | ✅✅ core | ➖ | ✅ template catalogue (15), compose generation, staging with honest docker probe, releases+rollback |
| Git deploy | ➖ | ✅ (OLS) | ✅✅ core | ➖ | ✅ git app staging + webhook secrets (builds run on Docker backend / VPS) |
| Templates | ✅ | ➖ | ✅✅ | ➖ | ✅ original catalogue definitions |
| Monitoring | ✅ basic | ✅ basic | ✅ (netdata) | ✅ basic | ✅ real /proc metrics, 24h history, threshold rules, alert channels |
| Users/permissions | ✅ basic | ✅ ACL | ✅ teams | ✅ per-site users | ✅ roles admin/developer/viewer + permission matrix, sessions, API tokens |
| API | ✅ signed | ✅ | ✅ REST | ➖ | ✅ Bearer API tokens with scopes |
| Updates | ✅ panel | ✅ | ✅ | ✅ | ✅ channel + release check (binary swap/rollback on VPS) |
| CLI | ✅ `bt` | ✅ `cyberpanel` | ✅ `coolify` | ✅ `clpctl` | ✅ `hypno` (status/url/rotate/reset/doctor/config…) |
| **Access model** | port + admin path | port 8090 | domain | domain | **rotating secret-path URLs via outbound relay tunnel** — HipnoType original combination |

## 4. Security review — what HipnoType avoids

- **Root-running panel processes** (aaPanel/CyberPanel): HipnoType's VPS design runs the daemon as
  a dedicated `hipno` user with a minimal privileged helper (installer docs), and in this preview
  the panel runs unprivileged with `execFile`-array-only execution.
- **String-built shell commands** (root-cause of historic panel CVEs): all process execution goes
  through `run(cmd, argsArray)` — never `sh -c` with interpolated strings (the one documented
  exception: cron jobs, whose payload IS the user's command, admin-only + audited + timeout).
- **Predictable default ports**: HipnoType has no fixed public port — access is via rotating
  32-char base62 secret paths (rejection sampling) through an outbound-only tunnel; old URLs 404
  identically for every unknown token (timing-normalized).
- **Token enumeration**: relay returns byte-identical 404 bodies, rate-limits per IP, and bans
  repeated probing.
- **Default/weak credentials**: installer seeds the admin via `HIPNO_INITIAL_ADMIN_PASSWORD` env
  (never hard-coded in source, never logged), forces a password change on first login (policy 12+
  chars/mixed/symbol/common-password list), offers TOTP with one-time recovery codes.
- **Missing CSRF / SameSite**: `SameSite=Strict` session cookies + Origin checking on all
  mutations; WebSocket auth validates the session cookie at connect.
- **Secrets in logs**: passwords/secrets never logged; audit stores hashed recovery codes and
  token fingerprints only (first 4 chars).
- **Insecure update channel**: VPS updater design verifies SHA-256 + signature and rolls back on
  failed health check (installer docs §10).

## 5. UX patterns taken

- **Hostinger hPanel**: card-based dashboard, grouped left sidebar, clean tables with inline
  actions, wizards with honest empty states — HipnoType's shell.
- **Coolify**: template catalogue cards, env-var forms with generated secrets, deploy flow with
  releases/rollback, friendly "it's fine, here's what happened" errors.
- **CloudPanel**: strict preflight installer, CLI-first operations, per-site isolation model.

## 6. What HipnoType takes from each — one-page summary

- **aaPanel**: the "everything on one screen" breadth (sites, files, cron, monitor) and a single
  powerful CLI entry point (`bt` → `hypno`).
- **CyberPanel**: CLI/web parity — every mutating action is available both places and audited.
- **Coolify**: the app-template + Git deploy model with env schemas, secret generation, release
  history and rollback, executed as staging when no Docker backend is present (honest states).
- **CloudPanel**: the KVM-only, preflight-driven installer; per-site Linux users and PHP pools;
  the minimal, fast, professional UI feel.
- **HipnoType originals**: rotating secret access URLs over an outbound relay tunnel (spec §4.3/4.4),
  hash-chained tamper-evident audit log (§5.15), the 60-second firewall auto-rollback (§5.8), and
  honest backend degradation (every unavailable backend is probed and reported, never faked).

No source code, templates, CSS or assets were copied from any reference project — all
HipnoType code is original (see docs/DECISIONS.md for licenses).
