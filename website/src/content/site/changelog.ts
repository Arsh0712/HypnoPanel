/** Website changelog data — mirrors the repository CHANGELOG.md. */

export interface ChangelogEntry {
  version: string;
  date: string;
  title?: string;
  items: { group: "Added" | "Changed" | "Fixed" | "Security" | "Removed"; text: string }[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.2.0",
    date: "2026-11-08",
    title: "Real Cloudflare DNS + honest apps",
    items: [
      { group: "Added", text: "Cloudflare API tokens are now verified against the real API before they are stored: token check (`/user/tokens/verify`), zone lookup (paginated) and a temporary write probe (`_hipno-permtest` TXT) — invalid or read-only tokens are rejected with the exact reason, never silently \"linked\"." },
      { group: "Added", text: "\"From Cloudflare\" import: pull every existing record of a zone into the panel (merge or mirror), preserving MX/SRV parts, priority and proxied state — existing records finally appear in the panel." },
      { group: "Added", text: "Bidirectional DNS: adding, editing, deleting or toggling a record on a provider zone pushes to Cloudflare immediately, with per-record sync state (in Cloudflare / pending / error) persisted and shown." },
      { group: "Changed", text: "Public IP detection rebuilt interface-first (excludes RFC1918/CGNAT/link-local/ULA) and confirmed by two independent echo services — the Add-site wizard's DNS table now always reflects the VPS's real public IP." },
      { group: "Changed", text: "Apps honesty pass: creating an app deploys immediately when Docker is present; without Docker the app is saved as \"configured — not deployed\" and every deploy action refuses honestly (409). No more \"staged\" success states." },
      { group: "Added", text: "App Logs tab (real `docker compose logs`, auto-refresh) and a Console action that opens a shell in the container through the panel terminal; environment edits redeploy for real." },
      { group: "Added", text: "Files: IDE-grade save safety — mtime-based conflict detection (409 file_conflict) with a keep/reload/overwrite dialog, plus an unsaved-changes indicator." },
      { group: "Fixed", text: "Apex DNS records no longer render as \"@.zone\" — the records table shows \"@ = zone.name\" with correct FQDNs everywhere." },
      { group: "Fixed", text: "Per-view browser tab titles (\"Domains & DNS · HipnoType\") coordinated with the unread-alert badge." },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-11-08",
    title: "Public launch release",
    items: [
      { group: "Added", text: "Public website (hypnotype.mangocloud.cyou): marketing site, install guide, full docs with search, changelog and security pages — deployed on Vercel." },
      { group: "Added", text: "`/install.sh` served from the website with SHA-256 checksum; one-command VPS installer for the panel." },
      { group: "Added", text: "Relay deployment pack (`relay/deploy/`): one-command setup script, Caddy TLS config, nftables rules, systemd unit, backup script." },
      { group: "Added", text: "Full brand icon set (SVG favicon, ICO, PNGs, maskable PWA icons, Open Graph card) and per-page titles." },
      { group: "Added", text: "Tab-title alert badge: the browser tab shows `(n)` while monitoring alerts are firing." },
      { group: "Changed", text: "Installer rewritten for the real panel stack (Bun + Next.js standalone): /dev/tty-safe prompts, --yes support, honest virtualization policy (KVM full, LXC/Docker gated with warnings, OpenVZ refused)." },
      { group: "Changed", text: "Relay now injects the panel base path and rewrites asset URLs, so panels serve correctly through the Vercel rewrite." },
      { group: "Changed", text: "Relay passes WebSocket upgrades through the tunnel — the browser terminal works in production relay mode." },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-11-07",
    title: "Initial release",
    items: [
      { group: "Added", text: "Rotating secret access URLs over the HipnoType Relay (outbound tunnel, two-phase rotation)." },
      { group: "Added", text: "Auth: Argon2id, forced first-login change, TOTP 2FA + recovery codes, lockout, session management." },
      { group: "Added", text: "Modules: dashboard, websites (+SSL), apps (22 templates), databases (SQLite console), files, terminal (PTY), firewall (60s rollback), cron, backups, processes, services, monitoring, users/tokens, audit (hash chain), settings, updater check." },
      { group: "Added", text: "`hypno` CLI, installer with KVM preflight, relay deployment docs, CI + release workflow." },
    ],
  },
];
