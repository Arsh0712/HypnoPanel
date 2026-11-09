"use client";

import { useQuery } from "@tanstack/react-query";
import { usePanelStore, type ViewerUser } from "@/lib/store";
import { hasPermission } from "@/lib/permissions";
import { get, post } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { HypnoLogo } from "./logo";
import { NAV_GROUPS, VIEW_META, type NavItem } from "./nav";
import { setPanelViewTitle } from "@/lib/title";
import { CommandPalette } from "./command-palette";
import { Notifications } from "./notifications";
import { viewVariants } from "./motion";
import {
  Search,
  Sun,
  Moon,
  ChevronRight,
  LogOut,
  Menu,
  UserCircle,
  Cog,
  Info,
  Server,
  ShieldCheck,
  ArrowUpRight,
} from "lucide-react";

const Loading = () => (
  <div className="space-y-6" role="status" aria-label="Loading view">
    <div className="h-16 w-72 rounded-xl bg-muted/60 hipno-shimmer" />
    <div className="grid gap-4 md:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-32 rounded-xl bg-muted/60 hipno-shimmer" />
      ))}
    </div>
    <div className="h-72 rounded-xl bg-muted/40 hipno-shimmer" />
  </div>
);

const views: Record<string, React.ComponentType> = {
  dashboard: dynamic(() => import("./views/dashboard").then((m) => m.DashboardView), { loading: Loading }),
  monitoring: dynamic(() => import("./views/monitoring").then((m) => m.MonitoringView), { loading: Loading }),
  websites: dynamic(() => import("./views/websites").then((m) => m.WebsitesView), { loading: Loading }),
  domains: dynamic(() => import("./views/domains").then((m) => m.DomainsView), { loading: Loading }),
  email: dynamic(() => import("./views/email").then((m) => m.EmailView), { loading: Loading }),
  wordpress: dynamic(() => import("./views/wordpress").then((m) => m.WordpressView), { loading: Loading }),
  apps: dynamic(() => import("./views/apps").then((m) => m.AppsView), { loading: Loading }),
  databases: dynamic(() => import("./views/databases").then((m) => m.DatabasesView), { loading: Loading }),
  files: dynamic(() => import("./views/files").then((m) => m.FilesView), { loading: Loading }),
  terminal: dynamic(() => import("./views/terminal").then((m) => m.TerminalView), { loading: Loading }),
  security: dynamic(() => import("./views/security").then((m) => m.SecurityView), { loading: Loading }),
  performance: dynamic(() => import("./views/performance").then((m) => m.PerformanceView), { loading: Loading }),
  firewall: dynamic(() => import("./views/firewall").then((m) => m.FirewallView), { loading: Loading }),
  server: dynamic(() => import("./views/server").then((m) => m.ServerView), { loading: Loading }),
  processes: dynamic(() => import("./views/processes").then((m) => m.ProcessesView), { loading: Loading }),
  services: dynamic(() => import("./views/services").then((m) => m.ServicesView), { loading: Loading }),
  cron: dynamic(() => import("./views/cron").then((m) => m.CronView), { loading: Loading }),
  backups: dynamic(() => import("./views/backups").then((m) => m.BackupsView), { loading: Loading }),
  users: dynamic(() => import("./views/users").then((m) => m.UsersView), { loading: Loading }),
  audit: dynamic(() => import("./views/audit").then((m) => m.AuditView), { loading: Loading }),
  settings: dynamic(() => import("./views/settings").then((m) => m.SettingsView), { loading: Loading }),
  about: dynamic(() => import("./views/about").then((m) => m.AboutView), { loading: Loading }),
};

/* ————————————————————————— sidebar ————————————————————————— */

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group relative w-full flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-all duration-200 ${
        active
          ? "bg-primary/[0.08] text-primary font-medium"
          : "text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
      }`}
    >
      {active && (
        <motion.span
          layoutId="nav-rail"
          className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-gradient-to-b from-[var(--brand-amber)] to-[var(--brand-red)]"
          transition={{ type: "spring", bounce: 0.18, duration: 0.5 }}
          aria-hidden
        />
      )}
      <Icon
        className={`h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-110 ${
          active ? "text-primary" : ""
        }`}
        aria-hidden
      />
      <span className="truncate">{item.label}</span>
    </button>
  );
}

function SidebarContent({ viewer, onNavigate }: { viewer: ViewerUser; onNavigate?: () => void }) {
  const view = usePanelStore((s) => s.view);
  const setView = usePanelStore((s) => s.setView);

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-5 pt-5 pb-4">
        <HypnoLogo size="md" />
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-3 space-y-5" aria-label="Main navigation">
        {NAV_GROUPS.map((g) => {
          const items = g.items.filter((i) => !i.permission || hasPermission(viewer.role, i.permission));
          if (!items.length) return null;
          return (
            <div key={g.group}>
              <p className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                {g.group}
              </p>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavButton
                    key={item.id}
                    item={item}
                    active={view === item.id}
                    onClick={() => {
                      setView(item.id);
                      onNavigate?.();
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg bg-muted/40">
          <Avatar className="h-8 w-8 ring-1 ring-border">
            <AvatarFallback className="text-[11px] font-semibold bg-primary/15 text-primary">
              {(viewer.email || "?").slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium truncate">{viewer.email}</p>
            <p className="text-[10px] text-muted-foreground capitalize">{viewer.role}</p>
          </div>
          <span
            className={`h-2 w-2 rounded-full hipno-pulse ${
              viewer.totpEnabled ? "bg-emerald-500" : "bg-amber-500"
            }`}
            title={viewer.totpEnabled ? "2FA enabled" : "2FA not enabled"}
            aria-hidden
          />
        </div>
      </div>
    </div>
  );
}

/* ————————————————————————— theme toggle ————————————————————————— */

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Toggle color theme"
      className="hover:rotate-12 transition-transform duration-300"
    >
      <Sun className="h-[18px] w-[18px] hidden dark:block" aria-hidden />
      <Moon className="h-[18px] w-[18px] dark:hidden" aria-hidden />
    </Button>
  );
}

/* ————————————————————————— shell ————————————————————————— */

interface TunnelInfo {
  tunnel: { status: string; latencyMs: number | null; lastError: string | null };
}

export function AppShell() {
  const viewer = usePanelStore((s) => s.viewer);
  const setViewer = usePanelStore((s) => s.setViewer);
  const view = usePanelStore((s) => s.view);
  const [mobileNav, setMobileNav] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { toast } = useToast();

  // Per-view document title (FIX#2 §2): "Domains & DNS · HipnoType" etc.
  // Coordinated with the unread-alert badge through src/lib/title.ts.
  const viewLabel = view ? VIEW_META[view]?.label : null;
  useEffect(() => {
    setPanelViewTitle(viewLabel ?? null);
    return () => setPanelViewTitle(null);
  }, [viewLabel]);

  const tunnel = useQuery<TunnelInfo>({
    queryKey: ["tunnel"],
    queryFn: () => get<TunnelInfo>("/api/system/tunnel"),
    refetchInterval: 15_000,
    enabled: !!viewer && hasPermission(viewer!.role, "settings:read"),
  });

  if (!viewer) return null;
  const ActiveView = views[view] ?? views.dashboard;
  const meta = VIEW_META[view];

  const tunnelStatus = tunnel.data?.tunnel.status;
  const tunnelOk = tunnelStatus === "connected";
  const tunnelLabel =
    tunnelOk
      ? `Relay ${tunnel.data?.tunnel.latencyMs ?? "–"}ms`
      : tunnelStatus === "connecting"
        ? "Relay connecting"
        : "Relay offline";

  async function logout() {
    await post("/api/auth/logout").catch(() => {});
    setViewer(null);
    toast({ title: "Signed out" });
    window.location.reload();
  }

  return (
    <div className="min-h-screen flex bg-background">
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} viewer={viewer} />

      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex w-[248px] shrink-0 flex-col border-r border-sidebar-border sticky top-0 h-screen"
        aria-label="Sidebar"
      >
        <SidebarContent viewer={viewer} />
      </aside>

      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Topbar */}
        <header className="sticky top-0 z-30 h-14 border-b bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
          <div className="h-full flex items-center gap-2 px-3 md:px-5">
            <Sheet open={mobileNav} onOpenChange={setMobileNav}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-[264px]">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <SidebarContent viewer={viewer} onNavigate={() => setMobileNav(false)} />
              </SheetContent>
            </Sheet>

            {/* breadcrumb */}
            <nav aria-label="Breadcrumb" className="hidden sm:flex items-center gap-1.5 text-[13px] text-muted-foreground min-w-0">
              <span className="truncate">HipnoType</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
              <span className="text-foreground font-medium truncate">{meta?.label ?? "Dashboard"}</span>
            </nav>

            {/* relay / host chips */}
            <div className="hidden xl:flex items-center gap-1.5 ml-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground bg-muted/30">
                <Server className="h-3 w-3" aria-hidden />
                <span className="max-w-40 truncate">
                  {typeof window !== "undefined" ? window.location.hostname : "server"}
                </span>
              </span>
              {hasPermission(viewer.role, "settings:read") && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
                    tunnelOk
                      ? "border-emerald-500/25 text-emerald-600 dark:text-emerald-400 bg-emerald-500/[0.07]"
                      : "border-red-500/25 text-red-600 dark:text-red-400 bg-red-500/[0.07]"
                  }`}
                  title={tunnel.data?.tunnel.lastError ?? undefined}
                >
                  <ShieldCheck className="h-3 w-3" aria-hidden />
                  {tunnelLabel}
                </span>
              )}
            </div>

            <div className="ml-auto flex items-center gap-1">
              {/* command palette trigger */}
              <button
                onClick={() => setPaletteOpen(true)}
                className="hidden md:flex items-center gap-2 h-9 rounded-lg border bg-muted/30 px-3 text-[13px] text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                aria-label="Open command palette"
              >
                <Search className="h-3.5 w-3.5" aria-hidden />
                <span className="pr-6">Search…</span>
                <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-0.5 rounded border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                  ⌘K
                </kbd>
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => setPaletteOpen(true)}
                aria-label="Search"
              >
                <Search className="h-[18px] w-[18px]" />
              </Button>

              <ThemeToggle />
              <Notifications canRead={hasPermission(viewer.role, "monitoring:read")} />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="gap-2 px-2 ml-1" aria-label="User menu">
                    <UserCircle className="h-5 w-5" aria-hidden />
                    <span className="hidden lg:inline text-[13px] max-w-44 truncate font-medium">
                      {viewer.email}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-[11px] font-semibold bg-primary/15 text-primary">
                          {(viewer.email || "?").slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium truncate">{viewer.email}</p>
                        <p className="text-[11px] text-muted-foreground capitalize">{viewer.role}</p>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => usePanelStore.getState().setView("settings")}>
                    <Cog className="h-4 w-4" aria-hidden /> Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => usePanelStore.getState().setView("about")}>
                    <Info className="h-4 w-4" aria-hidden /> About
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                    <LogOut className="h-4 w-4" aria-hidden /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* Active view with transitions */}
        <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 md:px-7 py-6 min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              variants={viewVariants}
              initial="hidden"
              animate="show"
              exit="exit"
            >
              <ActiveView />
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Footer — the single place the panel credits its maker */}
        <footer className="mt-auto border-t">
          <div className="max-w-[1440px] mx-auto px-4 md:px-7 py-3 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
            <span>HipnoType Panel · crafted with care by HipnoType</span>
            <a
              href="https://hypnotype.mangocloud.cyou"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            >
              hypnotype.mangocloud.cyou
              <ArrowUpRight className="h-3 w-3" aria-hidden />
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
