#!/usr/bin/env bash
# ============================================================================
# HipnoType Panel — release packager
#
#   bun scripts/make-release.sh        (or: bash scripts/make-release.sh)
#
# Builds, from the CURRENT tree:
#   1. panel-source.tar.gz            — the installer asset (what
#                                       install.sh downloads/builds from)
#   2. website/                       — regenerated via make-website.mjs,
#                                       with public/downloads/ mirrored
#   3. HypnoType-Site-<v>.tar.gz      — the standalone Vercel site app
#   4. HypnoPanel-<v>.tar.gz          — the full panel repository tarball
#   5. checksums + SHA256SUMS         — refreshed in both download mirrors
#
# Version is taken from src/components/site/downloads.tsx (RELEASE_VERSION),
# which also mirrors the changelog.
#
# No tarball ever contains itself or another versioned tarball:
#   · panel-source.tar.gz      contains no website/ and no downloads/
#   · HypnoType-Site-<v>.tar.gz contains only the panel-source mirror
#   · HypnoPanel-<v>.tar.gz    contains website/ with only the panel-source
#                              mirror (versioned tarballs are excluded)
# ============================================================================
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(grep -oP 'RELEASE_VERSION = "\K[^"]+' src/components/site/downloads.tsx | head -1)"
[ -n "$VERSION" ] || { echo "✘ could not read RELEASE_VERSION from src/components/site/downloads.tsx"; exit 1; }
echo "── packaging HipnoType release v${VERSION} ──"

PANEL_TGZ="HypnoPanel-v${VERSION}.tar.gz"
SITE_TGZ="HypnoType-Site-v${VERSION}.tar.gz"
STAGE="$(mktemp -d /tmp/hipno-release.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT
OUT="$STAGE"

# ---------------------------------------------------------------- [1] panel-source
# The exact source subset the installer builds from (see installer/install.sh
# §[4/8]). Wrapped in panel/ so it extracts tidily.
echo "· panel-source.tar.gz"
tar -czf "$OUT/panel-source.tar.gz" \
  --exclude='*/node_modules' --exclude='node_modules' \
  --exclude='public/downloads' \
  --exclude='db/*.db' --exclude='db/*.db-*' \
  --transform 's,^,panel/,' \
  src public prisma scripts mini-services db \
  package.json bun.lock next.config.ts tsconfig.json tailwind.config.ts \
  postcss.config.mjs eslint.config.mjs components.json next-env.d.ts

SHA="$(sha256sum "$OUT/panel-source.tar.gz" | awk '{print $1}')"
printf '%s  panel-source.tar.gz\n' "$SHA" > "$OUT/panel-source.tar.gz.sha256"
# checksums.txt is what a GitHub release attaches — the installer downloads
# as /tmp/hipno-panel.tar.gz, so list BOTH filenames (sha256sum -c verifies
# whichever exists; --ignore-missing skips the other).
{
  printf '%s  panel-source.tar.gz\n' "$SHA"
  printf '%s  hipno-panel.tar.gz\n' "$SHA"
} > "$OUT/checksums.txt"

# ---------------------------------------------------------------- [2] website
echo "· website/ (regenerate + mirror downloads)"
bun scripts/make-website.mjs --out website
mkdir -p website/public/downloads
cp "$OUT/panel-source.tar.gz" "$OUT/panel-source.tar.gz.sha256" "$OUT/checksums.txt" \
   website/public/downloads/
# lockfile for reproducible installs (Vercel picks it up automatically)
if [ ! -f website/bun.lock ]; then (cd website && bun install --quiet); fi
if [ "${1:-}" = "--verify" ]; then
  echo "· verifying the site builds (bun run build)"
  (cd website && bun install --quiet && bun run build >/dev/null 2>&1) \
    && echo "  ✔ website build OK" || { echo "  ✘ website build FAILED"; exit 1; }
fi

# ---------------------------------------------------------------- [3] site tarball
# Standalone Vercel app at the archive ROOT (no wrapper folder) — Vercel
# auto-detects Next.js with zero configuration.
echo "· ${SITE_TGZ}"
tar -czf "$OUT/$SITE_TGZ" -C website \
  --exclude='node_modules' --exclude='.next' --exclude='.vercel' \
  --exclude='public/downloads/HypnoPanel-*.tar.gz' \
  --exclude='public/downloads/HypnoType-Site-*.tar.gz' \
  --exclude='public/downloads/SHA256SUMS.txt' \
  .

# ---------------------------------------------------------------- [4] panel repo tarball
# The full monorepo: panel + relay + installer + docs + website.
# NOTE: --exclude matches the SOURCE paths (the HypnoPanel/ prefix is added
# later by --transform), so patterns must NOT carry it.
echo "· ${PANEL_TGZ}"
tar -czf "$OUT/$PANEL_TGZ" \
  --exclude='website/node_modules' \
  --exclude='website/.next' --exclude='website/.vercel' \
  --exclude='mini-services/*/node_modules' \
  --exclude='mini-services/*/data' \
  --exclude='.next' \
  --exclude='db/*.db' --exclude='db/*.db-*' \
  --exclude='public/downloads' \
  --exclude='website/public/downloads/HypnoPanel-*.tar.gz' \
  --exclude='website/public/downloads/HypnoType-Site-*.tar.gz' \
  --exclude='website/public/downloads/SHA256SUMS.txt' \
  --transform 's,^,HypnoPanel/,' \
  .github .gitignore .editorconfig \
  src public prisma scripts mini-services db installer deploy docs tests website \
  Makefile README.md CHANGELOG.md SECURITY.md LICENSE CONTRIBUTING.md CODE_OF_CONDUCT.md \
  package.json bun.lock next-env.d.ts tsconfig.json components.json \
  eslint.config.mjs tailwind.config.ts postcss.config.mjs next.config.ts

# ---------------------------------------------------------------- [5] mirrors
echo "· refreshing download mirrors"
for DIR in public/downloads website/public/downloads; do
  mkdir -p "$DIR"
  cp "$OUT/panel-source.tar.gz" "$OUT/panel-source.tar.gz.sha256" \
     "$OUT/checksums.txt" "$OUT/$SITE_TGZ" "$OUT/$PANEL_TGZ" "$DIR/"
done
(
  cd public/downloads
  sha256sum "$PANEL_TGZ" "$SITE_TGZ" panel-source.tar.gz install.sh > SHA256SUMS.txt 2>/dev/null \
    || sha256sum "$PANEL_TGZ" "$SITE_TGZ" panel-source.tar.gz > SHA256SUMS.txt
)
cp public/downloads/SHA256SUMS.txt website/public/downloads/SHA256SUMS.txt

echo
echo "── done ─────────────────────────────────────────────────────────────"
ls -lh public/downloads/ | awk 'NR>1 {print "  " $9 "  (" $5 ")"}'
echo
echo "  Upload to GitHub release v${VERSION}:  panel-source.tar.gz + checksums.txt (+ the two tarballs)"
echo "  The site mirrors them at /downloads/ — install.sh falls back to it automatically."
