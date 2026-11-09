import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, BookMarked, Library, Wrench } from "lucide-react";
import { SectionHead } from "@/components/site/ui";
import { docsBySection } from "@/content/site/docs";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Guides and reference for HipnoType Panel — install, requirements, the access URL, DNS with Cloudflare, apps, files, the terminal, the CLI, the relay trust model and more.",
  alternates: { canonical: "/docs" },
};

const SECTION_ICONS: Record<string, React.ReactNode> = {
  "Getting started": <BookOpen className="h-5 w-5" />,
  Guides: <Wrench className="h-5 w-5" />,
  Reference: <Library className="h-5 w-5" />,
  Operations: <BookMarked className="h-5 w-5" />,
};

export default function DocsIndexPage() {
  const groups = docsBySection();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
      <SectionHead
        eyebrow="Documentation"
        title="Everything, explained"
        description="Written from the real implemented behaviour — if the panel can't do it, these pages don't claim it."
      />

      <div className="mt-14 grid gap-10 lg:grid-cols-2">
        {groups.map((g) => (
          <section key={g.section}>
            <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
              <span className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--brand-orange)]/25 bg-[var(--brand-orange)]/10 text-[var(--brand-orange)]">
                {SECTION_ICONS[g.section] ?? <BookOpen className="h-5 w-5" />}
              </span>
              {g.section}
            </h2>
            <ul className="mt-4 space-y-2.5">
              {g.pages.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/docs/${p.slug}`}
                    className="group flex items-start justify-between gap-4 rounded-xl border border-border/60 p-4 transition-colors hover:border-primary/40"
                  >
                    <span>
                      <span className="block text-sm font-semibold tracking-tight">{p.title}</span>
                      <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{p.description}</span>
                    </span>
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-[var(--brand-orange)]" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
