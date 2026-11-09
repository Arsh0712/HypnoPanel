import dns from "node:dns/promises";
import net from "node:net";
import os from "node:os";
import { getPublicIps } from "@/lib/sysinfo";
import { VERIFY_RESOLVERS } from "@/lib/dns-verify";
import { makeDirectResolver } from "@/app/api/dns/_lib/records";

/**
 * Real mail-deliverability checks (spec §5.17): PTR, forward-confirmed
 * reverse DNS, hostname alignment, outbound port connectivity, DNS blocklists
 * and per-domain SPF/DKIM/DMARC. Everything here hits the live network.
 */

export interface MailCheck {
  key: string;
  title: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface PortCheck {
  port: number;
  host: string;
  purpose: string;
  note: string;
  open: boolean;
  ms: number | null;
}

export interface RecordCheck {
  status: "pass" | "warn" | "fail";
  found: string[];
  expected: string;
  detail: string;
}

function codeOf(e: unknown): string {
  const code = (e as NodeJS.ErrnoException).code;
  return code || "query failed";
}

/** System-resolver reverse lookup (what receiving servers see), 4 s timeout. */
async function sysReverse(ip: string): Promise<string[]> {
  const r = new dns.Resolver({ timeout: 4000, tries: 1 });
  return r.reverse(ip);
}

async function sysResolve(hostname: string, family: 4 | 6): Promise<string[]> {
  const r = new dns.Resolver({ timeout: 4000, tries: 1 });
  return family === 4 ? r.resolve4(hostname) : r.resolve6(hostname);
}

/**
 * Public TXT lookup — direct queries against every VERIFY_RESOLVER (the
 * dns-verify.ts pattern) so we see the internet's view, not a local cache.
 * NXDOMAIN from any resolver is authoritative: no such record.
 */
export async function queryTxtPublic(name: string): Promise<{ values: string[]; error: string | null }> {
  let lastError = "no resolver answered";
  for (const server of VERIFY_RESOLVERS) {
    const r = makeDirectResolver(server);
    try {
      const chunks = await r.resolveTxt(name);
      return { values: chunks.map((c) => c.join("")), error: null };
    } catch (e) {
      const code = codeOf(e);
      if (code === "ENOTFOUND" || code === "ENODATA") return { values: [], error: null };
      lastError = code;
    }
  }
  return { values: [], error: lastError };
}

/** Outbound TCP connect with a hard timeout (4 s). */
function checkTcpPort(host: string, port: number, timeoutMs = 4000): Promise<{ open: boolean; ms: number | null }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const sock = new net.Socket();
    const done = (open: boolean) => {
      const ms = Date.now() - started;
      sock.destroy();
      resolve({ open, ms: open ? ms : null });
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.connect(port, host);
  });
}

const PORT_TARGETS: { port: number; host: string; purpose: string; note: string }[] = [
  {
    port: 25,
    host: "gmail-smtp-in.l.google.com",
    purpose: "SMTP relay (MX delivery)",
    note: "Direct outbound delivery to other mail servers. Many VPS providers block port 25 by default — ask your provider to unblock it, or deliver through the SMTP relay in the Mail server tab.",
  },
  {
    port: 587,
    host: "smtp.gmail.com",
    purpose: "Submission · STARTTLS",
    note: "The recommended port for authenticated mail submission.",
  },
  {
    port: 465,
    host: "smtp.gmail.com",
    purpose: "SMTPS · implicit TLS",
    note: "Legacy implicit-TLS submission port; prefer 587 unless your relay requires it.",
  },
  {
    port: 2525,
    host: "smtp-relay.gmail.com",
    purpose: "Alternative submission",
    note: "Fallback submission port, useful when 587 is blocked; accepted by many relay providers.",
  },
  { port: 993, host: "imap.gmail.com", purpose: "IMAPS", note: "Encrypted IMAP for reading mail." },
  { port: 995, host: "pop.gmail.com", purpose: "POP3S", note: "Encrypted POP3 for reading mail." },
];

const DNSBL_LISTS = ["zen.spamhaus.org", "bl.spamcop.net", "b.barracudacentral.org"];

/** SPF / DKIM / DMARC record checks for one mail domain (live DNS). */
export async function checkDomainRecords(domain: {
  domain: string;
  dkimSelector: string;
  dkimPublic: string | null;
}): Promise<{ spf: RecordCheck; dkim: RecordCheck; dmarc: RecordCheck }> {
  const [spfRaw, dmarcRaw, dkimRaw] = await Promise.all([
    queryTxtPublic(domain.domain),
    queryTxtPublic(`_dmarc.${domain.domain}`),
    domain.dkimPublic ? queryTxtPublic(`${domain.dkimSelector}._domainkey.${domain.domain}`) : Promise.resolve({ values: [], error: null }),
  ]);

  const spfValues = spfRaw.values.filter((v) => v.toLowerCase().startsWith("v=spf1"));
  const spf: RecordCheck = spfRaw.error
    ? { status: "fail", found: [], expected: "v=spf1 mx -all", detail: `Lookup failed (${spfRaw.error}).` }
    : spfValues.length
      ? { status: "pass", found: spfValues, expected: "v=spf1 mx -all", detail: `SPF published: ${spfValues[0]}` }
      : {
          status: "fail",
          found: [],
          expected: "v=spf1 mx -all",
          detail: "No SPF record found on TXT @ — mail from this domain will look unauthorised.",
        };

  const dmarcValues = dmarcRaw.values.filter((v) => v.toLowerCase().startsWith("v=dmarc1"));
  const dmarc: RecordCheck = dmarcRaw.error
    ? { status: "fail", found: [], expected: `v=DMARC1; p=…`, detail: `Lookup failed (${dmarcRaw.error}).` }
    : dmarcValues.length
      ? { status: "pass", found: dmarcValues, expected: "v=DMARC1; p=…", detail: `DMARC policy published: ${dmarcValues[0]}` }
      : {
          status: "fail",
          found: [],
          expected: "v=DMARC1; p=quarantine",
          detail: "No DMARC record found on TXT _dmarc — receivers cannot apply your policy.",
        };

  let dkim: RecordCheck;
  if (!domain.dkimPublic) {
    dkim = {
      status: "warn",
      found: [],
      expected: "v=DKIM1; k=rsa; p=…",
      detail: "No DKIM key generated in the panel yet — generate one in the Mail server tab and publish its TXT record.",
    };
  } else if (dkimRaw.error) {
    dkim = {
      status: "fail",
      found: [],
      expected: "v=DKIM1; k=rsa; p=…",
      detail: `Lookup failed (${dkimRaw.error}).`,
    };
  } else {
    const pFound = dkimRaw.values.some((v) => v.includes("p="));
    dkim = pFound
      ? { status: "pass", found: dkimRaw.values, expected: "v=DKIM1; k=rsa; p=…", detail: `DKIM public key published at ${domain.dkimSelector}._domainkey` }
      : {
          status: "fail",
          found: dkimRaw.values,
          expected: `v=DKIM1; k=rsa; p=${domain.dkimPublic.slice(0, 24)}…`,
          detail: `No DKIM TXT record at ${domain.dkimSelector}._domainkey — copy the exact value from the Mail server tab.`,
        };
  }

  return { spf, dmarc, dkim };
}

export interface MailCheckResult {
  at: number;
  hostname: string;
  ips: { v4: string | null; v6: string | null };
  checks: MailCheck[];
  ports: PortCheck[];
  dnsbl: { ip: string | null; lists: { name: string; listed: boolean; code: string | null; detail: string }[] } | null;
  domains: { domain: string; spf: RecordCheck; dmarc: RecordCheck; dkim: RecordCheck }[];
}

/** Run every readiness check — as parallel as the checks allow. */
export async function runMailChecks(
  mailDomains: { domain: string; dkimSelector: string; dkimPublic: string | null }[]
): Promise<MailCheckResult> {
  const [ips, portResults, domainResults] = await Promise.all([
    getPublicIps(),
    Promise.all(PORT_TARGETS.map(async (t) => ({ ...t, ...(await checkTcpPort(t.host, t.port)) }))),
    Promise.all(mailDomains.map(async (d) => ({ domain: d.domain, ...(await checkDomainRecords(d)) }))),
  ]);

  const hostname = os.hostname().toLowerCase();
  const checks: MailCheck[] = [];

  // PTR + FCrDNS per IP (parallel), then hostname alignment
  async function ptrChecks(ip: string, label: string): Promise<void> {
    let ptrs: string[] = [];
    let ptrError: string | null = null;
    try {
      ptrs = (await sysReverse(ip)).map((h) => h.toLowerCase());
    } catch (e) {
      ptrError = codeOf(e);
    }
    const family = label === "v4" ? 4 : 6;

    if (ptrs.length === 0) {
      checks.push({
        key: `ptr_${label}`,
        title: `PTR (reverse DNS) — ${ip}`,
        status: "fail",
        detail: `No PTR record is set for ${ip}${ptrError && ptrError !== "ENOTFOUND" ? ` (lookup: ${ptrError})` : ""}. Only the owner of the IP address — your VPS provider — can set it. Use the support-ticket template below.`,
      });
      checks.push({
        key: `fcrdns_${label}`,
        title: `Forward-confirmed reverse DNS — ${ip}`,
        status: "fail",
        detail: `Cannot confirm: there is no PTR hostname for ${ip} to resolve back.`,
      });
      return;
    }

    const matchesHostname = ptrs.includes(hostname);
    checks.push({
      key: `ptr_${label}`,
      title: `PTR (reverse DNS) — ${ip}`,
      status: matchesHostname ? "pass" : "warn",
      detail: matchesHostname
        ? `PTR points to this server's hostname (${hostname}).`
        : `PTR points to ${ptrs.join(", ")}, but this server's hostname is ${hostname}. Receivers flag the mismatch — ask your provider to set the PTR to ${hostname}.`,
    });

    const forwardPerHost = await Promise.all(
      ptrs.map(async (h) => {
        try {
          return await sysResolve(h, family);
        } catch {
          return [];
        }
      })
    );
    const forward = forwardPerHost.flat();
    if (forward.includes(ip)) {
      checks.push({
        key: `fcrdns_${label}`,
        title: `Forward-confirmed reverse DNS — ${ip}`,
        status: "pass",
        detail: `PTR hostname${ptrs.length === 1 ? "" : "s"} ${ptrs.join(", ")} resolve${ptrs.length === 1 ? "s" : ""} back to ${ip}.`,
      });
    } else {
      checks.push({
        key: `fcrdns_${label}`,
        title: `Forward-confirmed reverse DNS — ${ip}`,
        status: "fail",
        detail: forward.length
          ? `PTR hostname${ptrs.length === 1 ? "" : "s"} ${ptrs.join(", ")} resolve${ptrs.length === 1 ? "s" : ""} to ${forward.join(", ")} — not back to ${ip}. Update the forward record or the PTR so they match.`
          : `PTR hostname${ptrs.length === 1 ? "" : "s"} ${ptrs.join(", ")} ha${ptrs.length === 1 ? "s" : "ve"} no matching forward record. Create an A/AAAA record for it at your DNS provider.`,
      });
    }
  }

  const ptrTasks: Promise<void>[] = [];
  if (ips.v4) ptrTasks.push(ptrChecks(ips.v4, "v4"));
  if (ips.v6) ptrTasks.push(ptrChecks(ips.v6, "v6"));
  await Promise.all(ptrTasks);

  if (!ips.v4 && !ips.v6) {
    checks.push({
      key: "ips",
      title: "Public IP detection",
      status: "fail",
      detail: "Neither a public IPv4 nor IPv6 address could be detected for this server — PTR checks need at least one.",
    });
  }

  // hostname vs HELO vs PTR alignment
  const anyPtr = checks.filter((c) => c.key.startsWith("ptr_"));
  if (anyPtr.some((c) => c.status === "pass") && !anyPtr.some((c) => c.status === "warn")) {
    checks.push({
      key: "hostname",
      title: "Hostname / HELO / PTR alignment",
      status: "pass",
      detail: `This server announces itself as ${hostname} and its PTR agrees — the alignment receiving servers expect.`,
    });
  } else if (anyPtr.some((c) => c.status === "warn")) {
    checks.push({
      key: "hostname",
      title: "Hostname / HELO / PTR alignment",
      status: "warn",
      detail: `This server announces itself as ${hostname} but the PTR differs. Either change the server hostname (Server settings) or ask your provider to point the PTR at ${hostname}.`,
    });
  } else if (anyPtr.length > 0) {
    checks.push({
      key: "hostname",
      title: "Hostname / HELO / PTR alignment",
      status: "fail",
      detail: `No PTR record to align with the hostname (${hostname}). Receivers commonly reject HELO names whose reverse DNS is missing.`,
    });
  }

  // DNSBL for the public IPv4
  let dnsbl: MailCheckResult["dnsbl"] = null;
  if (ips.v4) {
    const rev = ips.v4.split(".").reverse().join(".");
    const lists = await Promise.all(
      DNSBL_LISTS.map(async (name) => {
        const r = new dns.Resolver({ timeout: 4000, tries: 1 });
        try {
          const answers = await r.resolve4(`${rev}.${name}`);
          const code = answers[0] ?? "";
          return {
            name,
            listed: true,
            code,
            detail: `LISTED — ${name} returned ${code}. Delisting: https://www.spamhaus.org/lookup/ (or the list's own delisting page). Until delisted, expect rejections.`,
          };
        } catch (e) {
          const err = codeOf(e);
          if (err === "ENOTFOUND" || err === "ENODATA") {
            return { name, listed: false, code: null, detail: `Clean — ${name} has no entry for ${ips.v4}.` };
          }
          return {
            name,
            listed: false,
            code: null,
            detail: `Could not query ${name} (${err}). Public-resolver restrictions can hide results — query from the server itself for certainty.`,
          };
        }
      })
    );
    dnsbl = { ip: ips.v4, lists };
  }

  return {
    at: Date.now(),
    hostname,
    ips,
    checks,
    ports: portResults,
    dnsbl,
    domains: domainResults,
  };
}
