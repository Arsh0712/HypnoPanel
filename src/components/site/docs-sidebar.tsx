"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DOC_PAGES } from "@/content/site/docs";

/**
 * Docs sidebar with live search (titles, descriptions, keywords).
 * Client-side only — the whole docs index ships as static data.
 */
export function DocsSidebar({ slug }: { slug?: string }) {
  const pathname = usePathname();
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    const pages = query
      ? DOC_PAGES.filter(
          (p) =>
            p.title.toLowerCase().includes(query) ||
            p.description.toLowerCase().includes(query) ||
            p.slug.includes(query)
        )
      : DOC_PAGES;
    const sections: string[] = [];
    for (const p of pages) if (!sections.includes(p.section)) sections.push(p.section);
    return sections.map((section) => ({
      section,
      pages: pages.filter((p) => p.section === section).sort((a, b) => a.order - b.order),
    }));
  }, [q]);

  const active = slug ?? (pathname.startsWith("/docs/") ? pathname.split("/")[2] : "");

  return (
    <nav aria-label="Documentation" className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the docs…"
          aria-label="Search documentation"
          className="w-full rounded-lg border border-border/70 bg-background py-2.5 pl-9 pr-8 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="mt-5 space-y-6">
        {groups.length === 0 && (
          <p className="px-1 text-sm text-muted-foreground">No pages match “{q}”.</p>
        )}
        {groups.map((g) => (
          <div key={g.section}>
            <p className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {g.section}
            </p>
            <ul className="mt-2 space-y-0.5">
              {g.pages.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/docs/${p.slug}`}
                    className={cn(
                      "block rounded-lg px-3 py-2 text-sm transition-colors",
                      active === p.slug
                        ? "bg-[var(--brand-orange)]/10 font-medium text-[var(--brand-orange)]"
                        : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                    )}
                    aria-current={active === p.slug ? "page" : undefined}
                  >
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
