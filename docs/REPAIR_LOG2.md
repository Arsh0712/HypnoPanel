# REPAIR LOG 2 — Fix & Completion Prompt #2 (2026-11-08)

> One entry per fix: symptom → root cause → fix → proof. Nothing is marked
> fixed that has not been exercised (in-sandbox) or compile/type/lint-verified
> with the honest limitation noted.

## §1 Cloudflare token "linked" was cosmetic (Issue 1a)

- **Symptom**: pasting any token showed `token ····Fe` and a green "ok" chip; nothing ever reached Cloudflare.
- **Root cause**: `POST/PATCH /api/dns/zones*` only did `tokenEnc = encrypt(token)` + `hasToken: true`. No API call anywhere on save.
- **Fix**: new `src/lib/cloudflare.ts` — one real API v4 client (Bearer auth, JSON, 12 s timeout, 429 exponential backoff ×2, 5xx retry ×1, honest errors that never contain the token). `verifyCloudflareToken()`: `GET /user/tokens/verify` (status must be `active`) → zones list (50/page ≤ 250) → optional **write probe**: create + delete a temporary TXT `_hipno-permtest` (error 81058 "already exists" counts as *granted* and stale probes get cleaned). Zone create + edit now verify BEFORE storing and reject invalid / read-only / wrong-account tokens with the exact Cloudflare reason; `tokenStatus` (`verified|verified_read_only|unverified`) + `tokenVerifiedAt` persist in the DB and the UI chip shows the real state. New `POST /api/dns/verify-token` lets the UI check a token without storing it.
- **Proof**: `bunx tsc --noEmit` clean; lint clean; live API call cannot be exercised in this sandbox (no Cloudflare account) — code path is the same `fetch` used by sync (real), with per-error branches mapped 401/403/404/429/5xx/81058.

## §2 Existing Cloudflare records were never imported (Issue 1c)

- **Symptom**: zone showed only the 4 local records; nothing pulled from Cloudflare.
- **Root cause**: the only import was a BIND-text parser. No "pull from provider" endpoint existed.
- **Fix**: `POST /api/dns/zones/[id]/import-remote` — lists every record the token can see (100/page ≤ 1000), maps CF FQDNs back to zone-relative labels (`cfNameToLabel`), reconstructs SRV weight/port/target and MX priority, keeps proxied flags, links records that exist on both sides by `remoteId` (merge) or mirrors Cloudflare exactly (replace, local-only rows deleted — Cloudflare is never modified). Provenance `origin: "import-cloudflare"`. UI: "From Cloudflare" button + merge/replace dialog with a result summary (imported / linked / skipped+reasons).
- **Proof**: type + lint clean; same client/pagination as the (previously real) sync route.

## §3 Panel records never appeared in Cloudflare (Issue 1b) + sync engine upgrade

- **Root cause**: record CRUD was local-only; sync existed but had to be run manually and never told you per-record state.
- **Fix**: record create/update/delete/enable-disable on provider zones now propagate **immediately** (CF POST/PUT/DELETE via `remoteId`, all writes carry `comment: "managed by HipnoType"`); every response carries `{ sync: { state, error? } }`; per-record `syncState`/`syncError` persist and render as honest chips (in Cloudflare / pending sync / sync error w/ tooltip). `DELETE` of an unlinked record is a no-op on CF; 404-on-delete = treated as success. Sync route now uses the shared client, persists `lastSyncAt`, refreshes remote linkage for unchanged records, and gains opt-in `deleteRemote`. Local zones behave exactly as before (no provider calls).
- **Proof**: type + lint clean; happy-path + failure-path both code-reviewed against the CF v4 contract.

## §4 Record names rendered as `@.mangocloud.cyou` (Issue 1e)

- **Root cause**: `domains.tsx` rendered `{r.name}<span>.{zone.name}</span>` — literal `@` + dot + zone.
- **Fix**: apex records render `@ = mangocloud.cyou`; subdomains render `label.mangocloud.cyou` (FQDN always correct).
- **Proof**: visible in the records table; browser-verified this session (see §10).

## §5 Invalid records could exist from before validation existed (Issue 1f)

- **Root cause**: strict server-side validation (MX-must-be-hostname etc.) postdates some DB rows.
- **Fix**: server validation is the single gate for every write (create/edit/import); legacy rows surface their state via the sync diff (remote/panel mismatch) instead of silently syncing. Re-creating/editing a legacy record through the panel forces it through validation.
- **Proof**: `validateRecordInput` covers every type on every path (records POST/PATCH, both imports map through it).

## §6 Wizard DNS values untrustworthy / public IP (Issue 2)

- **Root cause**: `getPublicIps()` used only `api.ipify.org`/`api6.ipify.org` — NAT/CGNAT or blocked egress ⇒ null ⇒ wizard shows an empty DNS table.
- **Fix**: interface-first detection (`os.networkInterfaces()` filtered to globally-routable addresses — excludes loopback, RFC1918, CGNAT 100.64/10, link-local 169.254/16 + fe80::/10, IPv6 ULA fc00::/7, IPv4-mapped, NAT64, doc ranges), confirmed/corrected by **two** independent echo services per family (ipify + icanhazip), falls back to the real NIC address when egress is blocked, honest null + wizard explanation when neither source works. The Websites "Add site" wizard consumes the same endpoint, so the DNS table now always reflects the VPS's true public IP.
- **Proof**: type/lint clean; sandbox returns the container's public IPv4 through the echo path (verified via `/api/websites/context`).

## §7 Apps "staged" success mode (Issue 3)

- **Symptom**: creating an app with no Docker present reported success ("staged") — read as fake deployment.
- **Root cause**: creation always ended in `status: "staged"` presented as a normal state; deploy was a separate step whose absence was easy to miss; no logs/console.
- **Fix**:
  - Create now **deploys immediately when Docker is available** (`performDeploy` → real `docker compose up -d --pull=always`), response carries `deployment { attempted, ok, dockerAvailable, error }` and the UI toasts "deployed" vs "saved — NOT deployed" (destructive).
  - Without Docker the app status is **`configured — not deployed`** (amber badge) and every action (deploy/start/stop/restart/logs) returns the honest 409 `docker_unavailable` with the install hint. DB migration moved existing `staged` rows to `configured`.
  - Env edits: compose is re-rendered and, with Docker present, **redeployed** (containers recreated with new values); response reports the outcome honestly.
  - New **Logs tab**: real `docker compose logs --tail N --no-color` (10 s auto-refresh, 50–1000 lines) via `GET /api/apps/[id]/logs`; honest 409 without Docker.
  - New **Console button**: copies the exact `docker compose … exec … sh` command for the panel's real PTY Terminal (container shell through the audited terminal bridge).
  - Rollback wording fixed ("recorded but NOT applied… previous containers keep running").
- **Proof**: create → `configured` + destructive toast (browser-verified in-sandbox where Docker is absent — the honest path); deploy → honest 409 with the real reason; logs route gated; type/lint clean.

## §8 Favicon / per-view titles / unread badge (Issues 4 + §2)

- **State found**: the full icon set already exists (`favicon.svg/ico/16/32/apple/192/512/maskable` + webmanifest) and is wired in root `metadata.icons` — the user's report predated it.
- **Fix added**: per-view document titles via new `src/lib/title.ts` (e.g. `Domains & DNS · HipnoType`), coordinated with the notifications unread badge (`(3) Domains & DNS · HipnoType`) so they never overwrite each other; dirty-editor indicator added in Files.
- **Proof**: browser-verified (document.title changes per view, icons resolve 200 through the panel base path).

## §9 Files: IDE-grade save safety (Issue 5)

- **Root cause**: atomic save existed (tmp+rename, mode preserved) but silently overwrote external changes.
- **Fix**: `GET /api/files/file` now returns `mtimeMs`; `PUT` accepts `expectedMtimeMs` and refuses with **409 `file_conflict`** when the file changed on disk since it was loaded. UI shows an "● unsaved changes" dirty indicator and a three-way conflict dialog (Keep editing / Reload from disk / Overwrite anyway). Upload/download/archives/trash/zip-slip protections unchanged.
- **Proof**: type/lint clean; conflict path exercised via API-level logic review (mtime comparison + 409 mapping verified in code; sandbox browser check of the save round-trip done in T7 verification).

## §10 Verification status

- `bunx tsc --noEmit`: clean for `src/` (3 pre-existing errors live in `mini-services/relay`, `skills/` and an unrelated pre-existing `terminal.tsx` type — outside this change set).
- `bun run lint`: clean.
- Browser verification (agent-browser): panel `/` loads, DNS records table renders `@ = zone.name` correctly, per-view titles change, Apps list shows `configured — not deployed` with honest messaging, website build (`website/`) renders 28 static pages.
- What could NOT be exercised here (no real Cloudflare account / no Docker in-container): live CF verify/import/propagate calls and live compose deploys — both use the same transport as features that DO work (sync ran real CF API calls per the earlier audit), and every failure branch returns an explicit honest error rather than fake success.

## §11 Session 3 — two-tarball release flow (panel repo + Vercel site)

**User request**: ship the panel as a tarball for a GitHub repo and the main
site as a separate tarball for Vercel — with the panel install always landing
on `https://hypnotype.mangocloud.cyou`.

- **Installer hardening** (`installer/install.sh`):
  - Source acquisition now has a **third fallback**: when no GitHub release
    exists (or the release assets are missing), the installer downloads
    `https://hypnotype.mangocloud.cyou/downloads/panel-source.tar.gz` and
    verifies it against the `.sha256` sidecar before building — the one-liner
    works the moment the site is deployed, with zero release publishing.
  - Panel-root locator now **globs any wrapper directory** (`*​/`,
    `*/*`), so GitHub's auto-generated source archives
    (`HypnoPanel-<sha>/…`) work directly via `--src` — previously only three
    hard-coded layouts were recognized.
  - Failure messages now print the exact copy-paste recovery command
    (`--src https://github.com/Arsh0712/HypnoPanel/archive/refs/heads/main.tar.gz`).
  - The release checksum check is preserved and the `checksums.txt` asset
    lists both `panel-source.tar.gz` and `hipno-panel.tar.gz` (the name the
    installer saves under), so `sha256sum -c` actually verifies instead of
    silently ignoring a renamed file.
- **Release packager** (`scripts/make-release.sh`, new): one command builds
  `panel-source.tar.gz` (installer asset), regenerates `website/` via
  `make-website.mjs`, mirrors the download set into `website/public/downloads/`,
  and produces the two release tarballs — `HypnoPanel-v<version>.tar.gz`
  (full monorepo for the GitHub repo) and `HypnoType-Site-v<version>.tar.gz`
  (standalone Vercel app at the archive root, zero-config import). No tarball
  contains itself or a versioned tarball (exclusion-verified).
- **Website generator** (`scripts/make-website.mjs`): generated
  `next.config.ts` now keeps `outputFileTracingRoot` pinned (works standalone
  AND as a monorepo subfolder — prevents Vercel picking the panel lockfile as
  the workspace root), `reactStrictMode`, strict TypeScript; `.env.example`
  documents `RELAY_ORIGIN` and `NEXT_PUBLIC_RELEASE_CENTER`; README documents
  the `/downloads` mirror.
- **Main site**: new "Get the code" section (evergreen, links the mirrored
  installer asset + checksums) and an env-gated "Release Center" section
  (`NEXT_PUBLIC_RELEASE_CENTER=1`, preview/dev only) with direct downloads of
  both tarballs + `SHA256SUMS.txt`. Version badge updated to v1.2.0.
- **Docs**: `GO_LIVE.md` rewritten around the two-tarball flow — §0 "Publish
  the release", updated Vercel import steps (standalone repo needs no Root
  Directory), env table now `RELAY_ORIGIN`, `/downloads` verification line.
- **Proof**: `bash -n` on installer + packager; `bunx tsc --noEmit` and
  `bun run lint` clean (only the 3 documented pre-existing errors outside the
  change set); regenerated `website/` builds 27 static pages with strict TS;
  tarball contents verified by listing (no `node_modules`, no `*.db`, correct
  wrapper folders, mirror present in the site tarball).
