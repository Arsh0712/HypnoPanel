# HipnoType website (deploy on Vercel)

This folder is **generated** from the panel workspace — do not edit by hand.

    bun scripts/make-website.mjs        # regenerate (from the repo root)

It is a standalone Next.js app: marketing site + docs + `/install.sh` + the
`/server/panel/*` rewrite to the HipnoType relay.

## Deploy on Vercel

1. Push the repository to GitHub (`Arsh0712/HypnoPanel`).
2. In Vercel: **Add New → Project → Import** the repo. Set the **Root
   Directory** to `website` (Vercel detects Next.js automatically).
3. Before the first build, add the environment variables from
   `.env.example` (Project → Settings → Environment Variables):

   | Variable | Value | Notes |
   |---|---|---|
   | `NEXT_PUBLIC_SITE_URL` | `https://hypnotype.mangocloud.cyou` | canonical URL |
   | `RELAY_ORIGIN` | `https://relay.hypnotype.mangocloud.cyou` | rewrite target (baked at build) |
   | `NEXT_PUBLIC_GITHUB_REPO` | `https://github.com/Arsh0712/HypnoPanel` | links |

4. Attach the custom domain: **Settings → Domains → Add** →
   `hypnotype.mangocloud.cyou`. At your Cloudflare zone add the DNS record
   Vercel shows (CNAME to `cname.vercel-dns.com`), **proxy OFF** (grey
   cloud) — Vercel needs to issue its own certificate.
5. Deploy. Then verify (see the checklist below).

## Verification checklist

    # 1 · install.sh is served as plain text (never HTML!)
    curl -fsSL -D - https://hypnotype.mangocloud.cyou/install.sh | head -5
    #    → 200, content-type: text/plain; charset=utf-8

    # 2 · checksum matches the shipped one
    curl -fsSL https://hypnotype.mangocloud.cyou/install.sh -o install.sh
    curl -fsSL https://hypnotype.mangocloud.cyou/install.sh.sha256
    sha256sum -c install.sh.sha256

    # 3 · the rewrite proxies to the relay (byte-identical 404 for a bogus token)
    curl -s -o /dev/null -w "%{http_code}\n" \
      https://hypnotype.mangocloud.cyou/server/panel/doesnotexist000000000000000/

    # 4 · a real panel URL loads its unlock screen (after the panel is installed)

## The /downloads mirror

`public/downloads/` ships the installer asset the one-liner falls back to
when no GitHub release exists yet (keep it in sync after every release):

    bun scripts/make-release.sh        # from the panel repo root — rebuilds
                                       # panel-source.tar.gz + checksums and
                                       # refreshes public/downloads/ here

Files: `panel-source.tar.gz`, `panel-source.tar.gz.sha256`,
`checksums.txt` (and the versioned release tarballs when built from the
panel workspace).

## Local run

    cd website
    bun install
    bun run dev        # http://localhost:3210
