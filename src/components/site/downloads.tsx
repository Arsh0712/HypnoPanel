import Link from "next/link";
import { Download, FileDown, Github, Globe2, Package, ShieldCheck } from "lucide-react";
import { Card, SectionHead } from "@/components/site/ui";
import { REPO_URL } from "@/components/site/header";

/**
 * Release artifacts shipped in `public/downloads/`.
 * v1.2.0 — mirrors the changelog.
 */
export const RELEASE_VERSION = "1.2.0";
export const PANEL_TARBALL = `HypnoPanel-v${RELEASE_VERSION}.tar.gz`;
export const SITE_TARBALL = `HypnoType-Site-v${RELEASE_VERSION}.tar.gz`;
export const PANEL_SOURCE = "panel-source.tar.gz";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://hypnotype.mangocloud.cyou";

/**
 * Release Center — direct downloads for this build.
 *
 * Env-gated: only rendered when NEXT_PUBLIC_RELEASE_CENTER=1 (dev/preview
 * builds of the panel workspace). The public Vercel site renders the
 * evergreen {@link GetTheCode} section instead.
 */
export function ReleaseCenter() {
  if (process.env.NEXT_PUBLIC_RELEASE_CENTER !== "1") return null;

  const items = [
    {
      href: `/downloads/${PANEL_TARBALL}`,
      icon: <Package className="h-5 w-5" />,
      title: `Main Panel — ${PANEL_TARBALL}`,
      tag: "for your GitHub repo",
      body: (
        <>
          The complete HipnoType Panel source (panel + installer + relay + docs).
          Extract it and upload the files to <code className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-xs">Arsh0712/HypnoPanel</code>.
          Installing it on any VPS gives you a panel link right here on{" "}
          <span className="font-medium text-[var(--brand-orange)]">{SITE_URL.replace(/^https?:\/\//, "")}/server/panel/&lt;token&gt;/</span>.
        </>
      ),
    },
    {
      href: `/downloads/${SITE_TARBALL}`,
      icon: <Globe2 className="h-5 w-5" />,
      title: `Main Site — ${SITE_TARBALL}`,
      tag: "for Vercel",
      body: (
        <>
          This website as a standalone Next.js app: marketing site, docs,{" "}
          <code className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-xs">/install.sh</code> and the{" "}
          <code className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-xs">/server/panel/*</code> relay
          proxy. Import in Vercel, add the variables from{" "}
          <code className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-xs">.env.example</code>, attach the domain.
        </>
      ),
    },
    {
      href: `/downloads/${PANEL_SOURCE}`,
      icon: <FileDown className="h-5 w-5" />,
      title: `Installer asset — ${PANEL_SOURCE}`,
      tag: "what install.sh fetches",
      body: (
        <>
          The exact source archive the installer downloads when no GitHub
          release exists yet (the site mirrors it at{" "}
          <code className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-xs">{SITE_URL.replace(/^https?:\/\//, "")}/downloads/{PANEL_SOURCE}</code>).
          Attach it to a GitHub release as <code className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-xs">panel-source.tar.gz</code> for the primary path.
        </>
      ),
    },
  ];

  return (
    <section id="downloads" className="relative overflow-hidden border-b border-border/60">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-24 left-1/2 h-72 w-[720px] -translate-x-1/2 rounded-full bg-[var(--brand-orange)] opacity-[0.08] blur-[110px]" />
      </div>
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <SectionHead
          eyebrow={`Release Center · v${RELEASE_VERSION}`}
          title="Grab the packages"
          description="Two tarballs, one stack: the panel goes to your GitHub repo, the site goes to Vercel — and every install lands on this domain."
        />
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {items.map((it) => (
            <div key={it.title} className="flex h-full flex-col rounded-xl border border-border/60 bg-card/40 p-5 transition-colors hover:border-primary/40">
              <div className="mb-3.5 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--brand-orange)]/25 bg-[var(--brand-orange)]/10 text-[var(--brand-orange)]">
                {it.icon}
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{it.tag}</p>
              <h3 className="mt-1 break-all font-mono text-[13px] font-semibold tracking-tight">{it.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{it.body}</p>
              <a
                href={it.href}
                download
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Download className="h-4 w-4" /> Download
              </a>
            </div>
          ))}
        </div>
        <p className="mt-5 flex flex-wrap items-center justify-center gap-2 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-[var(--brand-orange)]" />
          Verify with{" "}
          <a href="/downloads/SHA256SUMS.txt" className="font-mono text-[var(--brand-orange)] hover:underline">
            SHA256SUMS.txt
          </a>{" "}
          · the installer asset also ships a{" "}
          <a href={`/downloads/${PANEL_SOURCE}.sha256`} className="font-mono text-[var(--brand-orange)] hover:underline">
            {PANEL_SOURCE}.sha256
          </a>{" "}
          sidecar
        </p>
      </div>
    </section>
  );
}

/**
 * Evergreen "get the code" section — shown on the public site.
 */
export function GetTheCode() {
  return (
    <section id="get-the-code" className="border-t border-border/60 bg-card/20">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <SectionHead
          eyebrow="Open source, fully"
          title="Get the code"
          description="Everything is on GitHub — and the install asset is mirrored right here, so the one-liner works even before you publish a release."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          <Card icon={<FileDown className="h-5 w-5" />} title="Panel source (installer asset)">
            The exact archive <code className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-xs">install.sh</code> builds
            from — served from this domain at{" "}
            <a href={`/downloads/${PANEL_SOURCE}`} className="font-mono text-xs text-[var(--brand-orange)] hover:underline">
              /downloads/{PANEL_SOURCE}
            </a>{" "}
            and verified against its{" "}
            <a href={`/downloads/${PANEL_SOURCE}.sha256`} className="font-mono text-xs text-[var(--brand-orange)] hover:underline">
              checksum
            </a>
            .
          </Card>
          <Card icon={<Github className="h-5 w-5" />} title="The full repository">
            Panel, relay, terminal service, installer, docs and the website
            source live in one repo:{" "}
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className="font-medium text-[var(--brand-orange)] hover:underline">
              Arsh0712/HypnoPanel
            </a>
            . Releases carry the same checksummed archives.
          </Card>
          <Card icon={<Globe2 className="h-5 w-5" />} title="This website (Vercel)">
            The site you are reading is the <code className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-xs">website/</code> folder
            of the repo — a standalone Next.js app. Import it in Vercel with{" "}
            <Link href="/docs/getting-started" className="font-medium text-[var(--brand-orange)] hover:underline">
              the deploy guide
            </Link>
            .
          </Card>
        </div>
      </div>
    </section>
  );
}
