# Updates & Rollback

- **Check**: UI Settings → Updates (real GitHub Releases query, honest result) or `hypno update --check`.
- **Channels**: stable / beta (Settings → Updates).
- **VPS updater** (`hypno update`): download the new release → verify SHA-256 + signature →
  stage the binary → automatic DB migration backup → **atomic swap** → restart → health check →
  **automatic rollback** if the health check fails (the previous binary is restored and the
  failure audited).
- In this preview environment the updater reports status only (the panel runs from the
  repository; binary staging/swap applies to the VPS deployment).
- Release pipeline: `.github/workflows/ci.yml` (lint → boot smoke → relay smoke → tagged release
  with checksums + signature).
