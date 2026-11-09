"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** One-click copy box for terminal commands (the install command, CLI calls). */
export function CopyCommand({
  command,
  label,
  className,
}: {
  command: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // fallback for non-secure contexts
      const ta = document.createElement("textarea");
      ta.value = command;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className={cn("not-prose", className)}>
      {label && <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>}
      <div className="group flex items-center gap-3 rounded-xl border border-border bg-[#160e12] px-4 py-3.5 ring-1 ring-transparent transition-colors focus-within:border-primary/50">
        <span aria-hidden className="select-none font-mono text-sm text-[var(--brand-orange)]">$</span>
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[13px] leading-relaxed text-foreground sm:text-sm">
          {command}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy command"}
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all",
            copied
              ? "border-[var(--brand-orange)]/50 text-[var(--brand-orange)]"
              : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
          )}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
