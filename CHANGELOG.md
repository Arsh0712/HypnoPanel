# Changelog

## v1.2.0 — 2026-11-08
Real Cloudflare DNS + honest apps. Built by HipnoType.
- Cloudflare tokens verified against the real API before storing (token check + zone lookup + write probe) — no more fake "linked"
- "From Cloudflare" import: pull existing records into the panel (merge/mirror, MX/SRV/proxied preserved)
- Bidirectional DNS: record create/edit/delete pushes to Cloudflare immediately; per-record sync state chips
- Public IP detection rebuilt interface-first + dual echo confirmation — the Add-site wizard shows the VPS's real IP
- Apps honesty pass: immediate deploy when Docker present, "configured — not deployed" + honest 409 when absent; no "staged" success
- App Logs tab (docker compose logs, auto-refresh) + container Console action; env edits redeploy for real
- Files: mtime conflict detection (409 file_conflict) with keep/reload/overwrite dialog + unsaved indicator
- Fixed apex record rendering ("@ = zone.name" instead of "@.zone") and per-view tab titles

## v1.1.0 — 2026-11-08
Public launch release. Built by HipnoType.
- Public website (hypnotype.mangocloud.cyou) on Vercel: marketing, install guide, docs with search, changelog, security
- /install.sh served from the website with SHA-256 checksum
- Full brand icon set + per-page titles + tab-title alert badge
- Installer rewritten for the real stack; relay base-path injection + WebSocket pass-through

## v1.0.0 — 2026-11-07
Initial release. Built by HipnoType.
- Rotating secret access URLs over the HipnoType Relay (outbound tunnel, two-phase rotation)
- Auth: Argon2id, forced first-login change, TOTP 2FA + recovery codes, lockout, session mgmt
- Modules: dashboard, websites (+SSL), apps (15 templates), databases (SQLite console), files,
  terminal (PTY), firewall (60s rollback), cron, backups, processes, services, monitoring,
  users/tokens, audit (hash chain), settings, updater check
- `hypno` CLI, installer with KVM preflight, relay deployment docs, CI + release workflow
