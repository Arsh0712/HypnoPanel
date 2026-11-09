"use client";

import { animate, useMotionValue } from "framer-motion";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fadeUp, stagger } from "./motion";

/**
 * Shared UI primitives for panel views. Every view composes these so headers,
 * stat cards, empty states and status chips look identical across the panel.
 */

/* ————————————————————————— view header ————————————————————————— */

export function ViewHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-3", className)}>
      <div className="min-w-0">
        <h1 className="text-xl md:text-[22px] font-semibold tracking-tight leading-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed max-w-2xl">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

/* ————————————————————————— animated number ————————————————————————— */

export function AnimatedNumber({
  value,
  format,
  className,
  duration = 0.9,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  duration?: number;
}) {
  const mv = useMotionValue(0);
  const [text, setText] = useState(() => (format ? format(0) : "0"));

  useEffect(() => {
    const controls = animate(mv, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setText((format ? format(v) : `${Math.round(v)}`)),
    });
    return () => controls.stop();
  }, [value]);

  return (
    <span className={cn("tabular-nums", className)}>{text}</span>
  );
}

/* ————————————————————————— stat card ————————————————————————— */

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accentClass,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accentClass?: string;
  className?: string;
}) {
  return (
    <Card className={cn("hipno-card overflow-hidden transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/[0.04] dark:hover:shadow-black/20", className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {label}
            </p>
            <div className="mt-1.5 text-[26px] leading-none font-semibold tracking-tight truncate">
              {value}
            </div>
            {sub && <p className="mt-2 text-xs text-muted-foreground truncate">{sub}</p>}
          </div>
          <div
            className={cn(
              "shrink-0 h-9 w-9 rounded-lg grid place-items-center bg-primary/10 text-primary",
              accentClass
            )}
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ————————————————————————— section card ————————————————————————— */

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn("hipno-card", className)}>
      {(title || actions) && (
        <CardHeader className="flex flex-row items-start justify-between gap-3 py-4">
          <div className="min-w-0">
            <CardTitle className="text-[15px] font-semibold tracking-tight">{title}</CardTitle>
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </CardHeader>
      )}
      <CardContent className={cn("pt-0", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

/* ————————————————————————— status chips ————————————————————————— */

const STATUS_STYLES: Record<string, string> = {
  ok: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  pass: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  active: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  connected: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  running: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  warn: "bg-amber-500/14 text-amber-600 dark:text-amber-400 border-amber-500/25",
  warning: "bg-amber-500/14 text-amber-600 dark:text-amber-400 border-amber-500/25",
  degraded: "bg-amber-500/14 text-amber-600 dark:text-amber-400 border-amber-500/25",
  fail: "bg-red-500/12 text-red-600 dark:text-red-400 border-red-500/25",
  error: "bg-red-500/12 text-red-600 dark:text-red-400 border-red-500/25",
  firing: "bg-red-500/12 text-red-600 dark:text-red-400 border-red-500/25",
  offline: "bg-red-500/12 text-red-600 dark:text-red-400 border-red-500/25",
  stopped: "bg-zinc-500/12 text-zinc-600 dark:text-zinc-400 border-zinc-500/25",
  disabled: "bg-zinc-500/12 text-zinc-600 dark:text-zinc-400 border-zinc-500/25",
  info: "bg-primary/10 text-primary border-primary/20",
  na: "bg-zinc-500/10 text-muted-foreground border-border",
};

export function StatusChip({ status, label, className }: { status: string; label?: string; className?: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.info;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
        style,
        className
      )}
    >
      {status !== "na" && (
        <span className="h-1.5 w-1.5 rounded-full bg-current hipno-pulse" aria-hidden />
      )}
      {label ?? status}
    </span>
  );
}

/* ————————————————————————— empty state ————————————————————————— */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-14 px-6", className)}>
      <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary grid place-items-center">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <h3 className="mt-4 text-[15px] font-semibold tracking-tight">{title}</h3>
      {description && (
        <p className="mt-1.5 text-sm text-muted-foreground max-w-sm leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ————————————————————————— motion wrappers ————————————————————————— */

import { motion } from "framer-motion";

export function MotionDiv(props: React.ComponentProps<typeof motion.div>) {
  return <motion.div {...props} />;
}

export { fadeUp, stagger };
