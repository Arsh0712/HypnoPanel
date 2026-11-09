import Link from "next/link";
import { Github } from "lucide-react";
import { HypnoMark } from "./brand";
import { REPO_URL } from "./header";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/60 bg-background">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="flex items-center gap-2.5">
            <HypnoMark className="h-7 w-7" id="footer-g" />
            <span className="text-[15px] font-semibold tracking-tight">HipnoType Panel</span>
          </div>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
            The all-in-one panel for your single VPS. Websites, apps, bots, DNS, files and a real
            terminal — behind one rotating secret URL.
          </p>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <Github className="h-4 w-4" /> Arsh0712/HypnoPanel
          </a>
        </div>

        <nav aria-label="Product">
          <p className="text-sm font-semibold">Product</p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li><Link href="/install" className="hover:text-foreground">Install</Link></li>
            <li><Link href="/docs" className="hover:text-foreground">Documentation</Link></li>
            <li><Link href="/changelog" className="hover:text-foreground">Changelog</Link></li>
            <li><Link href="/docs/getting-started" className="hover:text-foreground">Getting started</Link></li>
          </ul>
        </nav>

        <nav aria-label="Project">
          <p className="text-sm font-semibold">Project</p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li><Link href="/security" className="hover:text-foreground">Security &amp; trust model</Link></li>
            <li><Link href="/docs/relay-trust" className="hover:text-foreground">The relay, explained</Link></li>
            <li><Link href="/docs/troubleshooting" className="hover:text-foreground">Troubleshooting</Link></li>
            <li><Link href="/docs/uninstalling" className="hover:text-foreground">Uninstall</Link></li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-border/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:px-6">
          <p>Built by HipnoType · MIT licensed · v1.0.0</p>
          <p>
            <a href="https://hypnotype.mangocloud.cyou" className="hover:text-foreground">
              hypnotype.mangocloud.cyou
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
