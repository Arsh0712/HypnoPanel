# `hypno` — CLI Reference

> Preview runtime: `bun scripts/hypno.mjs <command> [flags]` (VPS deployment: `hypno <command>`).
> Auth: root-only `data/cli-token.json` (0600) as a Bearer API token. Every mutating action is
> audit-logged with source `local-cli`. Run as non-root prints a preview-mode warning
> (`HIPNO_ENFORCE_ROOT=1` enforces root, matching the VPS behaviour).

```
hypno status [--json]         Panel, tunnel, proxy, DB and Docker health
hypno url                     Print the current access URL path
hypno rotate [--custom <slug>] [--yes]
                              Rotate the access URL (random 32 chars, or custom slug 16–64)
hypno credentials             Show admin email(s) — never passwords
hypno reset emailpass         Interactive reset: new email + password (hidden prompts,
                              policy-enforced, sessions revoked, audit admin.credentials.reset)
hypno reset password [--random | --password-stdin]
                              Reset only the password (random prints a temp once; stdin for automation)
hypno reset email             Reset only the admin email
hypno 2fa disable             Disable 2FA for an admin (typed email confirmation, audited)
hypno sessions list|revoke-all
hypno start | stop | restart  Panel service control (systemd on the VPS)
hypno logs [-n 200]           Panel log tail
hypno tunnel status|restart   Relay tunnel state, latency, server ID, access URL
hypno firewall status [--ruleset]
                              Backend availability, SSH/panel ports, pending confirm, ruleset
hypno backup now|list|verify <id>
hypno update [--check]        Channel + real GitHub release check
hypno doctor [--json]         PASS/FAIL diagnostics with fix suggestions
hypno config get [key] | set <key> <value>
                              Allow-listed settings (validated server-side)
hypno version
hypno uninstall               Typed confirmation (REMOVE / REMOVE-DATA)
hypno completion bash|zsh|fish
```

## Examples

```console
$ bun scripts/hypno.mjs status
! Running as non-root (preview mode). On the VPS deployment hypno requires root.
HipnoType Panel status
  Panel version : v1.0.0
  Access mode   : relay
  Access URL    : /server/panel/vDVB3ic7v7uGwnkr73V2FzLuKeKxXc72/?XTransformPort=3005
  Host          : c-6aef1608… (Debian GNU/Linux 13 (trixie), x64)
  Uptime        : 3h 29m
  Tunnel        : connected (latency 42ms)
  IPv4 / IPv6   : 47.57.242.119 / n/a

Services
  ● Reverse proxy (Caddy) — gateway :81
  ○ Docker Engine — docker binary not installed
  ● Panel database (SQLite) — WAL
  ○ Firewall (nftables) — nft binary not installed
  ○ fail2ban — not installed
```

```console
$ bun scripts/hypno.mjs rotate
Rotate the access URL?
  Current: /server/panel/vDVB3…
  New     : random 32 characters
  All active sessions will be revoked.
Proceed? [y/N] y
Admin email: admin@hypnotype.mangocloud.cyou
Admin password: ••••••••••••
✓ Access URL rotated → /server/panel/<new-token>/
  New URL path: /server/panel/<new-token>/?XTransformPort=3005
All sessions (including the CLI login above) were revoked. Audit entry written (access.rotate).
```

```console
$ bun scripts/hypno.mjs doctor
PASS  Panel API — HTTP 200          PASS  Relay tunnel — connected
PASS  Data directory — present       PASS  Disk space — root usage 46%
PASS  Secret key — present           PASS  Clock skew — 10s
PASS  CLI token — present            FAIL  KVM virtualization — detected: docker
PASS  Backups dir — present                fix: Install on a KVM VPS (Ubuntu 22.04/24.04, Debian 12, AlmaLinux 9, Rocky 9)
PASS  secret.key mode — 0600
9/10 checks passed
```

(The KVM check is intentional and honest: this preview runs inside a container; the VPS installer
refuses anything but `kvm` unless `HIPNO_ALLOW_BAREMETAL=1` — spec §4.1.)
