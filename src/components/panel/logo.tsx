import { cn } from "@/lib/utils";

/**
 * HipnoType brand marks.
 *
 * The spiral: two counter-rotating open arcs and a centre point — a hypnotic
 * vortex rendered in the brand's amber → orange → red gradient. It reads as
 * "hypnosis" at a glance while staying crisp from 16 px favicons to hero sizes.
 */

export function HypnoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden className={cn("h-9 w-9", className)}>
      <defs>
        <linearGradient id="hypno-g" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--brand-amber)" />
          <stop offset="0.52" stopColor="var(--brand-orange)" />
          <stop offset="1" stopColor="var(--brand-red)" />
        </linearGradient>
      </defs>
      <path
        d="M32 9.5a22.5 22.5 0 1 1-15.9 6.6"
        stroke="url(#hypno-g)"
        strokeWidth="5.4"
        strokeLinecap="round"
      />
      <path
        d="M32 18.5a13.5 13.5 0 1 0 9.5 4"
        stroke="url(#hypno-g)"
        strokeWidth="5.4"
        strokeLinecap="round"
        opacity="0.92"
      />
      <circle cx="32" cy="32" r="4.2" fill="url(#hypno-g)" />
    </svg>
  );
}

/** Spinning variant — slow, elegant rotation used on loading/brand surfaces. */
export function HypnoMarkSpin({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <HypnoMark className="h-full w-full animate-[hypno-spin_9s_linear_infinite]" />
    </span>
  );
}

/** Mark + wordmark lockup. `panel` shows the lighter "Panel" suffix. */
export function HypnoLogo({
  className,
  size = "md",
  showPanel = true,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  showPanel?: boolean;
}) {
  const dims = {
    sm: { mark: "h-7 w-7", title: "text-[15px]" },
    md: { mark: "h-9 w-9", title: "text-lg" },
    lg: { mark: "h-12 w-12", title: "text-2xl" },
  }[size];
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <HypnoMark className={dims.mark} />
      <span className="font-semibold tracking-tight leading-none">
        <span className={dims.title}>HipnoType</span>
        {showPanel && (
          <span className={cn(dims.title, "ml-1.5 font-normal text-muted-foreground")}>Panel</span>
        )}
      </span>
    </span>
  );
}
