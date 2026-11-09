# Decisions Log

> HipnoType Panel · Built by HipnoType — every ambiguous call resolved to the *most secure and
> conventional option*, recorded here (spec §0.8).

## D1 — Runtime: Next.js full-stack in this environment (preview) vs Go daemon (VPS spec)

The master spec targets a Go 1.22 daemon (`hipnod`) with `chi` + SQLite and a React/Vite frontend
embedded via `go:embed`. **This repository is implemented inside a sandboxed Next.js 16
environment** where only a single `/` route is user-visible and one port is exposed through a
gateway. Decision: implement the **complete panel as a Next.js 16 + TypeScript + Prisma(SQLite)
full-stack application** with the same feature set, API surface and security model; the VPS
deployment story (Go daemon, systemd, installer, updater) is shipped as
`installer/install.sh`, `deploy/systemd/*` and docs. Rationale: the environment cannot compile or
run Go/systemd; shipping a working, honest product here outweighs shipping a non-runnable Go
tree. Recorded per rule §0.2/§0.4: nothing is mocked — everything either works for real or is
honestly reported as "requires the VPS deployment".

## D2 — Relay inside the sandbox (ports)

Spec §4.3 deploys the relay on `hypnotype.mangocloud.cyou`. In-sandbox the gateway exposes one
port; mini-services are reachable with `?XTransformPort=<port>`. Decision: the relay ships as a
**real mini-service on port 3005** (`mini-services/relay`) with registration, hashed stores,
tunnel multiplexing, identical-404 token routing, rate limiting, health + Prometheus metrics.
The panel connects out to it exactly as on a VPS (outbound-only). The user-facing access URL is
`https://<preview-origin>/server/panel/<TOKEN>/?XTransformPort=3005` — functionally identical to
`https://hypnotype.mangocloud.cyou/server/panel/<TOKEN>/` on the real domain.

## D3 — Sub-path correctness (§4.3)

Next.js in this environment serves at `/`; the spec demands the panel work under
`/server/panel/<TOKEN>/`. Decision: the panel frontend is **base-path aware at runtime** — the
relay injects `window.__HIPNO_BASE__`/`__HIPNO_PORT__` into proxied HTML, and every API call in
`src/lib/api.ts` prefixes the base and appends the gateway query parameter. Asset URLs resolve
against the origin root, which the gateway routes to the panel directly. This is the Next.js
equivalent of the spec's "inject the base path into index.html when serving".

## D4 — Password hashing: Argon2id via `@node-rs/argon2`

Spec parameters (64 MiB, t=3, p=2, 16-byte salt) implemented exactly, PHC string stored
(`src/lib/auth/password.ts`). No fallback to weaker KDFs.

## D5 — CLI: Node script talking to the panel API (preview) vs Unix-socket Go binary (VPS)

`scripts/hypno.mjs` implements the spec's command surface (status, url, rotate, credentials,
reset emailpass/password/email, 2fa disable, sessions, logs, tunnel, firewall, backup, update,
doctor, config, version, uninstall, completion). Authentication: a **root-only file
`data/cli-token.json` (0600)** holding an API token (`hpt_…`, SHA-256-hashed in the DB) — the
Next.js equivalent of the root-only Unix socket. Rotation and credential resets require an
interactive admin login (password prompts with echo-off) so the CLI token alone cannot perform
the most destructive identity changes. The VPS deployment uses the Unix-socket Go binary
(deploy/systemd + installer docs). Non-root execution warns and continues in preview
(`HIPNO_ENFORCE_ROOT=1` enforces).

## D6 — `hypno reset emailpass` behaviour

Implemented per spec §6.1: root/console usage, hidden password prompts (`--password-stdin` for
automation), policy enforcement, generic errors, audit entry `admin.credentials.reset`
(source `local-cli`), session revocation. One documented deviation: the reset issues a
**server-generated temporary password** (shown once, `must_change_password=true`) instead of
setting the operator's chosen password via an unauthenticated path — the chosen-password flow is
the interactive web flow (login with temp → forced change), which is strictly more secure than
an unauthenticated CLI password write. `--random` prints a generated temporary password once.

## D7 — Protected paths (file manager)

`/home` and `/home/z` are protected as **exact-match** targets (deleting them is impossible),
while the project data tree (`data/sites`, `data/databases`, uploads…) stays writable for real
site/app work. Infrastructure subtrees (`src`, `prisma`, `db`, `node_modules`, `mini-services`,
`.git`, `.env`, `secret.key`) are protected from destructive operations entirely (subtree rule).
See `src/lib/validation.ts`.

## D8 — Databases in this environment

MariaDB/PostgreSQL cannot be installed in the sandbox. The database module implements a **real
SQLite database manager** (create/list/delete/export/import + live SQL console, read-only by
default with explicit write confirmation) via `better-sqlite3`; MariaDB/PostgreSQL are probed
with real binary checks and reported honestly with their VPS install commands. SQL bodies are
never audit-logged (only statement type) to avoid leaking data into the audit chain.

## D9 — Docker, nftables, systemd, fail2ban, PHP-FPM, Let's Encrypt, SMTP

All probed live (`docker info`, `nft`, `/run/systemd/system`, `fail2ban-client`, `openssl`).
When absent, the modules generate **real production configuration** (compose files, nftables
rulesets, PHP-FPM pools, ACME snippets, SMTP channel configs) and display an explicit honest
banner: "backend unavailable in this environment — applies to the VPS deployment". No fake
success states anywhere.

## D10 — Cron execution model

The panel's own scheduler (30s tick, minute granularity) executes jobs via `bash -c <command>`
with a 120s timeout and captured output — the command string is the job payload by definition
(standard cron semantics), protected by: admin/developer permission only, audit logging of every
run/failure, and output truncation. This is the single documented `shell` execution path (spec
§7 allows validated identifiers; a cron command is not an identifier but the feature itself).

## D11 — Firewall safety (§5.8)

Rulesets are generated for `table inet hipno`; rules that would deny the SSH or panel port from
`any` are rejected server-side. Apply → 60-second pending window → explicit confirm or
automatic rollback (snapshot + restore + audit `firewall.auto_rollback`). Without `nft`, apply
is *staged* and does not enter the pending window (nothing was applied, so there is nothing to
roll back — an honest state rather than a fake countdown).

## D12 — Audit hash chain

`hash_n = sha256(prevHash ‖ seq ‖ ts ‖ actor ‖ action ‖ target ‖ result ‖ details)` with a
genesis of 64 zeros, verified end-to-end by `GET /api/audit/verify` and surfaced in the UI and
CLI. Details never contain secrets (recovery codes are hashed, tokens fingerprinted to 4 chars).

## D13 — Sessions & CSRF

DB-backed sessions, cookie `hipno_session` (HttpOnly, SameSite=Strict, Secure when the request is
HTTPS via `X-Forwarded-Proto`, Path=/), sliding idle 30 min (configurable), absolute 12 h. CSRF:
Origin/Host verification on all mutating requests + SameSite=Strict; requests arriving via the
relay tunnel (server-to-server) are identified by the `XTransformPort` gateway marker and rely on
the 32-char token as the CSRF secret (the relay path is not browser-originate-able without the
token). API tokens use `Authorization: Bearer` (no cookies → no CSRF surface).

## D14 — Licenses

Reference projects: aaPanel (non-OSS, ideas only), CyberPanel (GPL-3 — ideas only, no code),
Coolify (mixed MIT — ideas only), CloudPanel (source unavailable). HipnoType Panel is original
code under **MIT** (see LICENSE). Dependencies: MIT/Apache-2.0/ISC/MIT-0 (full list in About →
Licenses). No license conflicts; no code copied.

## D15 — Data locations (preview vs VPS)

Preview: `db/custom.db` (SQLite WAL), `data/` (sites, databases, backups, trash, secret.key,
cli-token.json). VPS deployment: `/etc/hipno`, `/var/lib/hipno`, `/var/log/hipno`,
`/var/backups/hipno` (installer/install.sh implements the mapping).

## D16 — Terminal audit (§5.2)

Start/end records with user, IP, duration; **command content is never recorded** by default; the
asciinema recording toggle exists in Settings and is audit-logged when changed.
