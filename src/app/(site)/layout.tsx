import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { SiteProviders } from "@/components/site/site-providers";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <SiteProviders>
      {/* min-h-screen + flex-col + mt-auto footer ⇒ sticky footer on short pages, natural push on long ones */}
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </div>
    </SiteProviders>
  );
}
