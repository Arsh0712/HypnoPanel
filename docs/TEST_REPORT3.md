# TEST REPORT 3 — Fix & Completion Prompt #2 browser verification (2026-11-08)

> Agent-browser end-to-end pass over everything changed in this session,
> on the live dev preview (panel at `/panel`, marketing site at `/`).
> Login: `qa@hipno.local` (admin). Raw transcripts in the session log.

## Marketing site (`/` — the Vercel site's source)

| Check | Result |
|---|---|
| Homepage renders (hero, one-liner `curl -fsSL https://hypnotype.mangocloud.cyou/install.sh \| sudo bash`, copy box, requirements table) | ✅ |
| `/install.sh` served (preview parity with production headers on Vercel) | ✅ 200 |
| favicon set resolves (`/favicon.svg` …) | ✅ 200 |
| Mobile 390×844: no horizontal overflow | ✅ `scrollWidth ≤ innerWidth` |
| Footer: last element on long pages (pushed naturally), sticky pattern `flex min-h-screen flex-col` + `mt-auto` on short pages; verified at 3368 px page height and 3000 px-tall viewport — footer bottom == page bottom, no gap | ✅ |
| Fresh-load console errors / React warnings | ✅ none |

## Panel — Domains & DNS (Issues 1a–1f)

| Check | Result |
|---|---|
| Apex records render `@ = mangocloud.cyou` (was `@.mangocloud.cyou`) | ✅ (MX + TXT rows verified) |
| Subdomain records render `label.zone` | ✅ |
| MX record holds a valid hostname + priority (validation held) | ✅ `mail67.mangocloud.cyou` · 10 |
| Legacy stored token shows **“Token ····Fe · unverified — re-save to verify”** instead of a green "linked" chip | ✅ |
| Zone create with a FAKE token (`curl POST /api/dns/zones`) → rejected with the real Cloudflare error (`6003 Invalid request headers`), **zone NOT created** (DB verified) | ✅ |
| “From Cloudflare” button present; import dialog (merge/replace + consequences) opens | ✅ |
| Import-remote with the legacy invalid token → honest 400, no records fabricated | ✅ (network log) |

## Panel — Apps (Issue 3)

| Check | Result |
|---|---|
| App badge reads **“configured — not deployed”** (amber) — “staged” gone | ✅ |
| Module banner: “deploys are refused with an error (never faked)…” | ✅ |
| App detail: Overview / Environment / **Logs** / Releases tabs | ✅ |
| Console button disabled without Docker (tooltip “Needs Docker”) | ✅ |
| Logs tab without Docker → honest “container logs cannot be read here” | ✅ |
| Deploy click → destructive toast: “Docker backend unavailable — … nothing was deployed. Install Docker…” (409 `docker_unavailable`) | ✅ |

## Panel — Files (Issue 5)

| Check | Result |
|---|---|
| Open file → Monaco loads content + `mtimeMs` | ✅ |
| Edit → “● unsaved changes” indicator appears | ✅ |
| Save → “File saved” toast, content written to disk | ✅ |
| External change BEFORE open → reload picks it up (no false conflict) | ✅ |
| External change AFTER open + Save → **409 `file_conflict` → “File changed on disk” dialog** (Keep editing / Reload / Overwrite anyway) | ✅ |
| “Overwrite anyway” → second save succeeds | ✅ |

## Panel — titles/favicon (Issue 4 + §2)

| Check | Result |
|---|---|
| `Dashboard · HipnoType` / `Domains & DNS · HipnoType` / `Apps · HipnoType` / `Files · HipnoType` — per-view titles change with navigation | ✅ |

## Website (`website/` — the Vercel deployment)

| Check | Result |
|---|---|
| `bun install && bun run build` | ✅ 28 static pages, middleware 34.2 kB |
| `public/install.sh` byte-identical to `installer/install.sh` (`diff` empty, sha256 match) | ✅ |
| Changelog v1.2.0 entry renders after sync | ✅ (build output) |

## Not exercisable in this sandbox (honest limits)

- **Live Cloudflare API calls** (verify/import/sync/propagate with a real token): no Cloudflare account exists here. The client is the same transport the previously-real sync used; every failure branch (401/403/404/429/5xx/81058) is coded and unit-mapped to honest errors. Verified negative paths (fake token rejection) live.
- **Real Docker deploys**: no Docker in the container. All docker-present paths (`compose up`, `logs`, `exec`, env-recreate) are wired to the same `run()`/probe helpers used by modules that work live; the docker-absent path is fully browser-verified as honest refusals.
- **Relay tunnel through Vercel**: the sandbox reaches the relay via `?XTransformPort=3005` (single exposed port). The production path is a plain Vercel rewrite to `hipno-relay.mangocloud.cyou` — same relay code, verified earlier via `/healthz` 200 + tunnel HTML 200.
