<div align="center">

# HipnoType Panel

**Single-VPS control panel · Built by HipnoType**

Websites · Apps · Databases · Files · Real web terminal · Firewall · Cron · Backups · Monitoring ·
Rotating secret access URLs over an outbound relay tunnel

`v1.0.0` · MIT · https://github.com/Arsh0712/HypnoPanel

</div>

---

HipnoType Panel manages **exactly one server — the one it is installed on** (spec §4.6). One
installation, one panel, no multi-server dashboards. It combines the hosting breadth of
CloudPanel/aaPanel/CyberPanel, the Docker-app model of Coolify, and the clean UX of Hostinger
hPanel — plus HipnoType originals:

- **Access URLs** (§4.3): every install gets `https://hypnotype.mangocloud.cyou/server/panel/<TOKEN>/`
  served through an **outbound-only** relay tunnel — works on IPv6-only, NAT-ed or
  zero-inbound-port VPSes. Rotating a token (§4.4) kills the old URL within seconds and revokes
  every session, two-phase (relay confirms → panel commits) with rollback.
- **Tamper-evident audit log** (§5.15): every sensitive action in a SHA-256 hash chain, verifiable
  from the UI and CLI.
- **Honest backends**: Docker, nftables, systemd, fail2ban are probed live. When a backend is
  absent (e.g. in a container preview), the module generates real production configuration and
  says so — nothing is faked, nothing silently "succeeds".

## Feature modules

| Module | What you get |
|---|---|
| Dashboard | Real CPU/RAM/swap/disk/net from `/proc`, per-core, 24h history (per-minute downsampled), service health, top processes, tunnel status |
| Websites | static / PHP (7.4–8.3) / Node / reverse-proxy sites, Caddy-format vhosts, redirects, basic-auth config, cache/gzip, real static preview through the panel, clone, per-site logs |
| SSL | custom certs (real X509 parsing + key-match check), self-signed via openssl, expiry alerts, Let's Encrypt staging |
| Databases | real SQLite manager + live SQL console (read-only default), export/import, MariaDB/PostgreSQL probes + install paths |
| Apps | 15-template catalogue (WordPress, Ghost, n8n, Uptime Kuma, Vaultwarden, Nextcloud, Gitea, PostgreSQL, MySQL, Redis, MinIO, Plausible, Metabase, Grafana, Adminer), env schemas, generated secrets, compose generation, releases + rollback, Git deploy staging, live Docker probe |
| Files | real filesystem manager: Monaco editor, upload/download, archives, chmod, trash, traversal + symlink-escape protection |
| Terminal | real PTY shell (node-pty) over WebSocket, tabs, resize, font size, idle timeout, audit |
| Firewall | nftables ruleset generation (`inet hipno`), rule editor, 60-second auto-rollback, SSH/panel-port protection, fail2ban status |
| Cron | schedule builder with live validation + next-runs preview, panel-executed scheduler, run history with output + exit codes |
| Backups | real tar.gz + SHA-256 integrity, pre-restore snapshots, retention, scheduled runs, inspect/verify/download |
| Processes / Services | real `ps` with kill/renice (honest permission errors), systemd units + journal (honest when systemd absent) |
| Monitoring | threshold rules on live metrics, alert history, silences, webhook/Telegram/Discord/SMTP channels with real test sends |
| Users & Tokens | admin/developer/viewer roles (docs/PERMISSIONS.md), sessions, 2FA (TOTP + recovery codes), scoped API tokens |
| Audit | hash-chained log, filters, CSV/JSON export, chain verification |
| Settings | access-URL rotation (password + TOTP gated), account, security timeouts, relay/direct mode, updates, backup policy, branding |

## Quick start (this repository)

```bash
bun install                 # dependencies
bun run db:push             # create the SQLite schema
bun scripts/seed.ts         # admin + settings + CLI token (idempotent)
bun run dev                 # panel on :3000
cd mini-services/relay && bun install && bun run dev &          # relay on :3005
cd mini-services/terminal-service && bun install && bun run dev &  # PTY terminal on :3004
```

Sign in with the credentials from your installer summary (first login forces a password change,
then offers 2FA). The **access URL** (Settings → Access URL) is
`/server/panel/<TOKEN>/?XTransformPort=3005` on your preview origin — the panel is fully usable
through the relay tunnel, exactly like `https://hypnotype.mangocloud.cyou/server/panel/<TOKEN>/`
on the real domain.

CLI on the server:

```bash
bun scripts/hypno.mjs status
bun scripts/hypno.mjs doctor
bun scripts/hypno.mjs rotate
bun scripts/hypno.mjs reset emailpass
```

See `docs/CLI.md` for the complete reference.

## Install on a VPS (KVM only)

```bash
curl -fsSL https://hypnotype.mangocloud.cyou/install.sh | sudo bash
```

The installer prints your panel URL — always on the main site's domain:
`https://hypnotype.mangocloud.cyou/server/panel/<32-char-token>/`. It pulls
the source from a GitHub release, the site mirror
(`/downloads/panel-source.tar.gz`, checksum-verified) or any tarball you
point it at:

```bash
# straight from this repository, no release needed:
curl -fsSL https://hypnotype.mangocloud.cyou/install.sh | sudo bash -s -- \
  --src https://github.com/Arsh0712/HypnoPanel/archive/refs/heads/main.tar.gz
```

## Releases & downloads

The release ships as two tarballs (plus the installer asset), rebuilt with
`bash scripts/make-release.sh`:

| File | Goes to |
|---|---|
| `HypnoPanel-v<version>.tar.gz` | this repository (panel + relay + installer + docs + `website/`) |
| `HypnoType-Site-v<version>.tar.gz` | Vercel — the standalone main site (app at the archive root, zero-config import) |
| `panel-source.tar.gz` | GitHub release asset — the exact source `install.sh` builds from, mirrored at `https://hypnotype.mangocloud.cyou/downloads/` |

Runbook: `docs/GO_LIVE.md` (Vercel → relay → panel VPS, DNS, env vars).

Requirements (enforced by preflight, §4.1): KVM virtualization (`systemd-detect-virt` = `kvm`),
Ubuntu 22.04/24.04 · Debian 12 · AlmaLinux 9 · Rocky 9, amd64/arm64, ≥1 GB RAM, ≥10 GB disk,
systemd as PID 1, nftables + cgroups v2 + overlayfs, free ports 80/443 (direct mode), outbound
DNS/HTTPS. Conflicting panels (aaPanel, CyberPanel, CloudPanel, cPanel, Plesk, Coolify) are
detected and refused. Flags: `--mode relay|direct --domain <d> --port <n> --no-docker
--version <tag> --yes --uninstall`. Full walkthrough: `docs/INSTALL.md` · installer source:
`installer/install.sh`.

## Deploying the relay (main domain)

See `docs/RELAY.md` — DNS, Caddy TLS on `hypnotype.mangocloud.cyou`, systemd unit
(`deploy/systemd/hipno-relay.service`), health endpoint `/healthz`, Prometheus metrics
`/metricsz`, store backups, upgrades.

## Security

Argon2id (64 MiB · t3 · p2) · TOTP 2FA + one-time recovery codes · lockout 5→1/5/15 min ·
SameSite=Strict cookies + Origin checks · CSRF-safe mutations · constant-time comparisons ·
AES-256-GCM secrets at rest (`data/secret.key`, 0600) · rate-limited relay with identical 404s ·
hash-chained audit · base62 rejection-sampling tokens · `execFile`-array-only process execution ·
strict input validation. Details: `docs/SECURITY.md` · reporting: `SECURITY.md`.

## Documentation

`docs/RESEARCH.md` (Phase-1 analysis of aaPanel/CyberPanel/Coolify/CloudPanel) ·
`docs/DECISIONS.md` · `docs/PROGRESS.md` · `docs/API.md` · `docs/PERMISSIONS.md` ·
`docs/CLI.md` · `docs/RELAY.md` · `docs/INSTALL.md` · `docs/UPDATES.md` ·
`docs/TROUBLESHOOTING.md` · `docs/ACCEPTANCE.md`.

## License

MIT © HipnoType. Original code; reference projects were used for architecture and feature
inspiration only (licenses in docs/RESEARCH.md, decisions in docs/DECISIONS.md).
