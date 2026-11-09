#!/usr/bin/env bash
# ============================================================================
# HipnoType Panel — installer / upgrader (v1.1)
# Built by HipnoType · https://github.com/Arsh0712/HypnoPanel
#
#   curl -fsSL https://hypnotype.mangocloud.cyou/install.sh | sudo bash
#
# Installs the REAL panel stack:
#   Bun (panel runtime) + Node.js 22+ (terminal PTY service)
#   panel source from GitHub Releases (or --src), built on this machine
#   systemd units: hipnod (panel, 127.0.0.1:3000) + hipno-terminal (3004)
#   state in /var/lib/hipno · config in /etc/hipno · app in /opt/hipno/panel
#
# Flags:
#   --yes              non-interactive (assume yes everywhere)
#   --version <tag>    install a specific release tag (default: latest)
#   --src <path|url>   install from a local checkout / tarball / URL instead
#   --no-docker        skip Docker Engine installation
#   --mode relay|direct  access mode (default relay; direct needs --domain)
#   --domain <domain>  panel domain (direct mode)
#   --uninstall        remove (typed confirmation: REMOVE / REMOVE-DATA)
#
# Idempotent: re-running upgrades in place. Log: /var/log/hipno-install.log
# The temporary admin password is generated here, shown ONCE, then consumed
# by the first boot.
# ============================================================================
set -Eeuo pipefail

REPO="https://github.com/Arsh0712/HypnoPanel"
RELEASE_BASE="https://github.com/Arsh0712/HypnoPanel/releases/download"
MAIN_DOMAIN="hypnotype.mangocloud.cyou"
RELAY_URL="https://relay.${MAIN_DOMAIN}"
PANEL_DIR="/opt/hipno/panel"
STATE_DIR="/var/lib/hipno"
ETC_DIR="/etc/hipno"
LOG="/var/log/hipno-install.log"
PANEL_PORT=3000
HIPNO_USER="hipno"

VERSION="latest"; MODE="relay"; DOMAIN=""; SRC=""; DOCKER=1; ASSUME_YES=0; UNINSTALL=0; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --src) SRC="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --no-docker) DOCKER=0; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    --force) FORCE=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) shift ;;
  esac
done

# ------------------------------------------------------------------ helpers
c_ok()  { printf '\033[32m✔\033[0m %s\n' "$*"; }
c_no()  { printf '\033[31m✘\033[0m %s\n' "$*"; }
c_wa()  { printf '\033[33m!\033[0m %s\n' "$*"; }
c_ti()  { printf '\033[1m%s\033[0m\n' "$*"; }
die()   { c_no "$*"; printf 'See %s\n' "$LOG"; exit 1; }
trap 'c_no "Installer failed at line $LINENO — see $LOG"' ERR

confirm() { # $1 question → 0=yes
  [ "$ASSUME_YES" = "1" ] && return 0
  if [ -t 0 ] && [ -t 1 ]; then
    read -r -p "$1 [y/N]: " ans < /dev/tty
    [ "$ans" = "y" ] || [ "$ans" = "Y" ] || [ "$ans" = "yes" ]
  else
    c_wa "No TTY and no --yes — assuming no."
    return 1
  fi
}

exec >> >(tee -a "$LOG") 2>&1
c_ti "HipnoType Panel installer — Built by HipnoType"

# ------------------------------------------------------------------ uninstall
if [ "$UNINSTALL" = "1" ]; then
  c_wa "This stops HipnoType services. Data is kept unless you confirm removal."
  if [ -t 0 ] && [ -t 1 ]; then
    read -r -p "Type REMOVE (stop only) or REMOVE-DATA (delete everything): " ans < /dev/tty
  else
    [ "$ASSUME_YES" = "1" ] && ans="REMOVE" || ans=""
  fi
  if [ "$ans" = "REMOVE-DATA" ]; then
    confirm "Delete ALL panel data (sites, DB, backups)?" || die "Aborted — nothing was changed."
    if [ -f "$ETC_DIR/hipnod.env" ]; then
      set -a; . "$ETC_DIR/hipnod.env"; set +a
      if [ -n "${HIPNO_RELAY_URL:-}" ] && [ -f "$STATE_DIR/tunnel-secret" ]; then
        curl -fsS -X POST "${HIPNO_RELAY_URL}/api/v1/deregister" \
          -H "authorization: Bearer $(cat "$STATE_DIR/tunnel-secret")" >/dev/null 2>&1 || true
      fi
    fi
    systemctl stop hipnod hipno-terminal 2>/dev/null || true
    systemctl disable hipnod hipno-terminal 2>/dev/null || true
    rm -rf /opt/hipno /etc/hipno /var/lib/hipno /var/log/hipno /var/backups/hipno \
           /etc/systemd/system/hipnod.service /etc/systemd/system/hipno-terminal.service \
           /usr/local/bin/hypno
    systemctl daemon-reload
    c_ok "HipnoType Panel removed (data deleted)."
  elif [ "$ans" = "REMOVE" ]; then
    systemctl stop hipnod hipno-terminal 2>/dev/null || true
    systemctl disable hipnod hipno-terminal 2>/dev/null || true
    c_ok "Services stopped. Data kept under $STATE_DIR (remove manually if desired)."
  else
    die "Aborted — nothing was changed."
  fi
  exit 0
fi

UPGRADE=0
[ -f "$ETC_DIR/hipnod.env" ] && UPGRADE=1
[ "$UPGRADE" = "1" ] && c_ti "Existing installation detected — upgrading in place (data preserved)."

# ------------------------------------------------------------------ [1/8] preflight
c_ti "[1/8] Preflight checks"
PASS=0; FAIL=0
preflight() { # name, ok(0/1), reason
  if [ "$2" = "0" ]; then c_ok "PASS  $1"; PASS=$((PASS+1));
  else c_no "FAIL  $1 — $3"; FAIL=$((FAIL+1)); fi
}

[ "$(id -u)" = "0" ] && preflight "root user" 0 || preflight "root user" 1 "run with sudo"

# --- virtualization: capability-honest policy (spec §7.2)
VIRT="$(systemd-detect-virt 2>/dev/null || echo unknown)"
VIRT_NOTE=""
case "$VIRT" in
  kvm|qemu)
    preflight "Virtualization (KVM/QEMU — full support)" 0 ;;
  none)
    if [ "${HIPNO_ALLOW_BAREMETAL:-0}" = "1" ] || [ "$ASSUME_YES" = "1" ]; then
      preflight "Bare metal (allowed)" 0
    else
      confirm "Bare metal detected — install HipnoType on this machine?" \
        && HIPNO_ALLOW_BAREMETAL=1 preflight "Bare metal (confirmed)" 0 \
        || die "Bare metal not confirmed (set HIPNO_ALLOW_BAREMETAL=1 or use --yes)."
    fi ;;
  lxc|lxc-libvirt|systemd-nspawn)
    c_wa "  LXC-style container: Docker workloads need security.nesting=true on the host:"
    c_wa "  lxc config set <container> security.nesting true"
    preflight "Virtualization (LXC — feature-gated, continuing)" 0 ;;
  docker|podman)
    c_wa "  Container environment: restricted mode — nested containers and kernel"
    c_wa "  firewall features are unavailable; the panel will report them honestly."
    preflight "Virtualization ($VIRT — restricted mode, continuing)" 0 ;;
  wsl)
    c_wa "  WSL is for development only — not a production target."
    preflight "Virtualization (WSL — dev/testing only)" 0 ;;
  openvz)
    if [ "$FORCE" = "1" ]; then
      c_wa "  OpenVZ forced with --force: limited 'panel + proxy only' mode, unsupported."
      preflight "Virtualization (OpenVZ — forced, unsupported)" 0
    else
      c_no "FAIL  virtualization — OpenVZ has no real kernel (no Docker/nftables)."
      c_no "      Use a KVM VPS, or --force for a clearly-unsupported panel-only mode."
      exit 1
    fi ;;
  *)
    confirm "Unknown virtualization '$VIRT' — continue anyway?" \
      && preflight "Virtualization (unknown '$VIRT' — confirmed)" 0 \
      || die "Aborted."; ;;
esac

. /etc/os-release
case "$ID:$VERSION_ID" in
  ubuntu:22.04|ubuntu:24.04|debian:12|almalinux:9|rocky:9) preflight "OS ($PRETTY_NAME)" 0 ;;
  *) preflight "OS" 1 "Ubuntu 22.04/24.04, Debian 12, AlmaLinux 9 or Rocky 9 required (found $PRETTY_NAME)" ;;
esac

case "$(uname -m)" in
  x86_64|aarch64) preflight "Architecture ($(uname -m))" 0 ;;
  *) preflight "Architecture" 1 "amd64 or arm64 required" ;;
esac

MEM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
SWAP_MB=$(awk '/SwapTotal/ {printf "%d", $2/1024}' /proc/meminfo)
if [ "$MEM_MB" -ge 1500 ]; then
  preflight "RAM (${MEM_MB} MB)" 0
elif [ "$MEM_MB" -ge 900 ] && [ $((MEM_MB + SWAP_MB)) -ge 2000 ]; then
  preflight "RAM (${MEM_MB} MB + ${SWAP_MB} MB swap — enough for the on-device build)" 0
elif [ "$MEM_MB" -ge 900 ]; then
  ADD_SWAP=1
  c_wa "  Low RAM (${MEM_MB} MB, no swap) — the on-device build needs ~1.5 GB."
  if confirm "Create a 2 GB temporary swapfile for the build?"; then
    preflight "RAM (low — swapfile will be added)" 0
  else
    preflight "RAM" 1 "at least 1.5 GB (or 1 GB + 2 GB swap) required for the build"
  fi
else
  preflight "RAM" 1 "at least 1 GB + swap required (found ${MEM_MB} MB)"
fi

DISK_GB=$(df -BG / | awk 'NR==2 {print $4}' | tr -d G)
[ "$DISK_GB" -ge 10 ] && preflight "Free disk (${DISK_GB} GB)" 0 || preflight "Free disk" 1 "at least 10 GB required"

[ "$(ps -p 1 -o comm=)" = "systemd" ] && preflight "systemd is PID 1" 0 || preflight "systemd is PID 1" 1 "systemd required"

CONFLICT=""
for d in /www/server/panel/BTPanel /usr/local/CyberCP /etc/cloudpanel /usr/local/cpanel /usr/local/psa /data/coolify; do
  [ -d "$d" ] && CONFLICT="$d"
done
if [ -n "$CONFLICT" ]; then
  c_no "FAIL  conflicting panel detected: $CONFLICT"
  c_no "      HipnoType cannot be installed alongside aaPanel/CyberPanel/CloudPanel/cPanel/Plesk/Coolify."
  exit 1
fi
preflight "No conflicting panels" 0

curl -fsS --max-time 8 -o /dev/null "https://relay.${MAIN_DOMAIN}/healthz" 2>/dev/null \
  && preflight "Relay reachability (relay.${MAIN_DOMAIN})" 0 \
  || preflight "Relay reachability" 1 "cannot reach the relay (needed for the access URL)"
curl -fsS --max-time 8 -o /dev/null https://github.com 2>/dev/null \
  && preflight "GitHub reachability" 0 \
  || { [ -n "$SRC" ] && preflight "GitHub reachability (skipped — --src)" 0 || preflight "GitHub reachability" 1 "cannot reach github.com (releases)"; }

[ "$FAIL" = "0" ] || die "$FAIL preflight check(s) failed — fix the reported issues and re-run."

# ------------------------------------------------------------------ [2/8] deps
c_ti "[2/8] Installing dependencies (Bun, Node.js 22+, tools)"
export DEBIAN_FRONTEND=noninteractive
if command -v apt-get >/dev/null; then
  apt-get update -y
  apt-get install -y curl git unzip tar ca-certificates gnupg
elif command -v dnf >/dev/null; then
  dnf install -y curl git unzip tar ca-certificates gnupg
else
  die "No supported package manager (apt/dnf) found."
fi

# Node.js 22+ (terminal PTY service needs Node FD semantics for node-pty)
NODE_MAJOR=22
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]; then
  c_wa "Installing Node.js ${NODE_MAJOR}.x (NodeSource)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource-setup.sh 2>/dev/null \
    && bash /tmp/nodesource-setup.sh >/dev/null && apt-get install -y nodejs >/dev/null \
    && c_ok "Node.js $(node -v) installed" \
    || { command -v dnf >/dev/null && curl -fsSL https://rpm.nodesource.com/setup_${NODE_MAJOR}.x -o /tmp/ns.sh && bash /tmp/ns.sh && dnf install -y nodejs; } \
    || die "Node.js install failed — install Node ${NODE_MAJOR}+ manually and re-run."
else
  c_ok "Node.js $(node -v) already present"
fi

# Bun (panel runtime)
if ! command -v bun >/dev/null; then
  c_wa "Installing Bun"
  curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
  [ -f "$HOME/.bun/bin/bun" ] && cp "$HOME/.bun/bin/bun" /usr/local/bin/bun
  [ -f /root/.bun/bin/bun ] && cp /root/.bun/bin/bun /usr/local/bin/bun 2>/dev/null || true
fi
command -v bun >/dev/null || die "Bun installation failed — install from https://bun.sh and re-run."
chmod 755 /usr/local/bin/bun 2>/dev/null || true
c_ok "Bun $(bun --version) ready"

if [ "$DOCKER" = "1" ] && ! command -v docker >/dev/null; then
  c_wa "Installing Docker Engine + compose plugin (--no-docker to skip)"
  curl -fsSL https://get.docker.com | sh \
    && c_ok "Docker installed" \
    || c_wa "Docker install failed — the panel will report the runtime as unavailable (honestly)."
fi

# ------------------------------------------------------------------ [3/8] source
c_ti "[3/8] Acquiring the panel"
SRC_STAGE="$(mktemp -d /tmp/hipno-src.XXXXXX)"
trap 'rm -rf "$SRC_STAGE"' EXIT

if [ -n "$SRC" ]; then
  if [ -f "$SRC" ]; then
    tar -xzf "$SRC" -C "$SRC_STAGE"
    c_ok "Extracted source from $SRC"
  elif [ -d "$SRC" ]; then
    mkdir -p "$SRC_STAGE/panel"
    tar -cf - -C "$SRC" \
      src public prisma scripts mini-services package.json bun.lock next.config.ts \
      tsconfig.json postcss.config.mjs eslint.config.mjs db 2>/dev/null \
      | tar -xf - -C "$SRC_STAGE/panel" || true
    [ -d "$SRC_STAGE/panel/src" ] || { cp -r "$SRC" "$SRC_STAGE/panel"; }
    c_ok "Copied source from $SRC"
  else
    curl -fsSL "$SRC" -o /tmp/hipno-src.tar.gz && tar -xzf /tmp/hipno-src.tar.gz -C "$SRC_STAGE"
    c_ok "Downloaded source from $SRC"
  fi
else
  if [ "$VERSION" = "latest" ]; then
    VERSION="$(curl -fsSL "https://api.github.com/repos/Arsh0712/HypnoPanel/releases/latest" 2>/dev/null | grep -oP '"tag_name":\s*"\K[^"]+' || true)"
  fi
  DOWNLOADED=0
  if [ -n "$VERSION" ]; then
    c_wa "Downloading release ${VERSION} (panel source)"
    for u in \
      "$RELEASE_BASE/$VERSION/panel-source.tar.gz" \
      "$RELEASE_BASE/$VERSION/hipnotype-panel-linux-$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz"; do
      if curl -fsSL -o /tmp/hipno-panel.tar.gz "$u"; then DOWNLOADED=1; break; fi
    done
  fi
  if [ "$DOWNLOADED" = "0" ]; then
    # no GitHub release (yet) — the main site always mirrors the current source
    c_wa "No GitHub release asset — falling back to https://${MAIN_DOMAIN}/downloads/panel-source.tar.gz"
    curl -fsSL -o /tmp/hipno-panel.tar.gz "https://${MAIN_DOMAIN}/downloads/panel-source.tar.gz" \
      || die "Panel source not downloadable. Either publish a release (docs/GO_LIVE.md) or install straight from the GitHub repo:
         curl -fsSL https://hypnotype.mangocloud.cyou/install.sh | sudo bash -s -- --src https://github.com/Arsh0712/HypnoPanel/archive/refs/heads/main.tar.gz"
    # verify against the .sha256 sidecar served next to the tarball
    WANT_SHA="$(curl -fsSL --max-time 10 "https://${MAIN_DOMAIN}/downloads/panel-source.tar.gz.sha256" 2>/dev/null | awk '{print $1}' || true)"
    if [ -n "$WANT_SHA" ]; then
      GOT_SHA="$(sha256sum /tmp/hipno-panel.tar.gz | awk '{print $1}')"
      [ "$WANT_SHA" = "$GOT_SHA" ] || die "SHA-256 mismatch on the downloaded panel source — aborting (expected $WANT_SHA, got $GOT_SHA)."
      c_ok "Checksum verified (site mirror)"
    fi
  fi
  tar -xzf /tmp/hipno-panel.tar.gz -C "$SRC_STAGE"
  if [ -n "${VERSION:-}" ] && curl -fsSL -o /tmp/hipno-checksums.txt "$RELEASE_BASE/$VERSION/checksums.txt" 2>/dev/null && [ -s /tmp/hipno-checksums.txt ]; then
    (cd /tmp && sha256sum -c hipno-checksums.txt --ignore-missing) || die "SHA-256 checksum mismatch — aborting."
    c_ok "Checksums verified"
  fi
fi

# locate the panel root — the tarball may wrap it in panel/, HypnoPanel/panel/
# or <repo>-<ref>/ (GitHub's auto-generated source archives use the latter)
PANEL_SRC=""
for d in "$SRC_STAGE" "$SRC_STAGE"/*/ "$SRC_STAGE"/*/*/; do
  [ -f "${d%/}/package.json" ] && [ -d "${d%/}/src" ] && PANEL_SRC="${d%/}" && break
done
[ -n "$PANEL_SRC" ] || die "Could not find the panel source in the archive (expected a folder with package.json + src/)."
c_ok "Panel source ready: $PANEL_SRC"

# ------------------------------------------------------------------ [4/8] build
c_ti "[4/8] Installing panel dependencies + building (this is the slow part)"
systemctl stop hipnod hipno-terminal 2>/dev/null || true
mkdir -p /opt/hipno
[ -d "$PANEL_DIR" ] && rm -rf "${PANEL_DIR}.old" && mv "$PANEL_DIR" "${PANEL_DIR}.old"
mkdir -p "$PANEL_DIR"
# state dir must exist BEFORE the build (build-time DATABASE_URL points here)
install -d -o "${HIPNO_USER:-hipno}" -g "${HIPNO_USER:-hipno}" -m 0750 "$STATE_DIR" 2>/dev/null || true
# the built app only needs the runtime surface, not the marketing-site routes
tar -cf - -C "$PANEL_SRC" \
  src/components/panel src/components/ui src/hooks src/lib src/content \
  src/app/api src/instrumentation.ts \
  prisma scripts mini-services public package.json next.config.ts tailwind.config.ts \
  tsconfig.json postcss.config.mjs eslint.config.mjs 2>/dev/null | tar -xf - -C "$PANEL_DIR"
# the panel page itself (served at "/" in production — the relay strips the
# /server/panel/<token> prefix)
mkdir -p "$PANEL_DIR/src/app"
printf 'import { HipnoPanelRoot } from "@/components/panel/root";\n\nexport default function Home() {\n  return <HipnoPanelRoot />;\n}\n' \
  > "$PANEL_DIR/src/app/page.tsx"
cp "$PANEL_SRC/src/app/layout.tsx" "$PANEL_DIR/src/app/layout.tsx" 2>/dev/null || true
cp "$PANEL_SRC/src/app/globals.css" "$PANEL_DIR/src/app/globals.css" 2>/dev/null || true

# temp swap for small VPSes (removed after the build)
SWAPFILE=""
if [ "${ADD_SWAP:-0}" = "1" ]; then
  SWAPFILE=/hipno-build.swap
  dd if=/dev/zero of="$SWAPFILE" bs=1M count=2048 status=none
  chmod 600 "$SWAPFILE"
  mkswap "$SWAPFILE" >/dev/null && swapon "$SWAPFILE" && c_ok "2 GB build swap enabled (removed after build)"
fi
remove_build_swap() {
  if [ -n "$SWAPFILE" ] && swapon --show=NAME 2>/dev/null | grep -q "$SWAPFILE"; then
    swapoff "$SWAPFILE" && rm -f "$SWAPFILE" && c_ok "Build swap removed"
  fi
}
trap 'remove_build_swap; rm -rf "$SRC_STAGE"' EXIT

(
  cd "$PANEL_DIR"
  export DATABASE_URL="file:${STATE_DIR}/panel.db"
  bun install 2>&1 | tail -2
  bunx prisma generate 2>&1 | tail -1
  bunx next build 2>&1 | tail -12
) || { remove_build_swap; die "Panel build failed — see the log above."; }
remove_build_swap
c_ok "Panel built"

# terminal service deps (node-pty compiles; failure falls back to pipe mode)
(
  cd "$PANEL_DIR/mini-services/terminal-service" \
    && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -1 \
    && c_ok "Terminal service dependencies installed (PTY mode)" \
) || c_wa "Terminal deps failed — terminal will run in pipe-shell fallback mode."

# ------------------------------------------------------------------ [5/8] user/dirs
c_ti "[5/8] User, directories and secrets"
id -u "$HIPNO_USER" >/dev/null 2>&1 || useradd --system --home "$STATE_DIR" --shell /usr/sbin/nologin "$HIPNO_USER"
install -d -o "$HIPNO_USER" -g "$HIPNO_USER" -m 0750 "$STATE_DIR" "$ETC_DIR" /var/log/hipno /var/backups/hipno /opt/hipno
for sub in sites databases backups trash; do
  install -d -o "$HIPNO_USER" -g "$HIPNO_USER" -m 0750 "$STATE_DIR/$sub"
done
command -v docker >/dev/null && usermod -aG docker "$HIPNO_USER" 2>/dev/null || true

if [ ! -f "$ETC_DIR/hipnod.env" ]; then
  ADMIN_EMAIL="${HIPNO_INITIAL_ADMIN_EMAIL:-admin@${MAIN_DOMAIN}}"
  if [ -z "${HIPNO_INITIAL_ADMIN_PASSWORD:-}" ]; then
    ADMIN_PASSWORD="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)!aA"
    SHOW_DEFAULT_PASSWORD=1
  else
    ADMIN_PASSWORD="$HIPNO_INITIAL_ADMIN_PASSWORD"
  fi
  umask 077
  cat > "$ETC_DIR/hipnod.env" <<ENVEOF
# HipnoType Panel — installed $(date -Is) — mode: ${MODE}
HIPNO_STATE_DIR=${STATE_DIR}
HIPNO_RELAY_URL=${RELAY_URL}
HIPNO_PANEL_URL=http://127.0.0.1:${PANEL_PORT}
HIPNO_TERMINAL_PORT=3004
DATABASE_URL=file:${STATE_DIR}/panel.db
HIPNO_INITIAL_ADMIN_EMAIL=${ADMIN_EMAIL}
HIPNO_INITIAL_ADMIN_PASSWORD=${ADMIN_PASSWORD}
ENVEOF
  chown "$HIPNO_USER:$HIPNO_USER" "$ETC_DIR/hipnod.env"; chmod 0600 "$ETC_DIR/hipnod.env"
  c_ok "Generated $ETC_DIR/hipnod.env (0600)"
else
  c_ok "Existing env preserved (upgrade)"
fi

# seed (idempotent): schema + admin account + local CLI token
set -a; . "$ETC_DIR/hipnod.env"; set +a
(
  cd "$PANEL_DIR"
  sudo -u "$HIPNO_USER" env HIPNO_STATE_DIR="$STATE_DIR" DATABASE_URL="$DATABASE_URL" \
    /usr/local/bin/bun node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss 2>&1 | tail -1
  sudo -u "$HIPNO_USER" env HIPNO_STATE_DIR="$STATE_DIR" DATABASE_URL="$DATABASE_URL" \
    HIPNO_INITIAL_ADMIN_EMAIL="${HIPNO_INITIAL_ADMIN_EMAIL:-}" HIPNO_INITIAL_ADMIN_PASSWORD="${HIPNO_INITIAL_ADMIN_PASSWORD:-}" \
    /usr/local/bin/bun scripts/seed.ts 2>&1 | tail -3
)

# ------------------------------------------------------------------ [6/8] systemd
c_ti "[6/8] Installing systemd units"
cat > /etc/systemd/system/hipnod.service <<EOF
[Unit]
Description=HipnoType Panel daemon (Next.js, local only)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=${HIPNO_USER}
Group=${HIPNO_USER}
WorkingDirectory=${PANEL_DIR}
Environment=NODE_ENV=production
Environment=PORT=${PANEL_PORT}
Environment=HOSTNAME=127.0.0.1
EnvironmentFile=${ETC_DIR}/hipnod.env
ExecStart=/usr/local/bin/bun node_modules/next/dist/bin/next start -H 127.0.0.1 -p ${PANEL_PORT}
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=${STATE_DIR} /var/log/hipno /var/backups/hipno ${PANEL_DIR}

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/hipno-terminal.service <<EOF
[Unit]
Description=HipnoType Panel — terminal (PTY) service
After=hipnod.service
PartOf=hipnod.service

[Service]
Type=simple
User=${HIPNO_USER}
Group=${HIPNO_USER}
WorkingDirectory=${PANEL_DIR}/mini-services/terminal-service
EnvironmentFile=${ETC_DIR}/hipnod.env
ExecStart=/usr/bin/node index.ts
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=${STATE_DIR}

[Install]
WantedBy=multi-user.target
EOF

# CLI shim
cat > /usr/local/bin/hypno <<EOF
#!/bin/sh
# HipnoType Panel CLI — installed by the installer
cd ${PANEL_DIR}
set -a; . ${ETC_DIR}/hipnod.env; set +a
exec /usr/local/bin/bun scripts/hypno.mjs "\$@"
EOF
chmod 0755 /usr/local/bin/hypno

chown -R "$HIPNO_USER:$HIPNO_USER" "$PANEL_DIR"
systemctl daemon-reload
systemctl enable hipnod hipno-terminal >/dev/null 2>&1
c_ok "Units installed (hipnod, hipno-terminal) + /usr/local/bin/hypno"

# ------------------------------------------------------------------ [7/8] start + verify
c_ti "[7/8] Starting services + health check"
systemctl restart hipnod hipno-terminal
PANEL_OK=0
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:${PANEL_PORT}/api/auth/session" 2>/dev/null; then PANEL_OK=1; break; fi
  sleep 1
done
[ "$PANEL_OK" = "1" ] || die "Panel did not come up — journalctl -u hipnod -n 50"
c_ok "Panel answering on 127.0.0.1:${PANEL_PORT}"

systemctl is-active --quiet hipno-terminal && c_ok "Terminal service active (port 3004)" || c_wa "Terminal service not active — journalctl -u hipno-terminal -n 30"

# wait for the relay registration (panel registers + tunnels out on boot)
ACCESS_PATH=""
for i in $(seq 1 45); do
  ACCESS_PATH="$(hypno url 2>/dev/null | tail -1 | tr -d '[:space:]')" || ACCESS_PATH=""
  case "$ACCESS_PATH" in
    /server/panel/*) break ;;
    *) ACCESS_PATH="" ;;
  esac
  sleep 1
done
[ -n "$ACCESS_PATH" ] || c_wa "Access URL not issued yet — the tunnel may still be connecting. Run: hypno url"

ACCESS_URL="https://${MAIN_DOMAIN}${ACCESS_PATH}"
ADMIN_EMAIL="$(grep -oP 'HIPNO_INITIAL_ADMIN_EMAIL=\K.*' "$ETC_DIR/hipnod.env" || echo "admin@${MAIN_DOMAIN}")"

# one-time password delivery, then consumed
if [ "${SHOW_DEFAULT_PASSWORD:-0}" = "1" ]; then
  INSTALLER_PASSWORD="$(grep -oP 'HIPNO_INITIAL_ADMIN_PASSWORD=\K.*' "$ETC_DIR/hipnod.env")"
  sed -i '/HIPNO_INITIAL_ADMIN_PASSWORD/d' "$ETC_DIR/hipnod.env"   # consumed once
  systemctl restart hipnod
else
  INSTALLER_PASSWORD="(the HIPNO_INITIAL_ADMIN_PASSWORD you supplied)"
fi

# ------------------------------------------------------------------ [8/8] summary
c_ti "[8/8] Installation complete"
LINE=$(printf '%.0s─' $(seq 1 66))
printf '\n\033[1m%s\033[0m\n' "$LINE"
printf '  HipnoType Panel v%s — Built by HipnoType\n\n' "${VERSION#v}"
printf '  Panel URL : %s\n' "${ACCESS_URL:-NOT-ISSUED — run: hypno url}"
printf '  Email     : %s\n' "$ADMIN_EMAIL"
printf '  Password  : %s\n' "$INSTALLER_PASSWORD"
[ "${SHOW_DEFAULT_PASSWORD:-0}" = "1" ] && printf '               (TEMPORARY — first login forces a change)\n'
printf '\n  Save the URL now — it is the only way in.\n'
printf '  CLI       : hypno --help  |  hypno doctor  |  hypno rotate\n'
printf '  Docs      : https://%s/docs\n' "$MAIN_DOMAIN"
printf '\033[1m%s\033[0m\n' "$LINE"
exit 0
