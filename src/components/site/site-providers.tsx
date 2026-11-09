"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Site providers for the standalone website build. In the panel workspace the
 * root AppProviders already wraps everything — this nested provider is
 * configured identically (class strategy, dark default) so both trees agree.
 */
export function SiteProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      {children}
    </ThemeProvider>
  );
}
