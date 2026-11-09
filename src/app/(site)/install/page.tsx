import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, KeyRound, Lock, MonitorSmartphone, ShieldCheck, Terminal } from "lucide-react";
import { CopyCommand } from "@/components/site/copy-command";
import { Card, SectionHead } from "@/components/site/ui";
import { GetTheCode } from "@/components/site/downloads";
import { Inline } from "@/components/site/doc-render";

export const metadata: Metadata = {
  title: "Install HipnoType Panel",
  description:
    "Requirements, the one-line install command, what the installer does step by step, and your first login — the complete setup guide.",
  alternates: { canonical: "/install" },
};

const REQUIREMENTS = [
  ["VPS", "KVM/QEMU VPS (or bare metal) — most providers' standard instances"],
  ["OS", "Ubuntu 22.04 / 24.04 · Debian 12 · AlmaLinux 9 · Rocky 9"],
  ["Arch", "x86_64 or arm64"],
  ["RAM", "1 GB minimum (2 GB+ recommended for Docker app templates)"],
  ["Disk", "10 GB free minimum"],
  ["Network", "Outbound HTTPS (443) — the panel opens no inbound ports"],
  ["Access", "Root (the installer runs with sudo)"],
];

const STEPS = [
  ["Preflight", "Root, virtualization type, OS version, architecture, RAM, disk, systemd, cgroups v2, nftables support, conflicting panels (aaPanel, CyberPanel, cPanel…) and outbound reachability are checked — anything missing is reported honestly before anything is touched."],
  ["Dependencies", "curl, git, nftables, fail2ban and Caddy are installed from your distribution's repositories; Docker Engine is installed if you do not skip it (--no-docker)."],
  ["User & directories", "A dedicated hipno system user and /opt/hipno, /etc/hipno, /var/lib/hipno, /var/log/hipno and /var/backups/hipno are created with tight permissions."],
  ["Panel install", "The release is downloaded from GitHub Releases, the SHA-256 checksum is verified, and the panel is installed as a hardened systemd service (hipnod)."],
  ["Secrets", "A per-install encryption key is generated; an admin email and a one-time temporary password are written to a 0600 env file consumed on first boot."],
  ["Relay registration", "The panel registers itself with the relay over an outbound connection and opens its persistent WebSocket tunnel. Your VPS stays fully firewalled."],
  ["Health check", "hypno doctor runs a real PASS/FAIL sweep and the service state is verified before the summary is printed."],
  ["Summary", "The boxed result prints your panel URL, admin email and the one-time password notice — the password is shown exactly once, then consumed."],
];

const PROVIDERS = [
  {
    name: "DigitalOcean",
    steps: ["Control panel → your Droplet → top-right **Access** → **Launch Droplet Console**", "or SSH from your machine: `ssh root@<droplet-ip>`"],
  },
  {
    name: "Hetzner",
    steps: ["Cloud Console → your Server → **</> Console** (opens a VNC shell)", "or SSH: `ssh root@<server-ip>` (key or the initial root password from the panel)"],
  },
  {
    name: "Vultr",
    steps: ["Products → your instance → **View Console** (top right)", "or SSH: `ssh root@<instance-ip>`"],
  },
  {
    name: "Linode / Akamai",
    steps: ["Cloud Manager → your Linode → **Launch LISH Console**", "or SSH: `ssh root@<linode-ip>`"],
  },
  {
    name: "AWS Lightsail",
    steps: ["Console → your instance → top-right terminal icon (**Connect**) → browser SSH", "or SSH with your key pair: `ssh -i <key.pem> ubuntu@<instance-ip>` then `sudo -i`"],
  },
];

export default function InstallPage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-border/60">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-32 left-1/2 h-80 w-[640px] -translate-x-1/2 rounded-full bg-[var(--brand-orange)] opacity-[0.06] blur-[110px]" />
        </div>
        <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-orange)]">Setup</p>
          <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight sm:text-5xl [font-family:var(--font-display)]">
            Install in{" "}
            <span className="bg-gradient-to-r from-[var(--brand-amber)] via-[var(--brand-orange)] to-[var(--brand-red)] bg-clip-text text-transparent italic">
              one command
            </span>
          </h1>
          <p className="mt-5 text-pretty leading-relaxed text-muted-foreground">
            HipnoType installs on a fresh VPS in about two minutes. It is idempotent — re-running the
            command upgrades in place without touching your data.
          </p>
          <div className="mt-8">
            <CopyCommand
              command="curl -fsSL https://hypnotype.mangocloud.cyou/install.sh | sudo bash"
              label="The one-liner"
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Verify the script first if you prefer:{" "}
            <code className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono">
              curl -fsSL https://hypnotype.mangocloud.cyou/install.sh -o install.sh &amp;&amp; sha256sum -c install.sh.sha256
            </code>
          </p>
        </div>
      </section>

      {/* requirements */}
      <section className="border-b border-border/60">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <SectionHead align="left" eyebrow="Before you start" title="Requirements" />
          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-xl border border-border/60">
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {REQUIREMENTS.map(([k, v]) => (
                    <tr key={k} className="border-b border-border/50 last:border-0">
                      <td className="w-28 bg-muted/30 px-4 py-3 font-semibold">{k}</td>
                      <td className="px-4 py-3 text-muted-foreground">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Card icon={<MonitorSmartphone className="h-5 w-5" />} title="Need a VPS first?" className="h-full">
              Any KVM provider works — DigitalOcean, Hetzner, Vultr, Linode, OVH, Netcup or your
              own metal. Pick the cheapest 1 GB instance running Ubuntu 24.04 and you are ready.
              Full environment matrix in{" "}
              <Link href="/docs/requirements" className="font-medium text-[var(--brand-orange)] hover:underline">
                Requirements &amp; compatibility
              </Link>
              .
            </Card>
          </div>
        </div>
      </section>

      {/* what the installer does */}
      <section className="border-b border-border/60 bg-card/20">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <SectionHead align="left" eyebrow="No magic" title="What the installer does, step by step" />
          <ol className="mt-8 space-y-4">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="flex gap-4 rounded-xl border border-border/60 bg-background p-5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[var(--brand-orange)]/30 bg-[var(--brand-orange)]/10 font-mono text-sm font-semibold text-[var(--brand-orange)]">
                  {i + 1}
                </span>
                <div>
                  <p className="text-[15px] font-semibold tracking-tight">{title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-muted-foreground">
            Flags for automation: <code className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-xs">--yes</code>{" "}
            (no prompts), <code className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-xs">--no-docker</code>,{" "}
            <code className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-xs">--mode relay|direct</code>,{" "}
            <code className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-xs">--version &lt;tag&gt;</code>,{" "}
            <code className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-xs">--uninstall</code>.
          </p>
        </div>
      </section>

      {/* expected output */}
      <section className="border-b border-border/60">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <SectionHead align="left" eyebrow="Know what to expect" title="The result you should see" />
          <div className="mt-8 overflow-x-auto rounded-xl border border-border/70 bg-[#160e12] p-5 font-mono text-[13px] leading-relaxed">
            <pre className="text-foreground/90"><code>{` ┌──────────────────────────────────────────────────────────────────┐
 │  HipnoType Panel installed successfully                          │
 │                                                                  │
 │  Panel URL : https://hypnotype.mangocloud.cyou/server/panel/vDVB3ic7v7uGwnkr73V2FzLuKeKxXc72/
 │  Email     : admin@hypnotype.mangocloud.cyou                     │
 │  Password  : (temporary, shown once — first login forces change) │
 │                                                                  │
 │  Save the URL now — it is the only way in.                       │
 │  Commands  : hypno --help   |   hypno rotate   |   hypno doctor  │
 └──────────────────────────────────────────────────────────────────┘`}</code></pre>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            The 32-character suffix of the URL is the secret. Treat it like a password — and rotate
            it any time with <code className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-xs">hypno rotate</code>.
          </p>
        </div>
      </section>

      {/* first login */}
      <section className="border-b border-border/60 bg-card/20">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <SectionHead align="left" eyebrow="First login" title="Unlock, harden, explore" />
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <Card icon={<Lock className="h-5 w-5" />} title="1 · Unlock">
              Open the printed URL. Log in with the admin email and the temporary password from the
              installer box.
            </Card>
            <Card icon={<KeyRound className="h-5 w-5" />} title="2 · Set your real password">
              The panel forces a password change on first login (policy-enforced). The temporary
              password is consumed and gone.
            </Card>
            <Card icon={<ShieldCheck className="h-5 w-5" />} title="3 · Turn on 2FA">
              Scan the offered QR code with any authenticator app and store the recovery codes
              somewhere safe. Done — you are on the dashboard.
            </Card>
          </div>
        </div>
      </section>

      {/* provider tabs */}
      <section className="border-b border-border/60">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <SectionHead
            align="left"
            eyebrow="Where do I even type this?"
            title="Opening a console on common providers"
            description="Every provider has a browser console; SSH from your own machine works everywhere too."
          />
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {PROVIDERS.map((p) => (
              <div key={p.name} className="rounded-xl border border-border/60 p-5">
                <p className="inline-flex items-center gap-2 text-sm font-semibold">
                  <Terminal className="h-4 w-4 text-[var(--brand-orange)]" /> {p.name}
                </p>
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
                  {p.steps.map((s, i) => (
                    <li key={i} className="flex gap-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-orange)]/70" />
                      <span>
                        <Inline text={s} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* next steps */}
      <section>
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <SectionHead align="left" eyebrow="You are in — now what?" title="Next steps" />
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <Link href="/docs/getting-started" className="group rounded-xl border border-border/60 p-5 transition-colors hover:border-primary/40">
              <p className="text-sm font-semibold">Take the 5-minute tour</p>
              <p className="mt-1 text-sm text-muted-foreground">Dashboard, websites, apps, files, terminal.</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm text-[var(--brand-orange)]">Guide <ArrowRight className="h-3.5 w-3.5" /></span>
            </Link>
            <Link href="/docs/domains-dns" className="group rounded-xl border border-border/60 p-5 transition-colors hover:border-primary/40">
              <p className="text-sm font-semibold">Connect Cloudflare DNS</p>
              <p className="mt-1 text-sm text-muted-foreground">Scoped token, record import, two-way sync.</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm text-[var(--brand-orange)]">Guide <ArrowRight className="h-3.5 w-3.5" /></span>
            </Link>
            <Link href="/docs/access-url" className="group rounded-xl border border-border/60 p-5 transition-colors hover:border-primary/40">
              <p className="text-sm font-semibold">Understand the access URL</p>
              <p className="mt-1 text-sm text-muted-foreground">Rotation, sessions and the tunnel model.</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm text-[var(--brand-orange)]">Guide <ArrowRight className="h-3.5 w-3.5" /></span>
            </Link>
          </div>
        </div>
      </section>

      {/* get the code */}
      <GetTheCode />
    </>
  );
}
