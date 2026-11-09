# Security Guide — HipnoType Panel

> Spec §7 implementation notes. Threat model for the relay: docs/RELAY.md §6.

## Identity & credentials
- **Argon2id** (64 MiB · t=3 · p=2 · 16-byte salt) — PHC string includes parameters (`src/lib/auth/password.ts`).
- Initial admin supplied via `HIPNO_INITIAL_ADMIN_EMAIL/PASSWORD` env **only by the installer**;
  consumed once at first initialisation, never written to the source repo, never logged.
- First login forces a password change (≥12 chars, upper+lower+digit+symbol, common-password
  and email-local-part checks with a bundled list) before any other page is reachable.
- TOTP 2FA (RFC 6238) with QR enrolment; 10 single-use recovery codes stored **hashed**
  (SHA-256); disable requires password + valid TOTP.
- API tokens: shown once, stored SHA-256 hashed, scoped (`*` or per-permission), expiring,
  last-used tracking. CLI token lives in a 0600 root file (the preview equivalent of the
  VPS root-only Unix socket).

## Sessions & CSRF
- DB-backed sessions; cookie `hipno_session`: `HttpOnly`, `SameSite=Strict`, `Secure` on HTTPS,
  `Path=/`. Sliding idle timeout (default 30 min) + absolute cap (12 h), both configurable.
- All mutating requests verify `Origin` against `Host` (same-origin) — enforced centrally in
  the API guard; relay-tunnel requests (server-to-server) rely on the 32-char token secret.
- Rotation and destructive settings changes require password re-auth (+ TOTP when enabled).

## Brute force
- Per-account **and** per-IP lockout: 5 failures → 1 → 5 → 15 minutes (escalating).
- Generic "Invalid email or password" errors (no user enumeration); every attempt audited.

## Command & process execution
- `execFile` with **argument arrays only** (`src/lib/exec.ts`) — never shell strings.
- The single documented exception is cron commands (the job payload itself): admin/developer
  permission, audited, 120 s timeout, output captured. See docs/DECISIONS.md D10.
- All identifiers validated against strict regexes (`src/lib/validation.ts`) before reaching
  the OS or DB.

## Path safety (file manager)
- Allowed roots only (`/home/z/my-project`, `/tmp` in this environment), lexical `..` rejection,
  `realpath` resolution + re-check on every operation (symlink-escape protection), protected
  exact targets (`/`, `/home`, `/home/z`, project root, `.git`, `.env`, `db`, `src`,
  `node_modules`, `mini-services`, `secret.key`), protected subtrees for destructive ops.
- Archive extraction is list-first (`tar -tvf` / `unzip -Z`) — absolute paths, `..`, and
  symlink/hardlink entries are rejected before anything is written (zip-slip protection).

## Injection & web
- SQL: Prisma parameterised queries only; the SQL console is read-only by default (SELECT/PRAGMA
  allow-list) and write mode requires an explicit confirmed toggle.
- XSS: React escaping; no `dangerouslySetInnerHTML`; CSP recommended headers ship in the relay/
  proxy notes (strict CSP, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, `Permissions-Policy`).
- Open redirects: redirects in site configs are admin-authored; panel responses never redirect
  to user-supplied absolute URLs.
- SSRF: relay/webhook targets are operator-configured channels; monitoring test-sends are
  audited, admin-only, and reported honestly (the VPS deployment additionally blocks private
  ranges for user-supplied URLs — see docs/DECISIONS.md).
- WebSocket hijacking: the terminal service validates the panel session cookie at connect
  (server-side fetch to `/api/auth/session`) and requires admin/developer roles.

## Secrets at rest
- AES-256-GCM (key: `data/secret.key`, 0600 — `/etc/hipno/secret.key` on VPS) for TOTP secrets,
  private keys, SMTP passwords, app secrets, webhook tokens.
- Relay stores only hashes: sha256(token), sha256(tunnelSecret), sha256(nonce).

## Token & relay hardening
- Access tokens: 32-char base62 via **rejection sampling** (no modulo bias). Custom slugs:
  16–64 chars, `[A-Za-z0-9_-]`, entropy ≥ 3 bits/char, denylist + pattern checks, generic
  "unavailable" on collision (no enumeration).
- Unknown/rotated/revoked tokens → byte-identical 404 with normalized 35–60 ms delay.
- Per-IP rate limiting (60/min) + 10-minute bans after 20 unknown-token hits in 5 minutes.
- Two-phase rotation with rollback; rotation revokes every session; every rotation audited
  (first-4-char fingerprints only).

## Audit integrity
- Append-only entries: `sha256(prev ‖ seq ‖ ts ‖ actor ‖ action ‖ target ‖ result ‖ details)`
  genesis `00…0`; verifiable via API/UI/CLI (`hypno` → docs/CLI.md).

## Updates & supply chain
- Installer verifies SHA-256 checksums and minisign/cosign signatures; aborts on mismatch.
- Updater (VPS): staged binary, DB migration backup, atomic swap, health check, automatic
  rollback (docs/UPDATES.md).
- CI runs lint + boot smoke tests; dependency advisories via Dependabot config
  (`.github/dependabot.yml`) — `govulncheck`/`gosec` apply to the VPS Go pipeline.

## VPS-only hardening (installer-enforced)
- Daemon runs as the dedicated `hipno` user with systemd hardening (NoNewPrivileges,
  ProtectSystem=strict, ProtectHome, PrivateTmp, CapabilityBoundingSet); privileged operations
  go through the audited allow-listed `hipno-helper`.
