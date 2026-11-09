"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Github, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { HypnoLogo } from "./brand";
import { ThemeToggle } from "./theme-toggle";

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://hypnotype.mangocloud.cyou";
export const REPO_URL = process.env.NEXT_PUBLIC_GITHUB_REPO || "https://github.com/Arsh0712/HypnoPanel";

const NAV = [
  { href: "/install", label: "Install" },
  { href: "/docs", label: "Docs" },
  { href: "/changelog", label: "Changelog" },
  { href: "/security", label: "Security" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="shrink-0" aria-label="HipnoType Panel home">
          <HypnoLogo />
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm transition-colors",
                  active ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="GitHub repository"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/30"
          >
            <Github className="h-4 w-4" />
          </a>
          <ThemeToggle />
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 text-muted-foreground md:hidden"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <Link
            href="/install"
            className="hidden rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 sm:inline-flex"
          >
            Get started
          </Link>
        </div>
      </div>

      {open && (
        <nav className="border-t border-border/60 bg-background md:hidden" aria-label="Mobile">
          <div className="mx-auto flex max-w-6xl flex-col px-4 py-3 sm:px-6">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/install"
              onClick={() => setOpen(false)}
              className="mt-2 rounded-lg bg-primary px-3 py-2.5 text-center text-sm font-medium text-primary-foreground"
            >
              Get started
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
