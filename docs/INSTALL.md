# Installing the Panel on a VPS

## Requirements (enforced by preflight)
KVM VPS (`systemd-detect-virt` = `kvm`; bare metal needs `HIPNO_ALLOW_BAREMETAL=1`; containers
are refused with the exact reason) · Ubuntu 22.04/24.04, Debian 12, AlmaLinux 9 or Rocky 9 ·
amd64/arm64 · ≥1 GB RAM · ≥10 GB free disk · systemd as PID 1 · nftables + cgroups v2 +
overlayfs · free ports 80/443 in direct mode · outbound DNS/HTTPS to the relay, GitHub and the
Docker registry · no aaPanel/CyberPanel/CloudPanel/cPanel/Plesk/Coolify present.

## One line

    curl -fsSL https://hypnotype.mangocloud.cyou/install.sh | sudo bash

Flags: `--mode relay|direct` · `--domain <domain>` · `--port <n>` · `--no-docker` ·
`--version <tag>` · `--yes` · `--uninstall`.

## What each step does (installer/install.sh)
1. **Preflight** — every check prints PASS/FAIL with a reason (see above). Nothing installs on FAIL.
2. **Dependencies** — curl, git, tar/unzip, nftables, fail2ban, (optionally) Docker + compose.
3. **User & directories** — system user `hipno`; `/opt/hipno`, `/etc/hipno`, `/var/lib/hipno`,
   `/var/log/hipno`, `/var/backups/hipno`.
4. **Download** — `hipnod`, `hypno`, `hipno-helper` for the detected architecture from the
   GitHub Release; **SHA-256 + signature verified — abort on mismatch**.
5. **Systemd units** — hardened `hipnod.service` + `hipno-helper.service`.
6. **Secrets** — `secret.key` (0600) and one-time initial admin credentials in
   `/etc/hipno/hipnod.env` (never logged; consumed once, then the password entry is removed).
7. **First init** — services start; the daemon initialises the DB and **registers with the relay**
   (`POST /api/v1/register`) receiving `serverId`, `tunnelSecret` and the first access TOKEN
   (only hashes stored at the relay).
8. **Verify** — `systemctl is-active hipnod`, then `hypno doctor` runs and prints PASS/FAIL with
   fix suggestions.
9. **Summary box** — access URL, admin email, TEMPORARY password (shown once, on screen only),
   CLI command list.

## First login
Sign in with the installer credentials → you are **forced to set a new password** (and may change
the email) before anything else is reachable → TOTP 2FA setup is offered (recommended; recovery
codes shown once). The relay access URL keeps working through the forced-change flow.

## Finding your access URL later
- UI: Settings → Access URL
- CLI: `hypno url`, `hypno status` (also shows tunnel latency and service health)
- Lost access? `hypno rotate` from the server console, or `hypno reset emailpass`.

## Uninstall
`curl -fsSL .../install.sh | sudo bash -s -- --uninstall` — typed confirmation; `REMOVE` keeps
data, `REMOVE-DATA` deletes `/var/lib/hipno` etc. and deregisters from the relay first.
