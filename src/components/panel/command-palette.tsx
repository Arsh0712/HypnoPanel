"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useQueryClient } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { usePanelStore } from "@/lib/store";
import { hasPermission } from "@/lib/permissions";
import { post } from "@/lib/api";
import { ALL_NAV_ITEMS, NAV_GROUPS } from "./nav";
import { ArrowRight, LogOut, Moon, RefreshCw, Sun } from "lucide-react";
import type { ViewerUser } from "@/lib/store";

/**
 * ⌘K command palette — global navigation + panel-level actions.
 * Opens with Ctrl/Cmd+K from anywhere in the shell.
 */
export function CommandPalette({
  open,
  onOpenChange,
  viewer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewer: ViewerUser;
}) {
  const setView = usePanelStore((s) => s.setView);
  const { resolvedTheme, setTheme } = useTheme();
  const queryClient = useQueryClient();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const go = (id: Parameters<typeof setView>[0]) => {
    setView(id);
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search views, actions…" />
      <CommandList>
        <CommandEmpty>Nothing matches that search.</CommandEmpty>
        {NAV_GROUPS.map((group, gi) => {
          const items = group.items.filter(
            (i) => !i.permission || hasPermission(viewer.role, i.permission)
          );
          if (!items.length) return null;
          return (
            <div key={group.group}>
              {gi > 0 && <CommandSeparator />}
              <CommandGroup heading={group.group}>
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <CommandItem key={item.id} onSelect={() => go(item.id)} value={`${item.label} ${group.group}`}>
                      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                      {item.label}
                      <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground/50" aria-hidden />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </div>
          );
        })}
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem
            onSelect={() => {
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
              onOpenChange(false);
            }}
            value="toggle theme dark light appearance"
          >
            {resolvedTheme === "dark" ? (
              <Sun className="h-4 w-4 text-muted-foreground" aria-hidden />
            ) : (
              <Moon className="h-4 w-4 text-muted-foreground" aria-hidden />
            )}
            Switch to {resolvedTheme === "dark" ? "light" : "dark"} theme
          </CommandItem>
          <CommandItem
            onSelect={() => {
              queryClient.invalidateQueries();
              onOpenChange(false);
            }}
            value="refresh data reload"
          >
            <RefreshCw className="h-4 w-4 text-muted-foreground" aria-hidden />
            Refresh all data
          </CommandItem>
          <CommandItem
            onSelect={() => {
              post("/api/auth/logout").catch(() => {});
              setTimeout(() => window.location.reload(), 200);
            }}
            value="sign out logout exit"
          >
            <LogOut className="h-4 w-4 text-muted-foreground" aria-hidden />
            Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
