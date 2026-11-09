# API Reference

> HipnoType Panel v1.0.0 · all endpoints relative to the base path (direct: `/`; via relay:
> `/server/panel/<TOKEN>/`). Auth: session cookie `hipno_session` (browser) or
> `Authorization: Bearer hpt_…` (API token). Mutations are audit-logged. Errors:
> `{"error": "...", "code": "..."}` with meaningful HTTP status.

## Auth
| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | — | `{email,password,totp?,recoveryCode?}` → session cookie; lockout 5→1/5/15m; `totp_required` when 2FA enabled |
| POST | `/api/auth/logout` | session | revokes session |
| GET | `/api/auth/session` | session | current state (mustChangePassword, totpEnabled) |
| POST | `/api/auth/change-password` | session | `{currentPassword,newPassword,newEmail?}`; policy-enforced; revokes other sessions |
| POST | `/api/auth/2fa/setup` | session | → `{secret,uri,qr}` (QR data URL) |
| POST | `/api/auth/2fa/enable` | session | `{secret,token}` → recovery codes (once) |
| POST | `/api/auth/2fa/disable` | session | `{password,token}` |

## Dashboard / system
| Method | Path | Permission |
|---|---|---|
| GET | `/api/dashboard/live` | dashboard:read — metrics ring, host, services, top processes, tunnel, recent audit |
| GET | `/api/dashboard/history?hours=24` | dashboard:read — per-minute downsampled 24h |
| GET | `/api/dashboard/processes?limit=20` | processes:read |
| GET | `/api/system/info` | dashboard:read — host info (virt, IPs, kernel) |
| GET | `/api/system/tunnel` | settings:read — tunnel status + access info |
| GET | `/api/system/update` | settings:read — version + real GitHub release check |

## Files (`/api/files/…`)
`GET list?path=` (+`&search=`) · `GET/PUT file` · `POST ops` (`mkdir, touch, rename, move, copy,
delete→trash, restore, purge, purgeAll, chmod, du`) · `POST upload` (multipart, 25 MB) ·
`GET download?path=` / `?archive=1` · `POST archive` · `POST extract` (list-first zip-slip
protection) · `GET trash`. Permissions: `files:read` / `files:write`. All paths pass
realpath + roots + protected-path checks.

## Websites / SSL
`GET/POST /api/websites` · `PATCH /api/websites/[id]` (enable/disable/regenerate/settings) ·
`POST /api/websites/[id]/clone` · `DELETE /api/websites/[id]` · `GET /api/websites/[id]/logs` ·
`GET /api/websites/[id]/preview/[...path]` (public static preview).
`POST /api/ssl/upload` · `POST /api/ssl/self-signed` · `GET/DELETE /api/ssl`.

## Databases
`GET/POST /api/databases` · `DELETE /api/databases/[id]` ·
`POST /api/databases/[id]/query` `{sql,readOnly}` (read-only accepts SELECT/PRAGMA only) ·
`GET /api/databases/[id]/export` · `POST /api/databases/[id]/import` ·
`GET /api/databases/engines` (MariaDB/PG probes).

## Apps
`GET /api/apps/templates` (15) · `GET/POST /api/apps` · `GET /api/apps/[id]` (+live Docker probe) ·
`POST /api/apps/[id]/action` `{start|stop|restart|redeploy}` (Docker-gated, honest 409) ·
`POST /api/apps/[id]/deploy` · `POST /api/apps/[id]/rollback` `{releaseId}` ·
`GET /api/apps/[id]/secrets` (admin, audited) · `POST /api/apps/git` (Git deploy staging) ·
`DELETE /api/apps/[id]`.

## Monitoring
`GET/POST /api/monitoring/rules` · `PUT/PATCH/DELETE /api/monitoring/rules/[id]` ·
`GET /api/monitoring/alerts?state=` · `PATCH /api/monitoring/alerts/[id]` `{silence|unsilence|resolve}` ·
`GET/POST /api/monitoring/channels` · `DELETE /api/monitoring/channels/[id]` ·
`POST /api/monitoring/channels/[id]/test` (real HTTP/SMTP attempt).

## Cron / Backups / Firewall
Cron: `GET/POST /api/cron` · `PUT/PATCH/DELETE /api/cron/[id]` · `POST /api/cron/[id]/run` ·
`GET /api/cron/[id]/runs` · `GET /api/cron/preview?schedule=`.
Backups: `GET/POST /api/backups` · `DELETE /api/backups/[id]` · `POST …/verify|inspect|restore` ·
`GET …/download`.
Firewall: `GET /api/firewall/status|rules|fail2ban` · `POST rules` · `PUT/PATCH/DELETE rules/[id]` ·
`POST /api/firewall/apply|confirm|rollback` (60s auto-rollback armed on apply).

## Processes / Services / Terminal
`GET /api/processes` · `POST /api/processes/kill` · `POST /api/processes/renice` (PID 1 and
self refused; honest EPERM). `GET /api/services` (systemd detection + process map) ·
`POST /api/services/action` · `GET /api/services/journal`. Terminal sessions:
`POST/PATCH/GET /api/terminal/sessions` (audit start/end; PTY stream on port 3004 via
`io('/?XTransformPort=3004')`).

## Users / sessions / tokens / audit / settings
Users: `GET/POST /api/users` · `PATCH /api/users/[id]` (`disable|enable|reset-password|reset-2fa`,
role/name updates, last-admin protection) · `DELETE`. Sessions: `GET /api/sessions` ·
`PATCH` `{sessionId}` or `{all:true}`. Tokens: `GET /api/tokens[?mine=1]` · `POST` (scopes,
expiry — token shown once) · `DELETE /api/tokens/[id]`. Audit: `GET /api/audit` (page/filters) ·
`GET /api/audit/verify` · `GET /api/audit/export?format=csv|json`. Settings: `GET/POST
/api/settings` (allow-listed keys) · `POST /api/settings/rotate-url` (password + TOTP gated,
two-phase) · `POST /api/settings/access-mode`.

## Relay (mini-service :3005)
`POST /api/v1/register` `{nonceHash}` → `{serverId,tunnelSecret,token}` (hashes only stored) ·
`POST /api/v1/rotate` (Bearer tunnel secret) · `POST /api/v1/deregister` · `WS /tunnel-socket` ·
`ALL /server/panel/<TOKEN>/*` (identical 404 for unknown/rotated tokens, rate-limited) ·
`GET /healthz` · `GET /metricsz` (Prometheus).
