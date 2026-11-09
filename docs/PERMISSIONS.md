# Permissions Matrix

Roles: **admin** (everything) · **developer** (build & operate workloads; no panel-level
security) · **viewer** (read-only). Enforced server-side by `guard(req, {permission})`
(`src/lib/permissions.ts`) and mirrored by the sidebar/UI. API tokens additionally carry scopes
(`*` or a subset) checked on every request.

| Permission | admin | developer | viewer |
|---|:--:|:--:|:--:|
| dashboard:read | ✓ | ✓ | ✓ |
| websites:read / websites:write | ✓ / ✓ | ✓ / ✓ | ✓ / ✗ |
| apps:read / apps:write | ✓ / ✓ | ✓ / ✓ | ✓ / ✗ |
| databases:read / databases:write | ✓ / ✓ | ✓ / ✓ | ✓ / ✗ |
| files:read / files:write | ✓ / ✓ | ✓ / ✓ | ✓ / ✗ |
| terminal:use | ✓ | ✓ | ✗ |
| cron:read / cron:write | ✓ / ✓ | ✓ / ✓ | ✓ / ✗ |
| backups:read / backups:write | ✓ / ✓ | ✓ / ✗ | ✓ / ✗ |
| firewall:read / firewall:write | ✓ / ✓ | ✗ / ✗ | ✗ / ✗ |
| processes:read / processes:write | ✓ / ✓ | ✓ / ✗ | ✓ / ✗ |
| services:read / services:write | ✓ / ✓ | ✓ / ✓ | ✓ / ✗ |
| monitoring:read / monitoring:write | ✓ / ✓ | ✓ / ✗ | ✓ / ✗ |
| users:read / users:write | ✓ / ✓ | ✗ / ✗ | ✗ / ✗ |
| audit:read | ✓ | ✓ | ✓ |
| settings:read / settings:write | ✓ / ✓ | ✓ / ✗ | ✗ / ✗ |
| access:rotate | ✓ | ✗ | ✗ |

Additional server-side protections:
- Only admins may create/modify users and API tokens; the last enabled admin cannot be deleted or demoted.
- Access-URL rotation additionally requires the account password (+ TOTP when enabled).
- Terminal "run as" another OS user requires the privileged helper of the VPS deployment.
- Firewall rules that would deny the SSH/panel port from `any` are rejected before apply.
- Killing PID 1 or the panel's own process is refused.
