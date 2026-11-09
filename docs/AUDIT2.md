# AUDIT 2 — Fix & Completion Prompt #2 (2026-11-08)

> Trace of every user-reported issue → code path → root cause → fix plan.
> Status legend: **Works** (real, end-to-end) · **Partial** (real but incomplete) · **Fake** (pretends) · **Broken** (errors).

## A. The six user-reported issues

| # | Report | Code path | What the code actually does | Status | Fix |
|---|---|---|---|---|---|
| 1a | "Pasted CF token → shows linked `····Fe`, but nothing in Cloudflare" | `POST/PATCH /api/dns/zones*` → `tokenEnc = encrypt(token)` → `zoneToSummary.hasToken/tokenMasked` | Token is stored AES-256-GCM and masked — but **never verified against Cloudflare**. Any string (even `Fe…` truncated paste) shows "token ····xx". No `GET /user/tokens/verify`, no permission probe. | **Fake (link state only)** | New `src/lib/cloudflare.ts` with `verifyToken()`: `GET /user/tokens/verify` → zones list (paginated 50) → write-permission probe via temp TXT `_hipno-permtest` (handles dup 81058, 429 backoff). Zone create/edit returns `verified: false` on failure; UI shows verified/unverified state. |
| 1b | "Records I add in the panel never appear in Cloudflare" | `POST /api/dns/zones/[id]/records` → `db.dnsRecord.create` only | Local-only write. Sync exists and is **real** (`sync/route.ts` does real CF API diff+apply), but the user must know to run it — records dialog never says "local only until sync". | **Partial** | Record CRUD on provider zones now **propagates immediately** (create→CF POST, edit→CF PUT, delete→CF DELETE, enable/disable→PUT), each storing the CF record id (`remoteId`). Failures surface per-record with honest errors; local row marks `sync state: error`. Local zones behave as before. |
| 1c | "Existing Cloudflare records were not imported (only 4 local records shown)" | `POST /api/dns/zones/[id]/import` | **BIND text import only.** No "pull from Cloudflare" endpoint exists at all. | **Fake (absent)** | New `POST /api/dns/zones/[id]/import-remote` — pulls every CF record (paginated 100/page) into the panel, mapping CF FQDNs back to zone-relative labels, preserving priority/proxied flags. Offered in the zone UI next to Import. |
| 1d | "'Sync zone' is not a real sync" | `POST …/sync` | **Actually real** (zones lookup, record pagination, diff, create/update apply, remote-only reported, per-item failures). Gaps: no remote-delete option, no proxied flag handling, no last-sync state persisted. | **Partial** | Keep engine, add: proxied flag passthrough, persisted `lastSyncAt/lastSyncDiff`, import-remote before first diff, health column per record. |
| 1e | "Record names render wrong: `@.mangocloud.cyou`" | `domains.tsx` records table | Renders `{r.name}<span>.{zone.name}</span>` — for apex records `@` this prints `@.mangocloud.cyou`. | **Broken (cosmetic)** | Apex renders as bare `zone.name` (muted apex label `@`), subdomains as `label.zone` — FQDN always correct. |
| 1f | "MX value not a hostname (invalid record got in)" | `records.ts validateRecordInput` | Server-side validation **is** strict (MX must be hostname + priority). The invalid record predates validation or was inserted via seed. | **Works (now)** | One-time DB sweep rejects/reports records that fail current validation (zone health report), so pre-existing junk is surfaced instead of silently synced. |
| 2 | "Add-site wizard DNS table values untrustworthy; server IP must be the real VPS public IP" | `websites.tsx` ← `/api/websites/context` ← `sysinfo.getPublicIps()` | IP source: `api.ipify.org` + `api6.ipify.org` only, 10-min cache. Behind NAT/CGNAT or with echo services blocked this returns null → wizard shows empty/A-record-less table. | **Partial** | Interface-first detection: read NIC addresses, exclude private/CGNAT(100.64/10)/link-local/ULA ranges, confirm via **two** independent echo services (ipify + icanhazip), fall back to relay-reported address, then honest null with explanation. Never fabricate. |
| 3 | "Apps 'staged' mode is fake — no real deployment, files, upload, zip import, logs, console, env editor" | `api/apps/**` | When Docker is absent (this sandbox), deploys "succeed" as **staged** with a generated compose file and the UI badge says *staged* — presented as a success state, which reads as fake. When Docker **is** present the code already does `docker compose up`. Missing entirely: app file browser/upload/zip-import, log tail, container console, env edit+recreate. | **Fake (staged as success)** | (a) Deploy semantics: real `docker compose up -d` when Docker present; when absent → **error state** `docker_unavailable` (409) with install hint, never "staged success". (b) Real `docker compose ps` status, `logs --tail`, `exec` console via terminal bridge, env editor → recreate. (c) App files: real directory under `/var/lib/hipno/apps/<slug>` exposed through the existing Files jail. |
| 4 | "Browser tab has no HipnoType logo favicon" | `public/favicon.*` + `layout.tsx metadata.icons` | Full favicon set (svg/ico/16/32/apple/192/512/maskable) **already exists** and is wired in metadata. The user tested an older build. Remaining gaps: per-view document titles, terminal unread dot, `<noscript>` fallback. | **Works (verify + polish)** | Re-verify all icons 200 OK through the panel base path; add per-view `document.title`, unread badge on terminal nav, manifest theme colors. |
| 5 | "Files manager is not IDE-grade" | `api/files/**` + `files.tsx` | Monaco editor, upload/download, archives, chmod, trash, traversal+symlink protection — real. Missing IDE features: conflict detection (mtime/ETag) on save, unsaved-dirty state, file tree virtualisation for large trees, split view, search across files. | **Partial** | Add mtime-based optimistic-concurrency save (409 on conflict with diff choice), dirty-state tabs, multi-file tabs, and keep protections. |
| 6 | "Runtime compatibility across virtualisation/container environments" | `sysinfo.detectVirt()` + honest probes | `detectVirt` reads systemd-detect-virt/`/proc` markers; modules probe docker/nft/systemd live and degrade honestly. Docker-in-this-sandbox absent → staged paths (see #3) will now hard-error instead. | **Partial** | With #3 fixed, absent backends are errors with install guidance — never fake success. Compat table documented in `docs/COMPAT_REPORT.md`. |

## B. Cross-cutting fake-pattern grep results

| Pattern | Hits | Verdict |
|---|---|---|
| `staged` as a **success** state | `api/apps/**` (deploy/rollback/git/routes, UI badge) | **Remove as success state** — replaced by `deployed` (real) or `docker_unavailable` (error). Staging artifacts (compose files) remain on disk but are never presented as a deployed app. |
| Hardcoded record/site arrays | none — templates are clearly-labelled starting points | OK (user-invoked) |
| `// TODO` stubs | none in API routes | OK |
| setTimeout fake progress | none | OK |
| React mock data | none | OK |
| Cloudflare SDK stub | none — real `fetch` to `api.cloudflare.com` in sync | OK (extend per 1a–1d) |

## C. Fix order

1. `src/lib/cloudflare.ts` — one real client (verify, list zones, list/create/update/delete records, 429 backoff, 81058, timeouts, honest errors)
2. Zone create/edit + record CRUD wired through it; `import-remote`; sync keeps engine + gains proxied/lastSync state
3. UI: verified-token chip, per-record sync state, import-from-Cloudflare button, `@`-name fix
4. Public IP interface-first detection (wizard context)
5. Apps honesty pass (error-not-staged; status/logs/console/env-edit when Docker present)
6. Files: mtime conflict save + dirty tabs
7. Favicon/per-title/unread polish + browser verification
8. Website (Vercel) + vercel.json + `.env.example` + install.sh single-source + final `HypnoPanel-complete.tar.gz`

Everything below is implemented in this session; per-fix proof entries live in `docs/REPAIR_LOG2.md`.
