import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Section heading with eyebrow + display title (serif accent). */
export function SectionHead({
  eyebrow,
  title,
  description,
  align = "center",
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "center" | "left";
}) {
  return (
    <div className={cn("max-w-2xl", align === "center" ? "mx-auto text-center" : "text-left")}>
      {eyebrow && (
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">{eyebrow}</p>
      )}
      <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl [font-family:var(--font-display)]">
        {title}
      </h2>
      {description && <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground">{description}</p>}
    </div>
  );
}

/** Feature/step card used on the home + install pages. */
export function Card({
  icon,
  title,
  children,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-card/40 p-5 transition-colors hover:border-primary/40",
        className
      )}
    >
      {icon && (
        <div className="mb-3.5 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--brand-orange)]/25 bg-[var(--brand-orange)]/10 text-[var(--brand-orange)]">
          {icon}
        </div>
      )}
      <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
      <div className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}

/** Primary / secondary pill links. */
export function Btn({
  href,
  children,
  variant = "primary",
  className,
  external,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
  className?: string;
  external?: boolean;
}) {
  const cls = cn(
    "inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-all",
    variant === "primary"
      ? "bg-primary text-primary-foreground hover:opacity-90"
      : "border border-border/70 text-foreground hover:border-foreground/40",
    className
  );
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} className={cls}>
      {children}
    </a>
  );
}
