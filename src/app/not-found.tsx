import Link from "next/link";
import { HypnoMark } from "@/components/site/brand";

/** Root 404 — site-styled. API routes keep their own JSON 404s. */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <HypnoMark className="h-16 w-16 opacity-90" id="nf-g" />
        <p className="mt-8 font-mono text-sm font-semibold tracking-[0.2em] text-[var(--brand-orange)]">
          404 — NOT FOUND
        </p>
        <h1 className="mt-3 max-w-md text-balance text-3xl font-semibold tracking-tight [font-family:var(--font-display)]">
          This page slipped out of the trance.
        </h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
          The URL you opened does not exist. If you were looking for your panel, check the access
          URL printed by the installer — the 32-character suffix matters.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Back to the homepage
          </Link>
          <Link
            href="/docs"
            className="rounded-lg border border-border/70 px-5 py-2.5 text-sm font-medium transition-colors hover:border-foreground/40"
          >
            Read the docs
          </Link>
        </div>
      </main>
    </div>
  );
}
