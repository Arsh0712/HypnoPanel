# Troubleshooting

## First stop: `hypno doctor`
PASS/FAIL checks with fix suggestions: panel API, data/secret/CLI-token files and permissions,
relay tunnel, disk space, clock skew, KVM virtualization (honest on containers).

## Common situations
- **Locked out of the panel** — from the server console: `hypno reset emailpass` (temp password
  forced-change flow) or `hypno rotate` (new URL + all sessions revoked).
- **Access URL 404** — the token was rotated or revoked; get the current one: `hypno url`.
  Check the tunnel: `hypno tunnel status`; relay health: `curl https://hypnotype.mangocloud.cyou/healthz`.
- **Tunnel offline** — outbound 443 to the relay blocked? `curl -v https://hypnotype.mangocloud.cyou`.
  The client reconnects with exponential backoff + jitter automatically.
- **Terminal not connecting** — the PTY service runs on the panel host (port 3004 in this
  preview); ensure it is running and you hold the admin/developer role.
- **Docker/nftables/systemd "unavailable"** — that is the honest probe result in a container
  environment; on a VPS the installer installs them (docs/INSTALL.md).
- **Reading logs** — panel: `hypno logs -n 200` (dev.log on the preview; `journalctl -u hipnod`
  on a VPS). Relay: its service log. Audit: UI → Audit Log (or CSV/JSON export).
- **DB integrity** — doctor checks reachability; on a VPS: `sqlite3 /var/lib/hipno/panel.db 'PRAGMA integrity_check;'`.
- **Backups** — verify any archive from the UI (sha256) or `hypno backup verify <id>`; restores
  take a pre-restore snapshot automatically.
