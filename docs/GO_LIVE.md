# GO LIVE — deploying HipnoType (main site on Vercel + relay + panel VPS)

> The complete, copy-paste runbook for the production architecture behind
> **https://hypnotype.mangocloud.cyou**. The release ships as two tarballs
> (see `SHA256SUMS.txt`):
>
> | Tarball | Goes to | What it is |
> |---|---|---|
> | `HypnoPanel-v<version>.tar.gz` | your GitHub repo (`Arsh0712/HypnoPanel`) | the full panel monorepo: panel + relay + installer + docs + `website/` |
> | `HypnoType-Site-v<version>.tar.gz` | Vercel | the standalone main site (this website) |
> | `panel-source.tar.gz` | GitHub release asset (optional) | the exact source `install.sh` builds from — also mirrored at `/downloads/` on the site |

```
┌────────────┐   HTTPS + WSS    ┌─────────────────┐  outbound WS tunnel  ┌──────────────┐
│  Browser   │ ───────────────▶ │ Vercel           │                      │              │
└────────────┘                  │ hypnotype.mango… │                      │  Panel VPS   │
                                │  (this website/) │◀────────────────────▶│ (install.sh) │
                                └────────┬──────────┘   relay.hypnotype…  └──────────────┘
                                         │ rewrite /server/panel/:path*        ▲
                                         ▼                                     │
                                ┌─────────────────┐        IPv4, TLS          │
                                │  Relay VPS       │ ─────────────────────────┘
                                │ relay.hypnotype… │   (no inbound ports on the panel VPS)
                                └─────────────────┘
```

- **Vercel** serves the marketing/docs site AND `/install.sh`, and proxies
  `/server/panel/<token>/*` (HTTP + WebSocket) to the relay.
- **Relay VPS** (any small IPv4 box, e.g. the mangocloud control node) runs
  `mini-services/relay` behind Caddy TLS at `relay.hypnotype.mangocloud.cyou`.
- **Panel VPS** (the user's server) installs with one command and dials OUT to
  the relay — works on NAT/IPv6-only/zero-inbound-port hosts.

---

## 0 · Publish the release (once, after uploading the repo)

1. Extract `HypnoPanel-v<version>.tar.gz` and push the `HypnoPanel/` contents
   to `github.com/Arsh0712/HypnoPanel` (main branch).
2. Optional but recommended — publish a GitHub release so the one-liner
   downloads from GitHub:
   - On any machine with the repo checked out: `bash scripts/make-release.sh`
   - GitHub → Releases → **Draft a new release** → tag `v<version>`
   - Attach `panel-source.tar.gz` + `checksums.txt` (from `public/downloads/`)
3. No release yet? Fine — `install.sh` automatically falls back to the
   site mirror at `https://hypnotype.mangocloud.cyou/downloads/panel-source.tar.gz`
   (verified against its `.sha256` sidecar), or install straight from the repo:

   ```bash
   curl -fsSL https://hypnotype.mangocloud.cyou/install.sh | sudo bash -s -- \
     --src https://github.com/Arsh0712/HypnoPanel/archive/refs/heads/main.tar.gz
   ```

---

## 1 · Vercel — the main site

### 1.1 Import

1. Push the repository to GitHub — it already contains `website/` (or push the
   extracted `HypnoType-Site-v<version>.tar.gz` as its own repo; the app sits at
   the archive root, so no Root Directory setting is needed in that case).
2. Vercel → **Add New → Project** → import the repo.
3. **Root Directory: `website`** (Settings → General) — *only* when importing
   the monorepo; skip this for the standalone site repo. Build is auto-detected
   (`next build`). Node 20+ default is fine.

### 1.2 DNS

In the domain's DNS (Cloudflare for mangocloud.cyou — proxy OFF / “DNS only”
for this record if you want WebSockets unfiltered):

```
hypnotype.mangocloud.cyou    CNAME    cname.vercel-dns.com
relay.hypnotype.mangocloud.cyou    A    <RELAY_VPS_IPv4>
```

Then in Vercel: **Add domain** `hypnotype.mangocloud.cyou` (accept the
CNAME recommendation).

### 1.3 Environment variables (what to add and where)

Vercel → Project → **Settings → Environment Variables** → add for
**Production** (and Preview if you like). Defaults are already baked in, so
adding them is optional but recommended to make them explicit/overridable:

| Variable | Value | Required | What it does |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://hypnotype.mangocloud.cyou` | recommended | Canonical URLs, sitemap, OG tags |
| `NEXT_PUBLIC_GITHUB_REPO` | `https://github.com/Arsh0712/HypnoPanel` | recommended | Header/footer source + release links |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | `support@hipnotype.mangocloud.cyou` | recommended | Footer contact link |
| `RELAY_ORIGIN` | `https://relay.hypnotype.mangocloud.cyou` | optional | Destination of the `/server/panel/:path*` proxy rewrite (baked at build time in `next.config.ts`; defaults to `relay.hypnotype.mangocloud.cyou`). Set it only if your relay lives elsewhere. |

The relay proxy rewrite lives in `website/next.config.ts` (`afterFiles`) and
forwards `/server/panel/:path*` → `RELAY_ORIGIN` with the original query
string. `vercel.json` only carries small settings — headers and content types
come from `next.config.ts` so local `next start` behaves identically.

### 1.4 Verify

```bash
curl -I https://hypnotype.mangocloud.cyou/            # 200, X-Frame-Options: DENY
curl -I https://hypnotype.mangocloud.cyou/install.sh  # 200, Content-Type: text/plain
curl -s https://hypnotype.mangocloud.cyou/install.sh.sha256   # sha256 + install.sh
curl -I https://hypnotype.mangocloud.cyou/server/panel/invalidtoken/  # relay 404 (proxied!)
curl -I https://hypnotype.mangocloud.cyou/downloads/panel-source.tar.gz  # 200, the mirror
```

The `invalidtoken` line proves the rewrite works: the relay answers with its
normalised 404 for unknown tokens. The `/downloads/` line proves the mirror
is live for the installer fallback.

---

## 2 · Relay VPS (`relay.hypnotype.mangocloud.cyou`)

Any small IPv4 server. As root:

```bash
# 1) Bun
curl -fsSL https://bun.sh/install | bash

# 2) Relay code (from this tarball)
mkdir -p /opt/hipno-relay && cd /opt/hipno-relay
# copy mini-services/relay/{index.ts,package.json} here, then:
bun install

# 3) systemd unit (from deploy/systemd/hipno-relay.service)
cp deploy/systemd/hipno-relay.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now hipno-relay
# relay listens on 127.0.0.1:3005

# 4) Caddy TLS in front (apt install caddy), /etc/caddy/Caddyfile:
cat >/etc/caddy/Caddyfile <<'EOF'
relay.hypnotype.mangocloud.cyou {
    encode zstd gzip
    handle /api/v1/*      { reverse_proxy 127.0.0.1:3005 }
    handle /tunnel-socket { reverse_proxy 127.0.0.1:3005 }
    handle /server/panel/* {
        reverse_proxy 127.0.0.1:3005
        # long-lived WebSocket pass-through, no buffering
        flush_interval -1
        transport http {
            read_timeout 24h
            write_timeout 24h
            response_header_timeout 24h
        }
    }
    handle /healthz { reverse_proxy 127.0.0.1:3005 }
    handle { respond 404 }
}
EOF
systemctl reload caddy

# 5) firewall (keep SSH + web only)
nft add table inet hipno-relay 2>/dev/null || true
```

Verify: `curl https://relay.hypnotype.mangocloud.cyou/healthz` → `ok`.

> The relay stores only SHA-256 hashes (token, tunnel secret, install nonce) in
> `/opt/hipno-relay/data/relay-store.json` — no panel data, no plaintext tokens.

---

## 3 · Panel VPS — one command

On the server that will run the panel (KVM VPS, Ubuntu 22.04/24.04 or Debian 12):

```bash
curl -fsSL https://hypnotype.mangocloud.cyou/install.sh | sudo bash
```

The installer (single source: `installer/install.sh`, served byte-identical
from the website):

- installs **Bun** (panel runtime) + **Node.js 22** (terminal PTY service) + **Docker Engine** (apps module)
- pulls the panel source (GitHub release or `--src ./tarball`) and builds it on the machine
- creates systemd units `hipnod` (panel, 127.0.0.1:3000) + `hipno-terminal` (127.0.0.1:3004)
- state in `/var/lib/hipno`, config in `/etc/hipno`, install log `/var/log/hipno-install.log`
- **connects OUT to `https://relay.hypnotype.mangocloud.cyou`** and registers
- prints the access URL + one-time admin password:

```
 ┌──────────────────────────────────────────────────────────────────────┐
 │  HipnoType Panel installed successfully                              │
 │  Panel URL : https://hypnotype.mangocloud.cyou/server/panel/<32-chars>/
 │  Email     : admin@hypnotype.mangocloud.cyou                         │
 │  Password  : (temporary, shown ONCE — change on first login)         │
 └──────────────────────────────────────────────────────────────────────┘
```

Open the panel URL — first login forces a password change and offers 2FA.

Useful flags: `--src <path|url>` (install from the tarball instead of GitHub),
`--version <tag>`, `--no-docker`, `--mode direct --domain <domain>` (skip the
relay, needs DNS + ports 80/443 on the panel VPS), `--uninstall`.

### Panel-side environment variables (optional overrides)

The panel reads these from `/etc/hipno/hipno.env` (create + `systemctl restart hipnod`):

| Variable | Default | Purpose |
|---|---|---|
| `HIPNO_RELAY_URL` | `https://relay.hypnotype.mangocloud.cyou` | Relay the tunnel dials |
| `HIPNO_TERMINAL_PORT` | `3004` | PTY service port (localhost only) |
| `HIPNO_PANEL_PORT` | `3000` | Panel listen port (localhost only) |
| `HIPNO_SECRET_KEY` | generated at install | AES-256-GCM master key (tokens/secrets at rest) |
| `HIPNO_DATA_DIR` | `/var/lib/hipno` | State + app files root |

---

## 4 · Post-install checklist

- [ ] `https://hypnotype.mangocloud.cyou/server/panel/<token>/` loads the panel
- [ ] Terminal opens a real shell through the tunnel (WebSockets via the Vercel rewrite)
- [ ] Domains & DNS → Add zone (Cloudflare) → paste API token → **verified** chip (real token check + write probe)
- [ ] "From Cloudflare" import pulls your existing records
- [ ] Websites → Add site wizard shows the VPS's **real public IP** in the DNS table
- [ ] Apps → deploy an app (needs Docker — the installer adds it); without Docker the panel refuses honestly
- [ ] Files → edit + save a file; external modification triggers the conflict dialog
- [ ] Settings → Access URL → rotate token (old URL dies in seconds, sessions revoked)

## 5 · Updating

```bash
curl -fsSL https://hypnotype.mangocloud.cyou/install.sh | sudo bash   # idempotent upgrade
```

Website changes: push to GitHub → Vercel redeploys. Keep
`website/public/install.sh` in sync with `installer/install.sh` and refresh
the download mirrors after every release — both happen automatically with:

```bash
bash scripts/make-release.sh        # regenerates website/ + all tarballs + mirrors
```
