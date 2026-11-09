# Feature Matrix — HipnoType Panel vs the field

Status legend: **I** = Included · **I+** = Included-and-better · **P** = Provider-limited
(the VPS provider's infrastructure, not panel software — shown honestly in the UI
per spec §5.31) · ~~S~~ = staged for the real VPS deployment (attempted for real,
honest EPERM/error state here).

| Area | hPanel (Hostinger) | aaPanel | CyberPanel | CloudPanel | Coolify | **HipnoType** |
|---|---|---|---|---|---|---|
| Websites / vhosts | I | I | I | I | — | **I+** (guided domain wizard + real DNS verification) |
| Domain onboarding | basic DNS hints | — | — | — | — | **I+** (records → live multi-resolver verify → SSL) |
| DNS zone editor | I | — | I | — | — | **I+** (BIND import/export, propagation checker, Cloudflare sync) |
| Email hosting | I (managed) | — | I (Postfix/Dovecot) | — | — | **I** (§5.19 module; readiness diagnostics §5.17 I+) |
| Mail readiness (PTR/FCrDNS/DNSBL/ports) | P (opaque) | — | — | — | — | **I+** (live diagnostics + provider ticket template + relay workaround) |
| SSL (LE/custom/self) | I | I | I | I | I | **I** (real openssl issuance here; ACME on VPS) |
| File manager | I | I | I | I | — | **I** (jailed, trash, archive/extract, editor) |
| Web terminal | I | I | I | — | I | **I+** (real PTY, single-use tickets, idle/hard caps, audited) |
| Databases | I | I | I | I | P | **I** (SQLite here; MariaDB/PG installer on VPS) |
| Docker apps | — | — | — | — | I+ | **I** (compose staging, deploy pipeline, rollback) |
| WordPress toolkit | I | — | — | — | — | **I+** (real scans, wp.org updates, snapshot+rollback, staging) |
| Security center + score | — | — | — | — | — | **I** (12 real checks, fix-it flow, honest limits) |
| Firewall (nftables) | I | I | I | I | — | **I** (staging + 60 s confirm-rollback timer) |
| Backups | I | I | I | I | P | **I** (sha256-verified, restore, retention) |
| Monitoring + alerts | I | P | — | — | P | **I** (real metrics, rule engine, webhooks/SMTP) |
| Cron UI | I | I | I | — | — | **I** (parser preview, run-now, history) |
| Audit log | — | — | — | — | — | **I+** (hash-chained, tamper-evident, CSV export) |
| Users/roles/API tokens | I | I | I | I | I | **I** (3 roles, scoped tokens) |
| Access hardening | P | — | — | — | — | **I+** (rotating secret URLs, ticket-based terminal auth, lockouts, CSP) |
| Performance advisor | — | — | — | — | — | **I** (real PRAGMA//proc data, honest root-required actions) |
| Server management | I | I | I | I | — | **I** (real /proc//etc inventory, disk analyser, packages) |
| Single-VPS scope guarantee | P (cloud) | — | — | — | — | **I** (never manages another server — enforced by design) |
| Relay / NAT access | P | — | — | — | P (tunnel) | **I** (outbound tunnel + rotating URL, §4.3) |

## Provider-limited actions (stated in the UI, never faked)

OS reinstall, hypervisor snapshots, VNC/rescue console, network-level DDoS
filtering and **PTR records** depend on the provider. Where a limit applies the
panel shows what it *can* do (file snapshots, config history, backups, firewall
rate limiting) and the exact provider action needed — e.g. the PTR support-ticket
template in Email → Readiness.

## Missing rows

None — every feature above ships in this build or is staged for the VPS
deployment with an honest in-UI state. Anything found "Missing" is treated as a
bug before v1.0.0 (spec §16).
