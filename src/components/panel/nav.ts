"use client";

import {
  LayoutDashboard,
  Activity,
  Globe,
  Network,
  Mail,
  Puzzle,
  Boxes,
  Database,
  FolderTree,
  TerminalSquare,
  ShieldCheck,
  Gauge,
  ShieldAlert,
  Server,
  Cpu,
  ListTree,
  CalendarClock,
  HardDrive,
  Users,
  ScrollText,
  Cog,
  Info,
} from "lucide-react";
import type { PanelView } from "@/lib/store";

/**
 * Navigation model — the single source of truth used by the sidebar, the
 * ⌘K command palette and the topbar breadcrumb.
 */

export interface NavItem {
  id: PanelView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
  hint?: string;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    group: "Overview",
    items: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard:read" },
      { id: "monitoring", label: "Monitoring", icon: Activity, permission: "monitoring:read" },
    ],
  },
  {
    group: "Web",
    items: [
      { id: "websites", label: "Websites", icon: Globe, permission: "websites:read" },
      { id: "domains", label: "Domains & DNS", icon: Network, permission: "dns:read" },
      { id: "email", label: "Email", icon: Mail, permission: "mail:read" },
      { id: "wordpress", label: "WordPress", icon: Puzzle, permission: "wordpress:read" },
    ],
  },
  {
    group: "Runtime",
    items: [
      { id: "apps", label: "Apps", icon: Boxes, permission: "apps:read" },
      { id: "databases", label: "Databases", icon: Database, permission: "databases:read" },
      { id: "files", label: "Files", icon: FolderTree, permission: "files:read" },
      { id: "terminal", label: "Terminal", icon: TerminalSquare, permission: "terminal:use" },
    ],
  },
  {
    group: "System",
    items: [
      { id: "security", label: "Security Center", icon: ShieldCheck, permission: "security:read" },
      { id: "performance", label: "Performance", icon: Gauge, permission: "performance:read" },
      { id: "firewall", label: "Firewall", icon: ShieldAlert, permission: "firewall:read" },
      { id: "server", label: "Server", icon: Server, permission: "server:read" },
      { id: "processes", label: "Processes", icon: Cpu, permission: "processes:read" },
      { id: "services", label: "Services", icon: ListTree, permission: "services:read" },
      { id: "cron", label: "Cron Jobs", icon: CalendarClock, permission: "cron:read" },
      { id: "backups", label: "Backups", icon: HardDrive, permission: "backups:read" },
    ],
  },
  {
    group: "Panel",
    items: [
      { id: "users", label: "Users & Tokens", icon: Users, permission: "users:read" },
      { id: "audit", label: "Audit Log", icon: ScrollText, permission: "audit:read" },
      { id: "settings", label: "Settings", icon: Cog, permission: "settings:read" },
      { id: "about", label: "About", icon: Info },
    ],
  },
];

/** Flattened lookup: view id → { label, icon, group }. */
export const VIEW_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; group: string }> =
  Object.fromEntries(
    NAV_GROUPS.flatMap((g) =>
      g.items.map((i) => [i.id, { label: i.label, icon: i.icon, group: g.group }])
    )
  );

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
