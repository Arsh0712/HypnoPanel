# AUDIT — page/control → API → real system effect

Legend: **Works** = traced end-to-end and exercised · **Real-honest** = does the
real thing where the environment allows and states limits plainly (no fakes).

| Page / control | API route | Real effect | Status |
|---|---|---|---|
| Login (email/pass/2FA/recovery) | `/api/auth/login` | Argon2id verify, TOTP, lockout (5→1/5/15 min), DB session | Works |
| Session bootstrap | `/api/auth/session` | DB session validation, sliding idle | Works |
| Forced password change | `/api/auth/change-password` | policy-checked rehash, mustChangePassword cleared, sessions revoked | Works |
| 2FA setup/disable | `/api/auth/2fa/*` | real TOTP secret+QR, recovery codes hashed | Works |
| Dashboard stats/charts | `/api/dashboard/live`+`history` | /proc CPU/mem/disk/net sampler, ring + SQLite (BigInt), ps top | Works |
| **Add website wizard** | `/api/websites` POST + `/dns-context` + `/dns-check` | real docroot/vhost generation, domain normalisation, real multi-resolver DNS verification, TXT challenge | Works |
| Website config/SSL/logs/clone | `/api/websites/[id]/*`, `/api/ssl/*` | config writes, real openssl self-signed, real log tails, fs clone | Works |
| Site preview link | `/api/websites/[id]/preview/` | serves real files from docroot | Works |
| **Terminal** | socket.io :3004 + `/api/terminal/ticket` | real PTY (node-pty, pipe fallback), 30 s single-use tickets, idle/hard timeouts, audited | Works |
| **Domains & DNS** | `/api/dns/**` | zone+record CRUD, per-type validation, BIND import/export, propagation checks, real Cloudflare v4 sync | Works |
| **Email** | `/api/mail/**` | PTR/FCrDNS/ports/DNSBL/SPF-DKIM-DMARC real lookups, DKIM keygen, nodemailer test send | Works |
| **WordPress** | `/api/wordpress/**` | real fs scans, wordpress.org update checks, download+apply with snapshot/rollback, staging fs.cp, one-time admin link | Works |
| **Security Center** | `/api/security/**` | 12 real checks + score, real session-revocation fix, honest SSH/WAF states | Works |
| **Performance** | `/api/performance/**` | real PRAGMA//proc data, advisor math, honest EPERM actions with CLI commands | Real-honest |
| **Server** | `/api/server/**` | real os-release/route/ports/du/apt-sim, audited actions with honest root errors | Real-honest |
| Databases | `/api/databases/**` | real SQLite files in data/databases, query runner, import/export | Works |
| Files manager | `/api/files/**` | real fs ops, roots-jailed, trash, archive/extract | Works |
| Apps (Docker) | `/api/apps/**` | real compose staging + deploy pipeline; Docker absent here → honest unavailable banner (not fake) | Real-honest |
| Firewall | `/api/firewall/**` | rule staging + nft CLI generation; nft absent here → honest status; rollback timer real | Real-honest |
| Cron | `/api/cron/**` | real schedule preview (cron-parser), run executes via child_process, history persisted | Works |
| Backups | `/api/backups/**` | real tar.gz creation with sha256, verify/restore/retention | Works |
| Monitoring/alerts/channels | `/api/monitoring/**` | real rule engine on live metrics, webhooks via fetch, SMTP channel | Works |
| Users/tokens/sessions | `/api/users`, `/api/tokens`, `/api/sessions` | role/permission enforced CRUD, hashed API tokens | Works |
| Audit log | `/api/audit/**` | hash-chained entries, chain verification, CSV export | Works |
| Settings | `/api/settings` | typed allow-listed keys; secrets masked (tunnel secret fully removed from responses) | Works |
| Access URL rotate | `/api/settings/rotate-url` | token rotation (old URLs die), custom slug rules | Works |

Dead buttons / fake patterns found during this audit: **none remaining**.
Anything the environment cannot truly perform states so and links the equivalent
`hypno` CLI command — per the no-fake-functionality rule.
