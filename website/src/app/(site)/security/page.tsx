import type { Metadata } from "next";
import Link from "next/link";
import { Eye, FileSearch, KeyRound, Lock, ShieldCheck, TerminalSquare, Unplug } from "lucide-react";
import { Card, SectionHead } from "@/components/site/ui";
import { CopyCommand } from "@/components/site/copy-command";
import { REPO_URL } from "@/components/site/header";

export const metadata: Metadata = {
  title: "Security & trust",
  description:
    "HipnoType Panel's security model: authentication, encryption, the audit hash chain, the relay trust position, and how to report vulnerabilities.",
  alternates: { canonical: "/security" },
};

export default function SecurityPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
      <SectionHead
        eyebrow="Security & trust"
        title="Paranoid, on purpose"
        description="A control panel is the keys to your server. Here is exactly how HipnoType protects them — and where its trust boundaries sit."
      />

      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card icon={<KeyRound className="h-5 w-5" />} title="Authentication">
          Argon2id password hashing, enforced policy, brute-force lockout, forced first-login
          change, TOTP 2FA with recovery codes, server-side revocable sessions, three roles
          (admin / developer / viewer) checked on every API call.
        </Card>
        <Card icon={<Lock className="h-5 w-5" />} title="Secrets at rest">
          Cloudflare tokens, 2FA secrets and site basic-auth passwords are AES-256-GCM encrypted
          with a per-install key. The browser only ever sees fingerprints.
        </Card>
        <Card icon={<FileSearch className="h-5 w-5" />} title="Audit hash chain">
          Every meaningful action is appended to a hash-chained log — modifying any entry breaks the
          chain and is detectable in the UI and via the API.
        </Card>
        <Card icon={<Unplug className="h-5 w-5" />} title="Network posture">
          Zero inbound ports by default. The panel connects out to the relay; unknown access tokens
          get a byte-identical 404 with normalised latency, per-IP rate limits and bans.
        </Card>
        <Card icon={<TerminalSquare className="h-5 w-5" />} title="Terminal safety">
          Single-use 30-second tickets (never long-lived WS tokens), admin/developer only, idle and
          hard session caps, and terminal content is never logged.
        </Card>
        <Card icon={<ShieldCheck className="h-5 w-5" />} title="Self-hardening">
          Hardened systemd unit (no root, restricted capabilities), 60-second firewall rollback
          window, and honest status when a capability is missing instead of silent degradation.
        </Card>
      </div>

      <section className="mt-16 rounded-xl border border-[#ffb020]/30 bg-[#ffb020]/[0.05] p-6 sm:p-8">
        <h2 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
          <Eye className="h-5 w-5 text-[#ffb020]" /> The relay trust position
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          In the default setup your browser's TLS connection terminates at the HipnoType relay
          before being forwarded to your VPS over the outbound tunnel. That is the same trust
          position as a CDN or Cloudflare Tunnel — the relay can technically observe traffic, and it
          stores only hashes of your credentials (the implementation is public in the repository).
          If that position is not acceptable for your threat model, you have two honest options:
        </p>
        <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-muted-foreground">
          <li className="flex gap-2.5">
            <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#ffb020]" />
            <span>
              <strong className="text-foreground">Direct mode</strong> — the panel serves its own
              ACME certificate on port 443 at a domain you control; the relay leaves your traffic
              path entirely.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#ffb020]" />
            <span>
              <strong className="text-foreground">Self-hosted relay</strong> — the relay is open
              source with a one-command deploy pack; run it on infrastructure you control.
            </span>
          </li>
        </ul>
        <p className="mt-4 text-sm">
          <Link href="/docs/relay-trust" className="font-medium text-[var(--brand-orange)] hover:underline">
            Read the full trust model →
          </Link>
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight">Reporting a vulnerability</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Found something? Open a <strong>private security advisory</strong> — never a public
          issue — and we will respond within 72 hours. Fixes ship to the stable channel first.
        </p>
        <div className="mt-5">
          <CopyCommand
            command={`open ${REPO_URL}/security/advisories/new`}
            label="Browser"
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Please include reproduction steps, affected versions and impact. We credit reporters in
          the changelog unless you prefer to stay anonymous.
        </p>
      </section>
    </div>
  );
}
