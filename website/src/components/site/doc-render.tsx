import Link from "next/link";
import type { ReactNode } from "react";
import type { DocBlock } from "@/content/site/docs";

/**
 * Docs block renderer + inline mini-markdown (**bold**, `code`, [text](url)).
 * React escapes all text nodes — no raw HTML is ever injected.
 */

/** Render a mini-markdown string to safe React nodes. */
export function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={key++} className="font-semibold text-foreground">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      parts.push(
        <code key={key++} className="rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 font-mono text-[0.85em]">
          {tok.slice(1, -1)}
        </code>
      );
    } else {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!;
      const href = mm[2];
      const internal = href.startsWith("/");
      parts.push(
        internal ? (
          <Link key={key++} href={href} className="font-medium text-[var(--brand-orange)] underline-offset-4 hover:underline">
            {mm[1]}
          </Link>
        ) : (
          <a key={key++} href={href} target="_blank" rel="noreferrer noopener" className="font-medium text-[var(--brand-orange)] underline-offset-4 hover:underline">
            {mm[1]}
          </a>
        )
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

const CALLOUT_STYLE = {
  info: "border-border/70 bg-muted/30",
  warn: "border-[#ffb020]/35 bg-[#ffb020]/[0.07]",
  danger: "border-[#e63c5c]/35 bg-[#e63c5c]/[0.07]",
  success: "border-emerald-500/35 bg-emerald-500/[0.07]",
} as const;

const CALLOUT_LABEL = {
  info: "Note",
  warn: "Warning",
  danger: "Important",
  success: "Tip",
} as const;

export function DocBlockView({ block }: { block: DocBlock }) {
  switch (block.t) {
    case "h2":
      return (
        <h2 className="mt-10 scroll-mt-24 border-b border-border/50 pb-2 text-2xl font-semibold tracking-tight first:mt-0">
          {block.text}
        </h2>
      );
    case "h3":
      return <h3 className="mt-7 scroll-mt-24 text-lg font-semibold tracking-tight">{block.text}</h3>;
    case "p":
      return (
        <p className="mt-4 leading-relaxed text-muted-foreground">
          <Inline text={block.text} />
        </p>
      );
    case "ul":
      return (
        <ul className="mt-4 space-y-2">
          {block.items.map((it, i) => (
            <li key={i} className="flex gap-3 leading-relaxed text-muted-foreground">
              <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand-orange)]/80" />
              <span>
                <Inline text={it} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="mt-4 space-y-2.5">
          {block.items.map((it, i) => (
            <li key={i} className="flex gap-3 leading-relaxed text-muted-foreground">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border border-[var(--brand-orange)]/30 bg-[var(--brand-orange)]/10 font-mono text-xs font-semibold text-[var(--brand-orange)]">
                {i + 1}
              </span>
              <span>
                <Inline text={it} />
              </span>
            </li>
          ))}
        </ol>
      );
    case "code":
      return (
        <figure className="mt-5">
          {block.title && (
            <figcaption className="rounded-t-xl border border-b-0 border-border/70 bg-muted/40 px-4 py-2 font-mono text-xs text-muted-foreground">
              {block.title}
            </figcaption>
          )}
          <pre
            className={`overflow-x-auto rounded-xl border border-border/70 bg-[#160e12] p-4 font-mono text-[13px] leading-relaxed text-foreground/90 ${block.title ? "rounded-t-none" : ""}`}
          >
            <code>{block.code}</code>
          </pre>
        </figure>
      );
    case "callout":
      return (
        <aside className={`mt-5 rounded-xl border p-4 ${CALLOUT_STYLE[block.variant]}`}>
          <p className="text-sm font-semibold">
            {block.title || CALLOUT_LABEL[block.variant]}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            <Inline text={block.text} />
          </p>
        </aside>
      );
    case "table":
      return (
        <div className="mt-5 overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="bg-muted/40">
                {block.head.map((h, i) => (
                  <th key={i} className="px-4 py-2.5 text-left font-semibold tracking-tight">
                    <Inline text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="border-t border-border/50">
                  {row.map((cell, j) => (
                    <td key={j} className="px-4 py-2.5 align-top leading-relaxed text-muted-foreground first:text-foreground">
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}
