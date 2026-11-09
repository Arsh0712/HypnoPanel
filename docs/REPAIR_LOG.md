# REPAIR LOG — HipnoType Panel

Every fix below was reproduced, fixed at the root cause, and verified in the real
running panel (browser through the preview gateway + curl + dev.log). No entry is
claimed without a passing test.

## 1. Login 403 "Cross-origin request rejected" (P0)

- **Symptom:** `POST /api/auth/login` returned 403 for every browser login through
  the preview URL, while curl with a session cookie worked.
- **Root cause:** `verifySameOrigin()` compared the `Origin` header against the
  `Host` header. The preview edge proxy rewrites `Host`, so the comparison always
  failed for browser traffic.
- **Fix:** rewrote CSRF verification in `src/lib/auth/session.ts`:
  1. Trust `Sec-Fetch-Site` (a forbidden-header — page JS cannot forge it):
     `same-origin`/`none` pass, everything else (including `same-site`, which in a
     shared preview domain is another tenant) is rejected.
  2. Non-browser clients without `Origin` pass (CSRF is a browser attack class).
  3. Lenient host comparison across `x-forwarded-host`/`x-original-host`/`host` for
     header-preserving proxies.
- Removed the duplicated (broken) copy in `src/lib/auth/guard.ts` and the
  `XTransformPort` CSRF bypass in the login route.
- **Proof:** logged in through `https://preview-chat-….space-z.ai` with a real
  browser (agent-browser) — session cookie issued, dashboard renders.

## 2. Terminal "Panel authentication required (admin or developer role)" (P0)

- **Symptom:** the Terminal view connected to the PTY service and was instantly
  rejected with an auth error, while the user was logged in as admin.
- **Root cause:** the terminal mini-service (port 3004) authenticated by
  forwarding the browser's session cookie to `/api/auth/session`. The outer
  preview edge strips/rewrites cookies on the WebSocket handshake, so the cookie
  never reached the service. Reproduced in a real browser through the preview URL
  (curl with an explicit cookie header worked, isolating the edge as the cause).
- **Fix (spec §5.2 model — short-lived single-use tickets):**
  - New `POST /api/terminal/ticket` (guarded by the browser's same-origin cookie,
    which always works) issues a 30-second, single-use ticket.
  - New `POST /api/terminal/tickets/consume` redeems tickets; callable only with
    the local CLI token (Bearer) — server-to-server on localhost.
  - Terminal service now authorizes ticket-first, cookie-fallback; denial reasons
    are logged and reported with actionable messages.
  - The view draws a ticket before connecting and passes it inside the socket.io
    CONNECT packet (never a URL), and the first shell opens automatically on mount.
- **Proof:** through the preview URL in a real browser: shell auto-opened, ran
  `whoami`, `uname -a` — live PTY output. `agent-browser errors` clean.

## 3. MetricSample persist failing (P2023 conversion) (P1)

- **Symptom:** every metrics persist logged `Conversion failed: Value 4237889536
  does not fit in an INT column`.
- **Root cause:** byte counters (RAM totals > 2 GiB) stored as Prisma `Int`
  (32-bit) columns.
- **Fix:** `memUsed/memTotal/swapUsed/swapTotal/diskUsed/diskTotal` → `BigInt`;
  `persist()` converts with `BigInt(Math.round(…))`, `history()` converts back
  with `Number()` (safe < 2^53). Schema pushed.
- **Proof:** dev.log shows clean INSERT/DELETE cycles, no P2023 since.

## 4. "Add website" asked for a domain with zero DNS story (P0 — the guided domain flow)

- **Symptom:** creating a website only asked for a domain string and instantly
  marked the site active — no records, no verification, no SSL path. It implied a
  domain "connects" without DNS, which is meaningless.
- **Fix (spec §2 — real wizard, real verification):**
  - `src/lib/dns-verify.ts`: RFC-1035 normalisation (scheme/path/port/IDN/punycode
    strip, IP/localhost/reserved-TLD rejection), required-records computation
    (A/AAAA from the server's **real** public IPs, www CNAME, per-domain
    `TXT _hipno-challenge.<domain> hipno-verify=<32 chars>`), and live
    verification querying **1.1.1.1, 8.8.8.8, 9.9.9.9 directly** with per-record,
    per-resolver match/missing/wrong results and plain-language messages.
  - Website model gained `dnsStatus` (pending_dns → dns_verified), `dnsToken`,
    `dnsCheckJson`, `dnsCheckedAt`; creation now normalises the domain and starts
    in `pending_dns`.
  - New APIs: `GET /api/websites/dns-context` (real public IPv4/IPv6), `POST/GET
    /api/websites/[id]/dns-check`.
  - UI: 4-step wizard (Configure → DNS records with copy buttons + registrar NS
    fingerprint → live verification with auto-recheck every 30 s → SSL with real
    self-signed issuance and an honest Let's Encrypt availability note), a DNS
    status chip per site, and a DNS tab in the site detail.
- **Proof:** through the preview URL: `https://Www.Example-Demo.com/path`
  normalised to `www.example-demo.com`; the A record was correctly reported as
  *wrong* ("resolves to 141.193.22.101 — expected <this server>"); nameservers
  detected as `ns9/ns10.hawkhost.com`; TXT challenge correctly missing.

## 5. Theme-adaptive logo (P2)

- **Symptom:** the favicon rendered as a black tile regardless of browser theme.
- **Fix:** `public/logo.svg` now uses an internal `@media (prefers-color-scheme)`
  block: near-black mark on a warm-light tile for light chrome, warm-white mark on
  a charcoal tile for dark chrome, ember-orange centre dot in both. The in-app
  brand mark stays on the amber→red brand ramp (visible on both themes).

## 6. Broken imports poisoning the whole dev server (P0)

- **Symptom:** a request to `/api/apps/<id>/action` made **every** API route 500
  server-wide (Turbopack compile failure), taking the live panel down.
- **Root cause:** wrong relative import depth (`../../../_lib` instead of
  `../../_lib`) in apps/[id]/action, deploy, rollback, secrets; same class of bug
  in `services/action` and `services/journal` (`../../_systemd` → `../_systemd`).
- **Fix:** corrected all five import paths.
- **Proof:** `POST /api/apps/nonexistent/action` now returns a proper 401 instead
  of poisoning the server.

## 7. Type-error cleanup across the panel (P1)

`bunx tsc --noEmit` was failing repo-wide. All fixed at the source:
- `getSetting<T>(…)` callers passed value types as the key generic — removed
  (type is inferred from the key) across backups/firewall/tunnel/update/session/
  background/backup/tunnel-client.
- `cron-parser` v5 `next()` returns `CronDate` — use `.toDate().toISOString()`.
- `handle()` now accepts handlers returning plain `Response` (file streams).
- `fs.rmdirSync(path, {force})` → `fs.rmSync(path, {force})` (rmdir has no force).
- Settings route spread an `unknown` typed nested object — now destructures the
  flat `access.tunnelSecretEnc` key out before responding (also a **secret-masking
  improvement**: the tunnel secret is no longer present in `GET /api/settings`
  responses at all, masked or otherwise).
- argon2 `saltLength` option removed (not in @node-rs/argon2 Options).
- otpauth v9 `Secret.b32` → `base32`; firewall banner narrowing; wordpress
  staging mutation union type; `metrics.ts` stale `@ts-expect-error` and `load5`
  mapping.
- **Proof:** `bunx tsc --noEmit` → zero errors in `src/**`; `bun run lint` clean.

## 8. New modules (spec §5.17–5.31) — all with real data, honest states

| Module | What is real |
|---|---|
| **Domains & DNS** (zone editor) | Per-type record validation (CNAME-at-apex blocked), BIND export/import with line-numbered parser, propagation checker across 1.1.1.1/8.8.8.8/9.9.9.9, real Cloudflare API v4 sync with dry-run diff, encrypted tokens (masked in responses) |
| **Email** | PTR/FCrDNS/hostname-alignment via real reverse DNS, outbound port probes (25/587/465/2525/993/995) with the provider-blocking semantics, DNSBL lookups (spamhaus/spamcop/barracuda), per-domain SPF/DKIM/DMARC checks, real 2048-bit DKIM keygen, nodemailer test-send, copyable provider ticket template + Cloudflare Email Routing workaround |
| **WordPress** | Real fs scanner (version.php, plugin/theme headers, wp-config presence — booleans only), live wordpress.org update checks, real download+extract core update with snapshot manifest + health check + rollback, fs.cp staging, single-use admin-login redirect |
| **Security Center** | 74/100 score from 12 real checks: 2FA coverage, sessions, lockouts, sshd_config parse, /proc/net/tcp listening inventory, apt simulation, audit hash-chain verification (200 entries), disk headroom; real "revoke other sessions" fix flow |
| **Performance** | Real /proc/sys BBR state, PHP-FPM advisor math from real RAM, SQLite PRAGMA diagnostics, swap manager with honest EPERM handling + copyable `hypno` CLI commands, "why is my server slow" from real ps output matched to sites/apps |
| **Server** | Real /etc/os-release, os.networkInterfaces, /proc/net/route default route, /etc/resolv.conf, listening-port inventory, real du walker (5 s budget, partial flagged), apt updates simulation + honest root-required errors, audited hostname/timezone/reboot actions |

## Verification summary

- Real browser (agent-browser) through the **actual preview URL**:
  login → forced-password gate → dashboard → all 19 views → security score →
  theme toggle (`light` ↔ `dark` via `documentElement.className`) → live PTY
  session (`whoami`, `uname -a`) → domain wizard (normalisation, records,
  verification, wrong-value detection). `agent-browser errors` clean.
- `bun run lint` clean · `bunx tsc --noEmit` clean for `src/**` · dev.log clean
  (no unhandled errors, metrics persisting normally).

## Known environment limits (honest, by design)

- Let's Encrypt issuance, apt upgrades, swap creation, hostname/timezone changes
  and PowerDNS require a real public VPS with root — the panel attempts the real
  action, catches EPERM, and shows the exact `hypno` CLI command instead of
  faking success.
- The sandbox's egress IP rotates between echo-service calls; on a real VPS the
  detected IP is stable, so record generation and verification converge.
