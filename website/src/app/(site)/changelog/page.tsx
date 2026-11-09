import type { Metadata } from "next";
import { CHANGELOG } from "@/content/site/changelog";
import { SectionHead } from "@/components/site/ui";

export const metadata: Metadata = {
  title: "Changelog",
  description: "Every HipnoType Panel release — what was added, changed and fixed, version by version.",
  alternates: { canonical: "/changelog" },
};

const GROUP_STYLE: Record<string, string> = {
  Added: "bg-[var(--brand-orange)]/10 text-[var(--brand-orange)] border-[var(--brand-orange)]/30",
  Changed: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  Fixed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  Security: "bg-[var(--brand-red)]/10 text-[var(--brand-red)] border-[var(--brand-red)]/30",
  Removed: "bg-muted text-muted-foreground border-border/70",
};

export default function ChangelogPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
      <SectionHead
        eyebrow="Changelog"
        title="Version by version"
        description="No silent changes — every release lists exactly what moved."
      />

      <ol className="mt-14 space-y-12">
        {CHANGELOG.map((entry) => (
          <li key={entry.version} className="relative border-l border-border/60 pl-8">
            <span
              aria-hidden
              className="absolute -left-[7px] top-1.5 h-3.5 w-3.5 rounded-full border-2 border-background bg-gradient-to-br from-[var(--brand-amber)] to-[var(--brand-red)]"
            />
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-2xl font-semibold tracking-tight">v{entry.version}</h2>
              <time dateTime={entry.date} className="text-sm text-muted-foreground">
                {entry.date}
              </time>
            </div>
            {entry.title && <p className="mt-1 text-sm font-medium text-[var(--brand-orange)]">{entry.title}</p>}
            <ul className="mt-5 space-y-3">
              {entry.items.map((it, i) => (
                <li key={i} className="flex flex-wrap items-start gap-2.5 text-sm leading-relaxed">
                  <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${GROUP_STYLE[it.group]}`}>
                    {it.group}
                  </span>
                  <span className="min-w-0 flex-1 text-muted-foreground">{it.text}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
