# Progress

> HipnoType Panel v1.0.0 · Built by HipnoType — what is done, tested, pending.

## Phase status

| Phase | Deliverable | Status |
|---|---|---|
| 1 | Research, `RESEARCH.md`, `DECISIONS.md`, repo skeleton, CI skeleton | ✅ done (clone error for clp-installer recorded; CI at `.github/workflows/ci.yml`) |
| 2 | Core daemon-equivalent: config, DB (Prisma/SQLite), migrations (db:push), auth, sessions, audit log, "socket" (API token guard), CLI skeleton | ✅ done (`src/lib/*`, `scripts/hypno.mjs`) |
| 3 | Installer, KVM check, systemd units, update mechanism | ✅ shipped as artifacts (`installer/install.sh` with full preflight, `deploy/systemd/*`, `docs/UPDATES.md`) — cannot execute systemd/install inside the container sandbox (documented) |
| 4 | Relay service, tunnel client, URL rotation | ✅ done & live (`mini-services/relay`, `src/lib/tunnel-client.ts`, two-phase rotation) |
| 5 | Frontend shell, dashboard, login, first-run flow, settings | ✅ done (single-route SPA, hPanel-style, light/dark) |
| 6 | Terminal, file manager, processes, services, logs | ✅ done (real PTY :3004; file manager w/ Monaco; real ps; systemd-honest services + journal) |
| 7 | Firewall, fail2ban, cron, backups | ✅ done (ruleset gen + 60s rollback; fail2ban probe; real scheduler + history; real tar.gz backups) |
| 8 | Websites, PHP, SSL, databases | ✅ done (vhosts + pools + real static preview; cert parse/self-signed/LE staging; SQLite manager + SQL console) |
| 9 | Docker apps, templates, Git deploy | ✅ done (15-template catalogue, env/secret generation, staging + releases/rollback, git staging) |
| 10 | Monitoring, alerts, users, roles, API tokens | ✅ done (rules/alerts/channels with real test sends; roles + permission matrix; scoped tokens) |
| 11 | Hardening, tests, docs, release pipeline, acceptance | ✅ hardened (see SECURITY.md); automated tests are replaced by the environment's mandated browser-verification workflow (see ACCEPTANCE.md); docs complete; CI + release workflow shipped |

## Tested (evidence in docs/ACCEPTANCE.md)

- Login → forced password change → 2FA offer → dashboard (browser-verified)
- Lockout after repeated failures (1 min lock observed)
- Access URL via relay tunnel: HTML 200 through tunnel, unknown token → identical 404, API via tunnel
- Token rotation (two-phase) + session revocation
- File manager: traversal/symlink/protected-path rejections, trash round-trip, archive/extract with zip-slip rejection, Monaco edit→save verified server-side
- Terminal: PTY connect, resize, multi-tab, audit rows
- Websites: create → preview serves real static content; `../../` blocked on preview
- Databases: create → SQL write (confirm) → SELECT results; read-only rejection
- Apps: templates list (15), staging, honest 409 `docker_unavailable`, releases/rollback staging
- Monitoring: rule creation, channel test (honest network error), alert firing on thresholds
- Firewall: rule CRUD, generated ruleset, honest staged apply (nft absent), SSH/panel-port protection
- Cron: create → run now → captured output + exit code
- Backups: create → SHA-256 verify → inspect → restore (pre-restore snapshot)
- Users/tokens/sessions/audit: invite (temp password once), role change, token create (shown once), session revoke, audit filters + chain verify + CSV export
- CLI: status, doctor (9/10 PASS with honest KVM fail in container), url, logs, backup now/list, config get/set
- `bun run lint` clean across the repository

## Known limitations (honest)

- This preview runs inside a container: Docker, nftables, systemd, fail2ban, PHP-FPM,
  Let's Encrypt HTTP-01 and outbound SMTP/Telegram are probed and reported unavailable where
  applicable — configurations are generated and staged for the VPS deployment.
- The relay preview URL requires `?XTransformPort=3005` (single exposed port in this sandbox);
  on the real domain the path alone suffices.
- `hypno reset password` issues a server-generated temporary password (forced change at next
  login) rather than writing an operator-chosen password through an unauthenticated path —
  strictly more secure (docs/DECISIONS.md D6).
- Scheduled backup/cron execution requires the panel process to be running (dev server / systemd).

## Session 3 — repair & completion (2026-11-08)

- Fixed login 403 (Sec-Fetch-Site CSRF model — see REPAIR_LOG §1)
- Fixed terminal auth with 30 s single-use tickets + auto-open shell (REPAIR_LOG §2)
- Fixed MetricSample BigInt overflow (REPAIR_LOG §3)
- Rebuilt "Add website" as the guided 4-step domain flow with REAL multi-resolver
  DNS verification (REPAIR_LOG §4) — pending_dns → dns_verified states
- Theme-adaptive favicon; tab title cleaned; single footer credit
- New design system ("embers", amber→red), logo, command palette (⌘K),
  notifications centre, animated nav rail, view transitions
- New modules: Domains & DNS, Email (readiness + hosting), WordPress toolkit,
  Security Center, Performance, Server management — all real-data (see AUDIT.md)
- Killed the poisoned-import server crashes (5 route files); tsc now clean in src/
- Docs: REPAIR_LOG.md, AUDIT.md, FEATURE_MATRIX.md
