import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { DOC_PAGE_BY_SLUG, DOC_PAGES } from "@/content/site/docs";
import { DocBlockView } from "@/components/site/doc-render";
import { DocsSidebar } from "@/components/site/docs-sidebar";
import { REPO_URL } from "@/components/site/header";

export function generateStaticParams() {
  return DOC_PAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = DOC_PAGE_BY_SLUG.get(slug);
  if (!page) return {};
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: `/docs/${page.slug}` },
  };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = DOC_PAGE_BY_SLUG.get(slug);
  if (!page) notFound();

  const idx = DOC_PAGES.findIndex((p) => p.slug === page.slug);
  const prev = idx > 0 ? DOC_PAGES[idx - 1] : null;
  const next = idx < DOC_PAGES.length - 1 ? DOC_PAGES[idx + 1] : null;

  return (
    <div className="mx-auto w-full max-w-6xl gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:grid lg:grid-cols-[240px_1fr]">
      <DocsSidebar slug={page.slug} />

      <article className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">
          {page.section}
        </p>
        <h1 className="mt-2 text-balance text-4xl font-semibold tracking-tight [font-family:var(--font-display)]">
          {page.title}
        </h1>
        <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">{page.description}</p>
        <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/50 pb-5 text-xs text-muted-foreground">
          <span>
            Updated <time dateTime={page.updated}>{page.updated}</time>
          </span>
          <a
            href={`${REPO_URL}/blob/main/src/content/site/docs.ts`}
            target="_blank"
            rel="noreferrer noopener"
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            Edit this page on GitHub
          </a>
        </p>

        <div className="mt-2 max-w-3xl">
          {page.blocks.map((b, i) => (
            <DocBlockView key={i} block={b} />
          ))}
        </div>

        <nav className="mt-14 flex flex-col gap-3 border-t border-border/50 pt-6 sm:flex-row sm:justify-between" aria-label="Pagination">
          {prev ? (
            <Link
              href={`/docs/${prev.slug}`}
              className="group flex items-center gap-3 rounded-xl border border-border/60 p-4 transition-colors hover:border-primary/40 sm:max-w-[48%]"
            >
              <ArrowLeft className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-[var(--brand-orange)]" />
              <span>
                <span className="block text-xs text-muted-foreground">Previous</span>
                <span className="text-sm font-semibold">{prev.title}</span>
              </span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              href={`/docs/${next.slug}`}
              className="group flex items-center justify-end gap-3 rounded-xl border border-border/60 p-4 text-right transition-colors hover:border-primary/40 sm:max-w-[48%]"
            >
              <span>
                <span className="block text-xs text-muted-foreground">Next</span>
                <span className="text-sm font-semibold">{next.title}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-[var(--brand-orange)]" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </article>
    </div>
  );
}
