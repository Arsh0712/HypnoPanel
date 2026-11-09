/**
 * Website docs content — single source of truth for /docs pages.
 *
 * Written from the real implemented behaviour of the panel (v1.0.x):
 * CLI reference mirrors scripts/hypno.mjs, relay model mirrors
 * mini-services/relay + docs/RELAY.md, module docs mirror the API surface.
 * Do not document features that do not exist.
 */

export type DocBlock =
  | { t: "p"; text: string }
  | { t: "h2" | "h3"; text: string }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "code"; lang?: string; code: string; title?: string }
  | { t: "callout"; variant: "info" | "warn" | "danger" | "success"; title?: string; text: string }
  | { t: "table"; head: string[]; rows: string[][] };

export interface DocPage {
  slug: string;
  title: string;
  section: string;
  order: number;
  description: string;
  updated: string;
  blocks: DocBlock[];
}

export const DOC_SECTIONS = ["Getting started", "Guides", "Reference", "Operations"] as const;

export const DOC_PAGES: DocPage[] = [
  // ------------------------------------------------------------- Getting started
  {
    slug: "getting-started",
    title: "Getting started",
    section: "Getting started",
    order: 1,
    description: "From the install command to your first website, app or bot — the 5-minute tour.",
    updated: "2026-11-08",
    blocks: [
      { t: "p", text: "HipnoType Panel manages **one VPS**: everything you see in the panel runs on the machine it is installed on. There is no cloud control plane — the panel is the whole product, and its access URL is a secret." },
      { t: "h2", text: "1 · Install" },
      { t: "p", text: "On a fresh KVM VPS (Ubuntu 22.04/24.04, Debian 12, AlmaLinux 9 or Rocky 9), run:" },
      { t: "code", lang: "bash", code: "curl -fsSL https://hypnotype.mangocloud.cyou/install.sh | sudo bash" },
      { t: "p", text: "The installer prints a boxed summary containing your **panel URL** (a random 32-character secret path), the admin email, and a temporary password shown exactly once. Full details on the [Install page](/install)." },
      { t: "h2", text: "2 · Unlock the panel" },
      { t: "ul", items: [
        "Open the printed URL — `https://hypnotype.mangocloud.cyou/server/panel/<32 chars>/`",
        "The unlock screen asks for email + password. Use the temporary password from the installer.",
        "You are immediately forced to set a new password (policy-enforced).",
        "You are offered TOTP two-factor auth — scan the QR code with any authenticator app and save the recovery codes.",
      ]},
      { t: "callout", variant: "warn", title: "Keep the URL secret", text: "Anyone who knows the URL reaches your login screen. Rotate it any time with `hypno rotate` (all sessions are revoked)." },
      { t: "h2", text: "3 · The tour" },
      { t: "ul", items: [
        "**Dashboard** — live CPU, memory, disk, network, load and recent audit events.",
        "**Websites** — create static / PHP / Node / reverse-proxy sites, attach certificates, preview them.",
        "**Domains & DNS** — add domains, connect Cloudflare, import and sync records.",
        "**Apps** — one-click templates (WordPress, Ghost, n8n, Gitea, PostgreSQL…) or Git-built apps.",
        "**Files** — a full file workspace with an editor, archive tools and a trash bin.",
        "**Terminal** — a real shell in your browser (PTY when available).",
        "**Firewall, Backups, Cron, Monitoring** — the rest of the ops toolbox.",
      ]},
      { t: "h2", text: "4 · Where to go next" },
      { t: "ul", items: [
        "[Requirements & compatibility](/docs/requirements) — which VPS types are supported.",
        "[The access URL](/docs/access-url) — how the secret URL and rotation work.",
        "[Domains & DNS](/docs/domains-dns) — connect Cloudflare in two minutes.",
      ]},
    ],
  },
  {
    slug: "requirements",
    title: "Requirements & compatibility",
    section: "Getting started",
    order: 2,
    description: "Supported virtualization types, operating systems and sizing — what works where, honestly.",
    updated: "2026-11-08",
    blocks: [
      { t: "p", text: "HipnoType needs a real kernel for nftables, cgroups v2 and Docker. The installer checks this during preflight and refuses environments it cannot support honestly." },
      { t: "h2", text: "Virtualization matrix" },
      { t: "table", head: ["Environment", "Install", "Notes"], rows: [
        ["KVM / QEMU", "✔ Full support", "The recommended target. All features work."],
        ["Bare metal, Xen, VMware, Hyper-V", "✔ Full support", "Treated as full when the capability checks pass; bare metal asks for `HIPNO_ALLOW_BAREMETAL=1`."],
        ["LXC / LXD container", "◐ Feature-gated", "Needs `security.nesting=true` for Docker; some kernel features are skipped with an honest status."],
        ["Docker / Podman container", "◐ Restricted", "Panel + proxy run; nested container workloads are unavailable and reported as such."],
        ["OpenVZ / Virtuozzo", "✘ Refused", "No real kernel — the installer refuses unless forced with `--force` for a limited panel-only mode."],
      ]},
      { t: "h2", text: "Operating systems" },
      { t: "table", head: ["OS", "Versions", "Arch"], rows: [
        ["Ubuntu", "22.04, 24.04", "x86_64, arm64"],
        ["Debian", "12", "x86_64, arm64"],
        ["AlmaLinux", "9", "x86_64"],
        ["Rocky Linux", "9", "x86_64"],
      ]},
      { t: "h2", text: "Sizing" },
      { t: "table", head: ["Resource", "Minimum", "Comfortable"], rows: [
        ["RAM", "1 GB", "2 GB+ (Docker templates)"],
        ["Disk", "10 GB free", "20 GB+"],
        ["Network", "Outbound 443 (relay + releases)", "—"],
      ]},
      { t: "callout", variant: "info", text: "The panel itself opens **no inbound ports**. It reaches the internet through an outbound tunnel to the relay, which is why it also works behind NATs and firewalls." },
      { t: "h2", text: "Conflicts" },
      { t: "p", text: "The installer refuses to run alongside aaPanel, CyberPanel, CloudPanel, cPanel, Plesk or Coolify — one control panel per VPS." },
    ],
  },
  {
    slug: "access-url",
    title: "The access URL & rotation",
    section: "Getting started",
    order: 3,
    description: "How the secret /server/panel/<token>/ URL works, how to rotate it, and what happens to sessions.",
    updated: "2026-11-08",
    blocks: [
      { t: "p", text: "Every panel install gets a URL like `https://hypnotype.mangocloud.cyou/server/panel/vDVB3ic7…/`. The 32-character suffix **is** the credential that routes traffic to your VPS — the relay only knows a salted hash of it, and unknown tokens return a byte-identical 404 so URLs cannot be enumerated." },
      { t: "h2", text: "How traffic flows" },
      { t: "ol", items: [
        "Your VPS opens an **outbound** WebSocket tunnel to the HipnoType relay (hipno-relay.mangocloud.cyou). Nothing listens publicly on the VPS.",
        "Your browser talks to the main domain; `/server/panel/<token>/*` is rewritten to the relay.",
        "The relay matches the token hash, finds your tunnel, and proxies the request through it.",
      ]},
      { t: "callout", variant: "info", text: "If your VPS goes down, its URL returns a clear 503 'tunnel offline' — no silent hangs." },
      { t: "h2", text: "Rotating the URL" },
      { t: "code", lang: "bash", code: "hypno rotate                # random 32 chars\nhypno rotate --custom my-secret-slug-123   # custom slug, 16–64 chars" },
      { t: "p", text: "Rotation is **two-phase**: the relay activates the new token first; only when the panel commits locally does the old token stop working. A failed commit rolls the relay back — you can never lock yourself out with a half-finished rotation." },
      { t: "ul", items: [
        "All active sessions (web + CLI) are revoked on every rotation.",
        "The old URL immediately returns the standard 404.",
        "Every rotation is written to the audit log (who, when, fingerprints).",
      ]},
      { t: "h2", text: "Direct mode (own domain, own TLS)" },
      { t: "p", text: "If you do not want the relay in your traffic path, the panel supports **direct mode**: it serves its own certificate on port 443 under a domain you control, keeping the same secret-path model. See [the relay trust model](/docs/relay-trust)." },
    ],
  },

  // ------------------------------------------------------------------- Guides
  {
    slug: "domains-dns",
    title: "Domains & DNS",
    section: "Guides",
    order: 4,
    description: "Add domains, connect Cloudflare with a scoped API token, import records and sync both ways.",
    updated: "2026-11-08",
    blocks: [
      { t: "p", text: "The Domains & DNS module manages DNS for **domains you add** — it never touches anything else on your Cloudflare account." },
      { t: "h2", text: "Connect Cloudflare" },
      { t: "ol", items: [
        "In Cloudflare, create a scoped **API token** (My Profile → API Tokens → Create Token → *Edit zone DNS* template).",
        "Required permissions: **Zone → Zone → Read** and **Zone → DNS → Edit**, scoped to the zone(s) you will manage.",
        "Paste the token into the panel (Domains & DNS → Connect). The panel verifies the token against Cloudflare, lists the zones it can see, and stores it **AES-256-GCM encrypted** — it is never shown again (only a fingerprint like `····Fe`).",
      ]},
      { t: "callout", variant: "warn", title: "Use an API token, not the Global API key", text: "A scoped token can only touch the zones you chose. The Global API Key grants your whole account — the panel accepts it with a warning, but a scoped token is the recommended setup." },
      { t: "h2", text: "Import & sync" },
      { t: "ul", items: [
        "**Import** pulls every existing record of the zone into the panel (with Cloudflare record IDs, proxied state, TTL) so you see exactly what Cloudflare sees.",
        "**Sync** is a diff-based two-way flow: the panel compares local records against Cloudflare and shows you `+ create`, `~ update`, `− delete` — nothing is applied before you confirm.",
        "Records are tagged by source: *Cloudflare* (imported), *HipnoType-managed* (created by the panel, carrying a managed comment) and *Local only*.",
        "The panel never edits or deletes a record it does not own without your explicit confirmation.",
      ]},
      { t: "h2", text: "Records the panel needs" },
      { t: "p", text: "When you add a website, the panel shows the exact records it wants (with live verify status):" },
      { t: "table", head: ["Record", "Purpose"], rows: [
        ["`A` / `AAAA` → your VPS public IP", "Point the domain at this server"],
        ["`_hipno-challenge` TXT", "Ownership proof for the domain"],
        ["`MX`, SPF, DKIM, DMARC (mail only)", "Mail delivery + anti-spoofing, added when you enable mail on the domain"],
      ]},
      { t: "p", text: "If the zone is connected to Cloudflare, the panel offers to create and maintain these records for you; otherwise it verifies them with live DNS queries and shows ✓ / ✗ / wrong-value per record." },
      { t: "h2", text: "Validation" },
      { t: "p", text: "Every record is validated before it is stored or sent: CNAME exclusivity, MX targets must be hostnames (not IPs), TXT chunking over 255 characters, TTL limits, duplicate detection and trailing-dot normalisation. Cloudflare errors are shown verbatim when a write is rejected." },
    ],
  },
  {
    slug: "websites",
    title: "Websites & projects",
    section: "Guides",
    order: 5,
    description: "Static, PHP, Node and reverse-proxy sites with real files on disk, vhost configs, SSL and preview.",
    updated: "2026-11-08",
    blocks: [
      { t: "p", text: "A website in HipnoType is real from the first second: files on disk, a generated Caddy vhost config, logs directory, optional certificate — no simulated states." },
      { t: "h2", text: "Create a site" },
      { t: "ol", items: [
        "Websites → **Add website** → pick a name; the panel derives a slug, a docroot (`data/sites/<slug>/htdocs`) and a Linux user (`site-<slug>`).",
        "Choose a type: **static** (file root), **PHP** (PHP-FPM pool, version selectable), **Node** (managed entrypoint on a per-site port) or **reverse proxy** (upstream URL).",
        "Add the domain you pointed at this VPS (see [Domains & DNS](/docs/domains-dns)). The panel verifies DNS and offers a `www` variant.",
      ]},
      { t: "h2", text: "What you get" },
      { t: "ul", items: [
        "**Files** — the site docroot opens directly in the [file workspace](/docs/files): edit, upload, archive.",
        "**Config** — the generated Caddyfile-format vhost (gzip, security headers, blocked `/.git/*` and `/.env`, redirects, cache headers) — real config, editable view.",
        "**SSL** — attach a custom certificate or issue a self-signed one per site; force-HTTPS is one toggle.",
        "**Preview** — every site is previewable from the panel (served from its real docroot).",
        "**Logs** — access/error log locations per site.",
      ]},
      { t: "h2", text: "PHP & Node specifics" },
      { t: "p", text: "PHP sites get a dedicated PHP-FPM pool (dynamic workers, per-site upload limits) on a deterministic port; Node sites get a managed entrypoint with a deterministic port and a reverse-proxy vhost. Both configs are generated on creation and visible in the site's Config tab." },
    ],
  },
  {
    slug: "apps",
    title: "Apps",
    section: "Guides",
    order: 6,
    description: "Deploy real applications — 22 one-click templates or any Git repository — with logs, env vars and rollbacks.",
    updated: "2026-11-08",
    blocks: [
      { t: "p", text: "Apps run as containers. The panel detects the local Docker engine and shows its honest status — if Docker is missing you get a real install action, never a fake 'staged' deploy." },
      { t: "h2", text: "Create from a template" },
      { t: "p", text: "Apps → **Deploy App** → pick from the catalogue: WordPress, Ghost, n8n, Uptime Kuma, Vaultwarden, Nextcloud, Gitea, PostgreSQL, MySQL, Redis, MinIO, Plausible, Metabase, Grafana, Adminer and more (22 templates across CMS, automation, security, files, dev, database and analytics categories)." },
      { t: "p", text: "Each template declares its ports, volumes and required environment variables — the form asks exactly for those, validates them, and offers sensible defaults." },
      { t: "h2", text: "Create from Git" },
      { t: "p", text: "Choose the Git source, paste a repository URL and branch. The panel stages a compose build for the app (`docker compose` based) — the generated compose file is a **real input**: you can inspect and edit it in the app's settings before deploying." },
      { t: "h2", text: "Managing an app" },
      { t: "ul", items: [
        "**Actions** — start, stop, restart, redeploy, pull latest — with live status and exit codes.",
        "**Environment** — key/value editor per app; secret values are masked in the UI and redacted from logs.",
        "**Logs** — container logs with filters, straight from the Docker engine.",
        "**Deployments** — history of deploys with rollback to the previous release.",
        "**Domains** — map a domain you added to the app's port (through the site reverse-proxy flow).",
      ]},
      { t: "callout", variant: "info", text: "Every app action is audit-logged with the actor, the app and the result." },
    ],
  },
  {
    slug: "bots",
    title: "Bots & workers",
    section: "Guides",
    order: 7,
    description: "Run Discord, Telegram, Slack and other bots on your VPS today — the honest, container-native path.",
    updated: "2026-11-08",
    blocks: [
      { t: "p", text: "There is no separate 'bot wizard' in v1.0 — and we will not pretend otherwise. Bots are long-running processes, and the panel already runs those well as **apps**. Here is the real, working path:" },
      { t: "h2", text: "Option 1 · Public bot image" },
      { t: "ol", items: [
        "Apps → **Deploy from Git** and point it at your bot's repository (a `Dockerfile` that installs `requirements.txt` / `package.json` and starts the bot).",
        "Set the token as an environment variable (e.g. `DISCORD_TOKEN`, `TELEGRAM_BOT_TOKEN`) — the env editor masks secret values.",
        "Start it. Use **Logs** to watch it connect, **Actions** to restart, and the crash exit code is shown on the app.",
      ]},
      { t: "h2", text: "Option 2 · Any registry image" },
      { t: "p", text: "If your bot ships as a Docker image, deploy it via the Git/compose flow with `image:` set — the compose editor lets you set the image, env, restart policy and resource limits directly." },
      { t: "h2", text: "Keeping bots alive" },
      { t: "ul", items: [
        "Set `restart: unless-stopped` in the compose file so the bot survives reboots and crashes.",
        "Keep tokens out of the code — env vars only; the panel stores them encrypted at rest.",
        "Watch resource usage per app; bots are usually tiny.",
      ]},
      { t: "callout", variant: "info", title: "Roadmap honesty", text: "A dedicated Bots category with Python/Node starter templates (discord.py, discord.js, python-telegram-bot, grammY) is tracked publicly in the repository issues — it will ship when it is real, not before." },
    ],
  },
  {
    slug: "files",
    title: "Files",
    section: "Guides",
    order: 8,
    description: "The IDE-grade file workspace: tree, editor, archives, uploads, trash and safe operations.",
    updated: "2026-11-08",
    blocks: [
      { t: "p", text: "The Files module is a real file workspace — every operation touches the actual filesystem and is audit-logged." },
      { t: "h2", text: "The workspace" },
      { t: "ul", items: [
        "**Tree** — lazy-loaded directory tree rooted at the panel's data directory (site docroots, databases, backups, app volumes), with per-role access.",
        "**Editor** — Monaco (the VS Code editor) with syntax highlighting for code and config; unsaved-changes indicator and Ctrl/Cmd+S save.",
        "**Search** — quick file-name search across the tree.",
      ]},
      { t: "h2", text: "Operations" },
      { t: "ul", items: [
        "Create / rename / move / copy / delete files and folders (delete goes to the **trash** with restore).",
        "Upload files (drag & drop), download files, and archive/extract `.zip` / `.tar.gz` with zip-slip and size protection.",
        "Permissions and ownership shown per node; disk usage per directory.",
      ]},
      { t: "h2", text: "Safety" },
      { t: "ul", items: [
        "All paths are canonicalised and jailed to the allowed root — traversal attempts are rejected.",
        "Blocked system paths (`/proc`, `/sys`, `/dev`, `/boot`, the panel's own keys) are denied for writes.",
        "Heavy operations are rate-limited per session.",
      ]},
    ],
  },
  {
    slug: "terminal",
    title: "Terminal",
    section: "Guides",
    order: 9,
    description: "A real shell in your browser — PTY when available, ticket-authenticated, role-limited.",
    updated: "2026-11-08",
    blocks: [
      { t: "p", text: "The terminal gives you the VPS shell without SSH. It is a real terminal emulator (xterm.js) attached to a real shell process." },
      { t: "h2", text: "How to open it" },
      { t: "p", text: "Terminal in the sidebar. Only **admin** and **developer** roles can open shells; viewers cannot." },
      { t: "h2", text: "Authentication" },
      { t: "p", text: "When you open the terminal, the panel issues a **single-use, 30-second ticket** bound to your session. The terminal service redeems that ticket against the panel before spawning your shell — so the shell never trusts a bare WebSocket connection. Terminal content is never logged; only session lifecycle events are." },
      { t: "h2", text: "PTY vs pipe mode" },
      { t: "ul", items: [
        "**PTY mode** (node-pty available): full interactive shell — colours, tab-completion, resize, `htop`.",
        "**Pipe mode** (fallback): the shell still runs, but without full terminal emulation — the panel says which mode you are in.",
      ]},
      { t: "h2", text: "Limits" },
      { t: "table", head: ["Limit", "Value"], rows: [
        ["Concurrent sessions per user", "5"],
        ["Idle timeout", "15 minutes"],
        ["Hard session cap", "60 minutes (open a new shell after)"],
      ]},
    ],
  },
  {
    slug: "firewall",
    title: "Firewall",
    section: "Guides",
    order: 10,
    description: "nftables rules with a 60-second rollback safety net and honest backend detection.",
    updated: "2026-11-08",
    blocks: [
      { t: "p", text: "The firewall module drives **nftables** on the host. If nftables is not available (some containers), the panel says so instead of pretending." },
      { t: "h2", text: "Rules" },
      { t: "ul", items: [
        "Allow/deny rules by port, protocol and source CIDR.",
        "SSH and the panel's ports are protected from accidental lockout — the module refuses rules that would cut your own access.",
        "fail2ban status is surfaced alongside (when installed).",
      ]},
      { t: "h2", text: "The 60-second safety net" },
      { t: "p", text: "Applying a ruleset enters a **pending confirmation** state: you have 60 seconds to confirm it worked. If you do not confirm (because you locked yourself out), the previous ruleset is automatically restored." },
      { t: "code", lang: "bash", code: "hypno firewall status   # backend availability, ports, pending confirmation" },
    ],
  },
  {
    slug: "backups",
    title: "Backups",
    section: "Guides",
    order: 11,
    description: "Create, verify, inspect, restore and download backups — with checksums and retention.",
    updated: "2026-11-08",
    blocks: [
      { t: "p", text: "Backups bundle the panel database, site files and configuration into versioned, checksummed archives on the VPS." },
      { t: "ul", items: [
        "**Create** — on demand or on a schedule (cron module integration).",
        "**Verify** — every backup stores a checksum; `verify` re-checks integrity any time.",
        "**Inspect** — see the contents of an archive before restoring anything.",
        "**Restore** — full restore flow with confirmation; the panel tells you exactly what will be overwritten.",
        "**Download** — pull any backup to your machine.",
      ]},
      { t: "code", lang: "bash", code: "hypno backup now\nhypno backup list\nhypno backup verify <id>" },
      { t: "callout", variant: "warn", text: "Backups live on the same VPS by default. For real disaster recovery, download them regularly or sync the backup directory off-site — a backup that dies with its server is not a backup." },
    ],
  },
  {
    slug: "email",
    title: "Email domains",
    section: "Guides",
    order: 12,
    description: "Add mail domains, verify their DNS (MX, SPF, DKIM, DMARC), manage mailboxes and aliases.",
    updated: "2026-11-08",
    blocks: [
      { t: "p", text: "The mail module manages mail **domains**: the DNS side and the mailbox/alias inventory." },
      { t: "h2", text: "Add a mail domain" },
      { t: "p", text: "Email → add the domain. The panel generates the exact DNS records needed and checks them live:" },
      { t: "table", head: ["Record", "Purpose"], rows: [
        ["`MX`", "Where mail for the domain is delivered"],
        ["`TXT` (SPF)", "Which servers may send as the domain (exactly one SPF record is enforced)"],
        ["`TXT` (DKIM)", "Signing key for the selector"],
        ["`TXT` (DMARC)", "Policy for spoofed mail"],
      ]},
      { t: "p", text: "Each check shows a live ✓ / ✗ with the value it found. When the domain's zone is connected via Cloudflare, the panel offers to create and maintain these records for you." },
      { t: "h2", text: "Mailboxes & aliases" },
      { t: "p", text: "Manage the mailbox list and alias forwarding rules per domain from the same screen. The module is an inventory + DNS manager — the mail server itself (SMTP/IMAP) is expected to run as an app on the VPS if you need full mail hosting." },
    ],
  },

  // ----------------------------------------------------------------- Reference
  {
    slug: "cli",
    title: "CLI reference",
    section: "Reference",
    order: 13,
    description: "Every `hypno` command — status, rotate, doctor, backups, firewall, reset and more.",
    updated: "2026-11-08",
    blocks: [
      { t: "p", text: "The `hypno` CLI runs on the VPS as root (it authenticates with the root-only CLI token). On the development preview it is `bun scripts/hypno.mjs <command>`." },
      { t: "code", lang: "text", code: `hypno status [--json]         Panel, tunnel, proxy, DB and Docker health
hypno url                     Print the current access URL path
hypno rotate [--custom <slug>] [--yes]
                              Rotate the access URL (random 32 chars, or custom slug 16-64)
hypno credentials             Show admin email(s) — never passwords
hypno reset emailpass         Interactive reset: new email + password
hypno reset password [--random | --password-stdin]
                              Reset only the password
hypno reset email             Reset only the admin email
hypno 2fa disable             Disable 2FA for an admin (typed email confirmation)
hypno sessions list|revoke-all
hypno start | stop | restart  Panel service control (systemd)
hypno logs [-n 200]           Panel log tail
hypno tunnel status|restart   Relay tunnel state, latency, server ID, access URL
hypno firewall status [--ruleset]
hypno backup now|list|verify <id>
hypno update [--check]        Channel + real GitHub release check
hypno doctor [--json]         PASS/FAIL diagnostics with fix suggestions
hypno config get [key] | set <key> <value>
hypno version
hypno uninstall               Typed confirmation (REMOVE / REMOVE-DATA)
hypno completion bash|zsh|fish` },
      { t: "h2", text: "Examples" },
      { t: "code", lang: "console", code: `$ hypno doctor
PASS  Panel API — HTTP 200          PASS  Relay tunnel — connected
PASS  Data directory — present       PASS  Disk space — root usage 46%
PASS  Secret key — present           PASS  Clock skew — 10s
PASS  CLI token — present            FAIL  KVM virtualization — detected: docker
PASS  Backups dir — present
PASS  secret.key mode — 0600
9/10 checks passed` },
      { t: "p", text: "Every mutating CLI action is audit-logged with source `local-cli`." },
    ],
  },
  {
    slug: "api",
    title: "HTTP API",
    section: "Reference",
    order: 14,
    description: "The panel's HTTP API — session-cookie for the browser, Bearer CLI token for automation.",
    updated: "2026-11-08",
    blocks: [
      { t: "p", text: "Everything the panel UI does goes through its HTTP API under `/api/*` on your panel URL. Two authentication methods exist:" },
      { t: "table", head: ["Method", "How", "Used by"], rows: [
        ["Session cookie", "POST /api/auth/login → Set-Cookie `hipno_session`", "The browser UI"],
        ["Bearer token", "`Authorization: Bearer <cli-token>` (root-only file `data/cli-token.json`)", "The `hypno` CLI, automation"],
      ]},
      { t: "h2", text: "A few endpoints" },
      { t: "table", head: ["Endpoint", "Purpose"], rows: [
        ["`GET /api/auth/session`", "Current session + user"],
        ["`GET /api/system/overview`", "Version, uptime, host info"],
        ["`GET /api/dashboard/live`", "Live CPU/mem/disk/net metrics"],
        ["`GET /api/websites` · `POST /api/websites`", "List / create websites"],
        ["`GET /api/dns/zones`", "DNS zones + Cloudflare link state"],
        ["`GET /api/apps` · `POST /api/apps`", "List / create apps"],
        ["`GET /api/audit`", "Audit log (paginated, filterable)"],
        ["`GET /api/system/tunnel`", "Relay tunnel status + access URL"],
      ]},
      { t: "p", text: "Errors are JSON: `{ \"error\": \"…\", \"code\": \"…\" }` with a meaningful HTTP status. All list endpoints are paginated; all mutating endpoints are audit-logged and role-checked (admin / developer / viewer)." },
      { t: "callout", variant: "info", text: "The full machine-readable surface is the code itself — every route lives in the repository under `panel/src/app/api/`, and the OpenAPI-style inventory is kept in `docs/API.md`." },
    ],
  },

  // ---------------------------------------------------------------- Operations
  {
    slug: "updates",
    title: "Updates",
    section: "Operations",
    order: 15,
    description: "How the panel checks for and applies updates — and how to upgrade manually.",
    updated: "2026-11-08",
    blocks: [
      { t: "h2", text: "Check for updates" },
      { t: "code", lang: "bash", code: "hypno update --check   # compares the installed version against GitHub releases" },
      { t: "p", text: "The check queries the repository's real releases — no fake channels. The panel's Settings → About screen shows the same information." },
      { t: "h2", text: "Apply an update" },
      { t: "ol", items: [
        "`hypno backup now` — always take a backup first.",
        "Re-run the installer: `curl -fsSL https://hypnotype.mangocloud.cyou/install.sh | sudo bash` — it is idempotent and upgrades in place (config, database and data are preserved).",
        "`hypno doctor` — confirm everything is healthy after the upgrade.",
      ]},
      { t: "callout", variant: "info", text: "Your access URL, users, sessions, sites and settings survive updates. Sessions are only revoked when you rotate the URL." },
    ],
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    section: "Operations",
    order: 16,
    description: "Doctor output, locked out, tunnel offline, blank page — real fixes for real situations.",
    updated: "2026-11-08",
    blocks: [
      { t: "h2", text: "First: run the doctor" },
      { t: "code", lang: "bash", code: "hypno doctor --json   # machine-readable, with fix suggestions" },
      { t: "h2", text: "Common situations" },
      { t: "h3", text: "I am locked out of the panel" },
      { t: "ul", items: [
        "SSH in and run `hypno reset password --random` (prints a one-time password) or `hypno reset emailpass`.",
        "Lost 2FA? `hypno 2fa disable` (typed email confirmation, audit-logged).",
        "URL compromised or forgotten? `hypno rotate` issues a fresh one (requires CLI auth on the box).",
      ]},
      { t: "h3", text: "The panel URL returns 503 'tunnel offline'" },
      { t: "ul", items: [
        "Your VPS is down or the panel service stopped — check `systemctl status hipnod` and `hypno tunnel status`.",
        "`hypno tunnel restart` re-establishes the outbound tunnel.",
        "The relay being briefly unavailable also shows as offline — it recovers automatically (the tunnel client reconnects with backoff).",
      ]},
      { t: "h3", text: "The panel page loads but is blank" },
      { t: "ul", items: [
        "Check `hypno logs -n 100` for server-side errors.",
        "A browser hard-refresh (Ctrl/Cmd+Shift+R) clears stale chunks after an update.",
        "Check the browser console for blocked requests and report the exact messages if they persist.",
      ]},
      { t: "h3", text: "Docker apps fail to deploy" },
      { t: "ul", items: [
        "`hypno status` shows the honest Docker backend state — install Docker from the Apps screen if it is missing.",
        "On LXC containers, Docker needs `security.nesting=true` on the host (see [Requirements](/docs/requirements)).",
      ]},
    ],
  },
  {
    slug: "security",
    title: "Security",
    section: "Operations",
    order: 17,
    description: "Authentication, encryption, the audit hash chain, and the hardening the panel applies to itself.",
    updated: "2026-11-08",
    blocks: [
      { t: "h2", text: "Authentication" },
      { t: "ul", items: [
        "Passwords are hashed with **Argon2id**; a policy is enforced on every change.",
        "Brute-force **lockout** with progressive delays on the login screen.",
        "**TOTP 2FA** with recovery codes; forced password change on first login.",
        "Sessions are server-side, revocable (individually or all), and expire.",
        "Three roles: admin, developer, viewer — checked server-side on every API call.",
      ]},
      { t: "h2", text: "Secrets & encryption" },
      { t: "ul", items: [
        "Provider tokens (Cloudflare) and 2FA secrets are encrypted at rest with **AES-256-GCM** using a per-install key.",
        "Secrets are never returned to the browser — only fingerprints (`····Fe`).",
        "Terminal access uses **single-use 30-second tickets**, not long-lived tokens.",
      ]},
      { t: "h2", text: "Audit log" },
      { t: "p", text: "Every meaningful action (logins, DNS writes, app deploys, firewall changes, rotations…) is written to an append-only audit log that forms a **hash chain** — tampering with an entry breaks the chain and is detectable (`GET /api/audit/verify`)." },
      { t: "h2", text: "Self-hardening" },
      { t: "ul", items: [
        "The panel runs as its own system user with a hardened systemd unit (no root).",
        "Firewall changes require confirmation within 60 seconds or they roll back.",
        "The web surface is a secret URL with byte-identical 404s for unknown tokens and per-IP rate limiting/bans at the relay.",
      ]},
      { t: "h2", text: "Reporting a vulnerability" },
      { t: "p", text: "Open a **private** security advisory at `github.com/Arsh0712/HypnoPanel/security/advisories/new` — never a public issue. Response target: 72 hours." },
    ],
  },
  {
    slug: "relay-trust",
    title: "The relay trust model",
    section: "Operations",
    order: 18,
    description: "What the relay can and cannot see, and how to remove it from your traffic path entirely.",
    updated: "2026-11-08",
    blocks: [
      { t: "p", text: "In the default **relay mode**, your browser's HTTPS connection terminates at the HipnoType relay, which forwards requests to your VPS over the outbound tunnel. This is the same trust position as a CDN or Cloudflare Tunnel: the relay operator can technically observe traffic." },
      { t: "h2", text: "What the relay stores" },
      { t: "ul", items: [
        "Only hashes: sha256 of your access token, tunnel secret and install nonce.",
        "No panel passwords, no sessions, no request bodies — the reference implementation is public in the repository (`relay/`).",
      ]},
      { t: "h2", text: "What the relay protects against" },
      { t: "ul", items: [
        "Token enumeration — unknown tokens get a byte-identical 404 with normalised latency.",
        "Abuse — per-IP rate limits and temporary bans for repeated unknown-token hits.",
        "Your VPS exposure — zero inbound ports; the tunnel is outbound-only.",
      ]},
      { t: "h2", text: "Removing the relay from the path" },
      { t: "p", text: "If the relay's trust position is not acceptable, switch to **direct mode**: the panel serves its own ACME certificate on port 443 at a domain you control, keeping the secret-path model (`panel.example.com/server/panel/<token>/`). You lose the shared-domain convenience and take over DNS + TLS for the panel host yourself." },
      { t: "callout", variant: "info", text: "Anyone can run their own relay — the implementation and deployment pack are in the repository (`relay/deploy/`). Running the relay on infrastructure you control puts you fully back in charge." },
    ],
  },
  {
    slug: "uninstalling",
    title: "Uninstalling",
    section: "Operations",
    order: 19,
    description: "Clean removal — services, files, and the relay registration — with your data's fate under your control.",
    updated: "2026-11-08",
    blocks: [
      { t: "p", text: "Two paths, both typed-confirmation protected:" },
      { t: "code", lang: "bash", code: "curl -fsSL https://hypnotype.mangocloud.cyou/install.sh | sudo bash -s -- --uninstall\n# or, on the box:\nhypno uninstall" },
      { t: "table", head: ["Choice", "What happens"], rows: [
        ["`REMOVE`", "Stops and disables the services. All data is kept under /var/lib/hipno for manual removal."],
        ["`REMOVE-DATA`", "Also deregisters from the relay and deletes panel files, data, backups and logs."],
      ]},
      { t: "callout", variant: "warn", text: "`REMOVE-DATA` deletes sites, databases, apps state and backups on that VPS. Download what you need first (`hypno backup list` → download)." },
    ],
  },
];

export const DOC_PAGE_BY_SLUG = new Map(DOC_PAGES.map((p) => [p.slug, p]));

export function docsBySection(): { section: string; pages: DocPage[] }[] {
  return DOC_SECTIONS.map((section) => ({
    section,
    pages: DOC_PAGES.filter((p) => p.section === section).sort((a, b) => a.order - b.order),
  })).filter((g) => g.pages.length > 0);
}
