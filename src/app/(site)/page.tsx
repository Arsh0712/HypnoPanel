import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Boxes,
  Check,
  FileCode2,
  FlameKindling,
  FolderTree,
  Globe2,
  HardDriveDownload,
  KeyRound,
  LifeBuoy,
  Network,
  ScrollText,
  ShieldCheck,
  TerminalSquare,
  Unplug,
} from "lucide-react";
import { CopyCommand } from "@/components/site/copy-command";
import { Btn, Card, SectionHead } from "@/components/site/ui";
import { GetTheCode, ReleaseCenter } from "@/components/site/downloads";
import { HypnoMark } from "@/components/site/brand";
import { REPO_URL } from "@/components/site/header";

export const metadata: Metadata = {
  title: { absolute: "HipnoType Panel — one panel for your VPS" },
  description:
    "Websites, apps, bots, DNS, files and a real terminal — in one dark, beautiful panel behind a rotating secret URL. Install in one command.",
  alternates: { canonical: "/" },
};

const FEATURES = [
  {
    icon: <Globe2 className="h-5 w-5" />,
    title: "Websites & projects",
    body: "Static, PHP, Node and reverse-proxy sites with real files on disk, generated vhost configs, SSL and live DNS verification.",
    href: "/docs/websites",
  },
  {
    icon: <Network className="h-5 w-5" />,
    title: "Domains & DNS",
    body: "Connect Cloudflare with a scoped API token, import every existing record and sync both ways with a reviewed diff.",
    href: "/docs/domains-dns",
  },
  {
    icon: <Boxes className="h-5 w-5" />,
    title: "Apps & templates",
    body: "22 one-click templates — WordPress, Ghost, n8n, Gitea, PostgreSQL… — or deploy from any Git repository.",
    href: "/docs/apps",
  },
  {
    icon: <Bot className="h-5 w-5" />,
    title: "Bots & workers",
    body: "Long-running processes run as first-class apps: env-var secrets, restart policies, live logs and exit codes — no fakery.",
    href: "/docs/bots",
  },
  {
    icon: <FolderTree className="h-5 w-5" />,
    title: "IDE-grade files",
    body: "A real file workspace: tree, Monaco editor, archives, uploads, trash and path-jailed, audited operations.",
    href: "/docs/files",
  },
  {
    icon: <TerminalSquare className="h-5 w-5" />,
    title: "Terminal in the browser",
    body: "A genuine shell over xterm.js — PTY when available, single-use tickets, role-limited, never logged.",
    href: "/docs/terminal",
  },
  {
    icon: <FlameKindling className="h-5 w-5" />,
    title: "Firewall with a safety net",
    body: "nftables rules with a 60-second rollback window — lock yourself out and the panel undoes it for you.",
    href: "/docs/firewall",
  },
  {
    icon: <HardDriveDownload className="h-5 w-5" />,
    title: "Backups that verify",
    body: "Checksummed archives you can inspect, restore or download — with an honest reminder to keep a copy off-site.",
    href: "/docs/backups",
  },
  {
    icon: <LifeBuoy className="h-5 w-5" />,
    title: "Monitoring & alerts",
    body: "Live metrics, rules with severities, a bell that badges the browser tab, and delivery to email or webhooks.",
    href: "/docs/getting-started",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Run one command",
    body: (
      <>
        On a fresh Ubuntu, Debian, AlmaLinux or Rocky VPS:
        <br />
        <code className="font-mono text-[13px] text-[var(--brand-orange)]">
          curl -fsSL https://hypnotype.mangocloud.cyou/install.sh | sudo bash
        </code>
      </>
    ),
  },
  {
    n: "02",
    title: "Open your secret URL",
    body: "The installer prints a boxed summary: a 32-character access URL, the admin email and a one-time password. The panel itself opens zero inbound ports — it tunnels out.",
  },
  {
    n: "03",
    title: "Build something",
    body: "Unlock, set your real password, turn on 2FA — then ship a website, deploy an app or open a terminal. Everything is real from second one.",
  },
];

const COMPARE = {
  head: ["", "HipnoType", "hPanel", "aaPanel", "CyberPanel", "CloudPanel", "Coolify"],
  rows: [
    ["Self-hosted on your VPS", "yes", "no", "yes", "yes", "yes", "yes"],
    ["Free & open source", "yes", "no", "yes", "yes", "—", "yes"],
    ["Rotating secret access URL", "yes", "no", "no", "no", "no", "no"],
    ["Cloudflare DNS two-way sync", "yes", "—", "—", "—", "—", "—"],
    ["Browser terminal included", "yes", "no", "yes", "yes", "yes", "yes"],
    ["Single-VPS focus (no cluster tax)", "yes", "—", "yes", "yes", "yes", "no"],
  ],
};

const FAQ = [
  {
    q: "Do I need a domain to use it?",
    a: "No. Your panel is reachable from day one through its secret URL on the shared domain. Domains are only needed for the websites you host — and you bring your own at the registrar of your choice.",
  },
  {
    q: "Can the relay see my traffic?",
    a: "In the default relay mode, TLS terminates at the relay — the same trust position as a CDN or Cloudflare Tunnel. If that is not acceptable, the panel has a direct mode with its own certificate on a domain you control, and the relay itself is open source so you can run your own.",
  },
  {
    q: "Which VPS works?",
    a: "Any KVM/QEMU VPS (the vast majority) with Ubuntu 22.04/24.04, Debian 12, AlmaLinux 9 or Rocky 9, 1 GB RAM and 10 GB disk. LXC and Docker environments install with honest feature gating; OpenVZ is refused.",
  },
  {
    q: "What does it cost?",
    a: "The panel is free and open source (MIT). You pay only for your VPS — and the domains you choose to buy.",
  },
  {
    q: "How do I lock things down after a leak?",
    a: "hypno rotate issues a brand-new access URL in one command. Every existing session is revoked and the old URL dies instantly.",
  },
  {
    q: "Is it ready for production?",
    a: "v1.0 ships the full ops surface — auth with 2FA, audit hash chain, backups with verification, firewall rollback and honest status everywhere. Test it on a fresh VPS and judge by the doctor output, not by promises.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* ------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[var(--brand-orange)] opacity-[0.07] blur-[120px]" />
          <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-[var(--brand-red)] opacity-[0.05] blur-[100px]" />
        </div>

        <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pb-24 sm:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/50 px-3.5 py-1.5 text-xs font-medium text-muted-foreground">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand-orange)]" />
              v1.2.0 · open source · single-VPS by design
            </p>
            <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl [font-family:var(--font-display)]">
              One VPS.{" "}
              <span className="bg-gradient-to-r from-[var(--brand-amber)] via-[var(--brand-orange)] to-[var(--brand-red)] bg-clip-text text-transparent italic">
                Everything
              </span>{" "}
              under control.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              HipnoType Panel puts websites, apps, bots, DNS, files, a real terminal, firewall and
              backups in one dark, beautiful panel — behind a rotating secret URL that opens zero
              inbound ports.
            </p>

            <div className="mx-auto mt-8 max-w-2xl text-left">
              <CopyCommand
                command="curl -fsSL https://hypnotype.mangocloud.cyou/install.sh | sudo bash"
                label="Install on a fresh Ubuntu / Debian / EL9 VPS"
              />
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Btn href="/install">
                Install guide <ArrowRight className="h-4 w-4" />
              </Btn>
              <Btn href="/docs" variant="ghost">
                Read the docs
              </Btn>
              <Btn href={REPO_URL} variant="ghost" external>
                <ScrollText className="h-4 w-4" /> Source &amp; releases
              </Btn>
            </div>
          </div>

          <ul className="mx-auto mt-12 flex max-w-4xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
            {[
              "Outbound-only tunnel",
              "Argon2id + TOTP 2FA",
              "Audit hash chain",
              "AES-256-GCM secrets",
            ].map((t) => (
              <li key={t} className="inline-flex items-center gap-2">
                <Check className="h-4 w-4 text-[var(--brand-orange)]" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------- release center */}
      <ReleaseCenter />

      {/* --------------------------------------------------------- features */}
      <section className="border-t border-border/60 bg-card/20">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <SectionHead
            eyebrow="The whole toolbox"
            title="Every module is real"
            description="No simulated states, no 'staged' deploys, no demo data. If a feature is unavailable in your environment, the panel says so — with the action to fix it."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <Link key={f.title} href={f.href} className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <Card
                  icon={f.icon}
                  title={f.title}
                  className="h-full group-hover:border-primary/40 group-focus-visible:border-primary/60"
                >
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-[var(--brand-orange)] opacity-0 transition-opacity group-hover:opacity-100">
                    Guide <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                  {f.body}
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ how it works */}
      <section className="border-t border-border/60">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <SectionHead
            eyebrow="How it works"
            title="From zero to panel in three steps"
            description="The installer does the work; you keep the keys."
          />
          <ol className="mt-12 grid gap-4 md:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n}>
                <Card title={s.title} className="h-full">
                  <span className="mb-3 block font-mono text-xs font-semibold tracking-widest text-[var(--brand-orange)]">
                    {s.n}
                  </span>
                  <div className="[&_code]:break-all">{s.body}</div>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ----------------------------------------------------- environments */}
      <section className="border-t border-border/60 bg-card/20">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <SectionHead
            eyebrow="Runs where kernels are real"
            title="Supported environments"
            description="Capability-checked, not guessed — the installer probes the machine and tells the truth."
          />
          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border/60 p-5">
              <p className="text-sm font-semibold">Virtualization</p>
              <ul className="mt-3 space-y-2.5 text-sm text-muted-foreground">
                <li className="flex items-center gap-2.5"><Check className="h-4 w-4 text-[var(--brand-orange)]" /> KVM / QEMU — full support (recommended)</li>
                <li className="flex items-center gap-2.5"><Check className="h-4 w-4 text-[var(--brand-orange)]" /> Bare metal, Xen, VMware, Hyper-V — full support</li>
                <li className="flex items-center gap-2.5"><Check className="h-4 w-4 text-[var(--brand-amber)]" /> LXC / LXD — with nesting, feature-gated honestly</li>
                <li className="flex items-center gap-2.5"><Check className="h-4 w-4 text-[var(--brand-amber)]" /> Docker / Podman — restricted mode, reported as such</li>
                <li className="flex items-center gap-2.5"><span className="text-[var(--brand-red)]">✗</span> OpenVZ — refused (no real kernel)</li>
              </ul>
            </div>
            <div className="rounded-xl border border-border/60 p-5">
              <p className="text-sm font-semibold">Operating systems</p>
              <ul className="mt-3 space-y-2.5 text-sm text-muted-foreground">
                <li className="flex items-center justify-between gap-3">Ubuntu 22.04 / 24.04 <span className="text-xs">x86_64 · arm64</span></li>
                <li className="flex items-center justify-between gap-3">Debian 12 <span className="text-xs">x86_64 · arm64</span></li>
                <li className="flex items-center justify-between gap-3">AlmaLinux 9 <span className="text-xs">x86_64</span></li>
                <li className="flex items-center justify-between gap-3">Rocky Linux 9 <span className="text-xs">x86_64</span></li>
                <li className="mt-3 border-t border-border/50 pt-3 text-xs">
                  1 GB RAM · 10 GB disk · outbound 443 only ·{" "}
                  <Link href="/docs/requirements" className="text-[var(--brand-orange)] hover:underline">
                    full matrix
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- comparison */}
      <section className="border-t border-border/60">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <SectionHead
            eyebrow="An honest comparison"
            title="How it stacks up"
            description="Only claims we can stand behind. “—” means we have not verified that cell — check the project's own docs."
          />
          <div className="mt-10 overflow-x-auto rounded-xl border border-border/60">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="bg-muted/40">
                  {COMPARE.head.map((h, i) => (
                    <th key={i} className={`px-4 py-3 text-left font-semibold ${i === 1 ? "text-[var(--brand-orange)]" : ""}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE.rows.map((row) => (
                  <tr key={row[0]} className="border-t border-border/50">
                    {row.map((cell, i) => (
                      <td key={i} className={`px-4 py-3 ${i === 0 ? "font-medium" : "text-muted-foreground"} ${i === 1 ? "text-center font-semibold text-[var(--brand-orange)]" : i > 1 ? "text-center" : ""}`}>
                        {cell === "yes" ? <Check className="mx-auto h-4 w-4 text-[var(--brand-orange)]" aria-label="yes" /> : cell === "no" ? <span className="text-[var(--brand-red)]/70">no</span> : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Compared against each project's public documentation as of November 2026. Verify before
            you buy anything.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------- security/trust */}
      <section className="border-t border-border/60 bg-card/20">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <SectionHead
            eyebrow="Security & trust"
            title="Built paranoid, on purpose"
            description="A panel is the keys to your server. HipnoType treats it that way."
          />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card icon={<KeyRound className="h-5 w-5" />} title="Secret-URL access">
              The access URL is a 32-character credential. Unknown tokens get a byte-identical 404 — no enumeration.
            </Card>
            <Card icon={<Unplug className="h-5 w-5" />} title="Zero inbound ports">
              The panel tunnels <em>out</em> to the relay. Nothing listens publicly on your VPS unless you enable direct mode.
            </Card>
            <Card icon={<ShieldCheck className="h-5 w-5" />} title="Encrypted secrets">
              Cloudflare tokens and 2FA secrets are AES-256-GCM encrypted at rest and never leave the box unencrypted.
            </Card>
            <Card icon={<FileCode2 className="h-5 w-5" />} title="Tamper-evident audit">
              Every action lands in a hash-chained audit log. Editing history breaks the chain visibly.
            </Card>
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center text-sm leading-relaxed text-muted-foreground">
            The relay in the default setup terminates TLS — like a CDN, it is in your trust path. Read{" "}
            <Link href="/docs/relay-trust" className="font-medium text-[var(--brand-orange)] hover:underline">
              the trust model
            </Link>{" "}
            before you decide, and switch to direct mode or{" "}
            <Link href="/docs/relay-trust" className="font-medium text-[var(--brand-orange)] hover:underline">
              self-host the relay
            </Link>{" "}
            if that position is not acceptable.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------ get the code */}
      <GetTheCode />

      {/* ---------------------------------------------------------------- FAQ */}
      <section className="border-t border-border/60">
        <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
          <SectionHead eyebrow="FAQ" title="Questions people actually ask" />
          <div className="mt-10 divide-y divide-border/50">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium tracking-tight [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border/60 text-muted-foreground transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- CTA */}
      <section className="border-t border-border/60 bg-gradient-to-b from-transparent via-[var(--brand-orange)]/[0.04] to-transparent">
        <div className="mx-auto w-full max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <HypnoMark className="mx-auto h-14 w-14" id="cta-g" />
          <h2 className="mt-6 text-balance text-3xl font-semibold tracking-tight sm:text-4xl [font-family:var(--font-display)]">
            Your VPS is waiting.{" "}
            <span className="bg-gradient-to-r from-[var(--brand-amber)] via-[var(--brand-orange)] to-[var(--brand-red)] bg-clip-text text-transparent italic">
              Put it under a spell.
            </span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-muted-foreground">
            One command, one secret URL, one beautiful panel. Free and open source — forever.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Btn href="/install">
              Install HipnoType <ArrowRight className="h-4 w-4" />
            </Btn>
            <Btn href="/docs" variant="ghost">
              Browse the docs
            </Btn>
          </div>
        </div>
      </section>
    </>
  );
}
