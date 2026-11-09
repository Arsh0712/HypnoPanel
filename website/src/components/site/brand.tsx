import { cn } from "@/lib/utils";

/**
 * HipnoType brand marks (website variant — self-contained so the standalone
 * Vercel app can copy this folder without any panel dependencies).
 *
 * The spiral: two counter-rotating open arcs and a centre point — a hypnotic
 * vortex in the brand's amber → orange → red gradient.
 */

const BRAND = {
  amber: "#ffb020",
  orange: "#ff6a3d",
  red: "#e63c5c",
};

export function HypnoMark({ className, id = "site-g" }: { className?: string; id?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden className={cn("h-9 w-9", className)}>
      <defs>
        <linearGradient id={id} x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={BRAND.amber} />
          <stop offset="0.52" stopColor={BRAND.orange} />
          <stop offset="1" stopColor={BRAND.red} />
        </linearGradient>
      </defs>
      <path d="M32 9.5a22.5 22.5 0 1 1-15.9 6.6" stroke={`url(#${id})`} strokeWidth="5.4" strokeLinecap="round" />
      <path
        d="M32 18.5a13.5 13.5 0 1 0 9.5 4"
        stroke={`url(#${id})`}
        strokeWidth="5.4"
        strokeLinecap="round"
        opacity="0.92"
      />
      <circle cx="32" cy="32" r="4.2" fill={`url(#${id})`} />
    </svg>
  );
}

/** Mark + wordmark lockup used across the site chrome. */
export function HypnoLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <HypnoMark className="h-8 w-8" id="site-logo-g" />
      <span className="text-[17px] font-semibold tracking-tight">
        HipnoType
        <span className="ml-1.5 font-normal text-muted-foreground">Panel</span>
      </span>
    </span>
  );
}
