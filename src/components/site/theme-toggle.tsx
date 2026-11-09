"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

const emptySubscribe = () => () => {};

/** Light/dark toggle — same next-themes strategy as the panel. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // hydration-safe "mounted" (no setState-in-effect)
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  return (
    <button
      type="button"
      aria-label="Toggle color theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30"
    >
      {mounted && resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
