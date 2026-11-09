/**
 * Role → permission matrix. Documented in docs/PERMISSIONS.md.
 * - admin: everything
 * - developer: build/operate workloads, no panel-level security changes
 * - viewer: read-only
 */
export const PERMISSIONS = [
  "dashboard:read",
  "websites:read", "websites:write",
  "apps:read", "apps:write",
  "databases:read", "databases:write",
  "files:read", "files:write",
  "terminal:use",
  "cron:read", "cron:write",
  "backups:read", "backups:write",
  "firewall:read", "firewall:write",
  "processes:read", "processes:write",
  "services:read", "services:write",
  "monitoring:read", "monitoring:write",
  "users:read", "users:write",
  "audit:read",
  "settings:read", "settings:write",
  "access:rotate",
  "dns:read", "dns:write",
  "mail:read", "mail:write",
  "wordpress:read", "wordpress:write",
  "security:read", "security:write",
  "performance:read", "performance:write",
  "server:read", "server:write",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: ALL,
  developer: [
    "dashboard:read",
    "websites:read", "websites:write",
    "apps:read", "apps:write",
    "databases:read", "databases:write",
    "files:read", "files:write",
    "terminal:use",
    "cron:read", "cron:write",
    "backups:read",
    "processes:read",
    "services:read", "services:write",
    "monitoring:read",
    "audit:read",
    "settings:read",
    "dns:read", "dns:write",
    "mail:read",
    "wordpress:read", "wordpress:write",
    "security:read",
    "performance:read",
    "server:read",
  ],
  viewer: [
    "dashboard:read",
    "websites:read",
    "apps:read",
    "databases:read",
    "files:read",
    "cron:read",
    "backups:read",
    "processes:read",
    "services:read",
    "monitoring:read",
    "audit:read",
    "dns:read",
    "mail:read",
    "wordpress:read",
    "security:read",
    "performance:read",
    "server:read",
  ],
};

export function hasPermission(role: string, permission: Permission | string): boolean {
  const perms = ROLE_PERMISSIONS[role];
  return !!perms && perms.includes(permission as Permission);
}

/** Which roles a role may assign/create. */
export function canManageRoles(role: string): boolean {
  return role === "admin";
}
