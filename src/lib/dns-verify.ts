import dns from "node:dns/promises";
import { domainToASCII } from "node:url";
import { randomBase62 } from "./crypto";

/**
 * Guided domain onboarding (spec §2) — normalisation, required-record
 * computation and REAL multi-resolver verification. Every check in here hits
 * live DNS (1.1.1.1, 8.8.8.8, 9.9.9.9 — queried directly so we see the
 * internet's view, not a local cache).
 */

export const VERIFY_RESOLVERS = ["1.1.1.1", "8.8.8.8", "9.9.9.9"] as const;

const RESERVED_TLDS = new Set([
  "localhost", "test", "invalid", "example", "local", "internal", "onion", "home", "corp",
]);

export interface NormalizeResult {
  ok: boolean;
  domain?: string;
  error?: string;
  isSubdomain?: boolean;
  parent?: string;
}

/** Normalise raw user input into a registrable hostname (RFC 1035-ish). */
export function normalizeDomain(input: string): NormalizeResult {
  let raw = (input || "").trim().toLowerCase();
  if (!raw) return { ok: false, error: "Enter a domain name." };
  // strip scheme, path, port, userinfo
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  raw = raw.split("/")[0].split("?")[0].split("#")[0].split(":")[0].split("@").pop() || "";
  // strip leading/trailing dots and wildcard labels
  raw = raw.replace(/^\.+|\.+$/g, "").replace(/\*\./g, "");
  if (!raw) return { ok: false, error: "Enter a domain name." };
  if (/^\d+\.\d+\.\d+\.\d+$/.test(raw) || raw.includes(":")) {
    return { ok: false, error: "Enter a domain name, not an IP address." };
  }
  if (raw === "localhost" || raw.endsWith(".localhost")) {
    return { ok: false, error: "localhost cannot be used as a public domain." };
  }
  const ascii = domainToASCII(raw);
  if (!ascii) return { ok: false, error: "That name is not a valid domain." };
  const labels = ascii.split(".");
  if (labels.length < 2) {
    return { ok: false, error: "Enter a full domain like example.com (a public suffix is required)." };
  }
  const tld = labels[labels.length - 1];
  if (RESERVED_TLDS.has(tld)) {
    return { ok: false, error: `.${tld} is reserved and cannot be verified on the public DNS.` };
  }
  if (labels.some((l) => l.length === 0 || l.length > 63 || !/^[a-z0-9-]+$/.test(l))) {
    return { ok: false, error: "Domain labels may only contain letters, digits and hyphens (max 63 chars)." };
  }
  if (labels.some((l) => l.startsWith("-") || l.endsWith("-"))) {
    return { ok: false, error: "Domain labels cannot start or end with a hyphen." };
  }
  const isSubdomain = labels.length > 2;
  return {
    ok: true,
    domain: ascii,
    isSubdomain,
    parent: isSubdomain ? labels.slice(-2).join(".") : ascii,
  };
}

export interface ExpectedRecord {
  type: "A" | "AAAA" | "CNAME" | "TXT" | "CAA";
  name: string; // FQDN the record lives at (for querying)
  host: string; // label shown for the DNS provider UI ("@" or "www" or "sub")
  value: string;
  ttl: number;
  required: boolean;
  why: string; // plain-language reason this record exists
}

/** The exact records the user must publish for the domain to point here. */
export function expectedRecords(
  domain: string,
  ips: { v4: string | null; v6: string | null },
  dnsToken: string,
  opts: { withWww?: boolean } = {}
): ExpectedRecord[] {
  const out: ExpectedRecord[] = [];
  const labels = domain.split(".");
  const isSub = labels.length > 2;
  const sub = isSub ? labels.slice(0, labels.length - 2).join(".") : null;

  if (ips.v4) {
    out.push({
      type: "A",
      name: domain,
      host: sub || "@",
      value: ips.v4,
      ttl: 300,
      required: true,
      why: "Points this name at this server's public IPv4 address.",
    });
  }
  if (ips.v6) {
    out.push({
      type: "AAAA",
      name: domain,
      host: sub || "@",
      value: ips.v6,
      ttl: 300,
      required: !!ips.v4 ? false : true,
      why: ips.v4
        ? "Optional: lets IPv6 visitors reach the site directly."
        : "This server is IPv6-only — this record is how visitors reach it.",
    });
  }
  if (!isSub && opts.withWww !== false) {
    out.push({
      type: "CNAME",
      name: `www.${domain}`,
      host: "www",
      value: domain,
      ttl: 300,
      required: false,
      why: "Makes www.<domain> resolve to the same place; the panel redirects it to the root.",
    });
  }
  out.push({
    type: "TXT",
    name: `_hipno-challenge.${domain}`,
    host: `_hipno-challenge${sub ? `.${sub}` : ""}`,
    value: `hipno-verify=${dnsToken}`,
    ttl: 300,
    required: true,
    why: "Proves to HipnoType that you control this domain before it is served or trusted.",
  });
  return out;
}

/* ———————————————————————— live verification ———————————————————————— */

function makeResolver(server: string) {
  const r = new dns.Resolver({ timeout: 4000, tries: 1 });
  r.setServers([server]);
  return r;
}

async function queryRecord(
  server: string,
  name: string,
  type: ExpectedRecord["type"]
): Promise<{ ok: boolean; values: string[]; error?: string }> {
  const r = makeResolver(server);
  try {
    switch (type) {
      case "A": {
        const a = await r.resolve4(name, { ttl: false } as never);
        return { ok: true, values: a as unknown as string[] };
      }
      case "AAAA": {
        const a = await r.resolve6(name, { ttl: false } as never);
        return { ok: true, values: a as unknown as string[] };
      }
      case "CNAME": {
        const c = await r.resolveCname(name);
        return { ok: true, values: c };
      }
      case "TXT": {
        const t = await r.resolveTxt(name);
        return { ok: true, values: t.map((chunks) => chunks.join("")) };
      }
      case "CAA": {
        // node has no resolveCaa; use Resolve with type
        const res = await r.resolve(name, "CAA").catch(() => null);
        return { ok: !!res, values: res ? (res as unknown as string[]) : [] };
      }
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { ok: false, values: [], error: code === "ENOTFOUND" ? "record not found" : code === "ETIMEOUT" ? "resolver timeout" : code || "query failed" };
  }
}

export interface RecordCheck {
  type: ExpectedRecord["type"];
  name: string;
  host: string;
  expected: string;
  required: boolean;
  resolvers: { resolver: string; status: "match" | "missing" | "wrong" | "error"; got: string[]; message: string }[];
  ok: boolean; // true when every resolver that answered agrees (missing counts as not-yet for optional)
}

export interface DomainVerification {
  domain: string;
  at: number;
  dnsHost: { detected: string | null; nameservers: string[] };
  records: RecordCheck[];
  verdict: "verified" | "pending" | "failed";
  summary: string;
}

/** Provider fingerprinting from the parent zone's nameservers. */
async function detectDnsHost(domain: string): Promise<{ detected: string | null; nameservers: string[] }> {
  const labels = domain.split(".");
  const parent = labels.length > 2 ? labels.slice(-2).join(".") : domain;
  for (const server of VERIFY_RESOLVERS) {
    const r = makeResolver(server);
    try {
      const ns = await r.resolveNs(parent);
      if (ns && ns.length) {
        const joined = ns.join(" ").toLowerCase();
        const known: [RegExp, string][] = [
          [/cloudflare|ns[0-9]+\.cloudflare/, "Cloudflare"],
          [/awsdns|route ?53/, "AWS Route 53"],
          [/googledomains|google\.com/, "Google Cloud DNS"],
          [/digitalocean|ns[0-9]+\.digitalocean/, "DigitalOcean"],
          [/hetzner/, "Hetzner"],
          [/namecheap|dns[0-9]+\.registrar-servers/, "Namecheap"],
          [/godaddy|domaincontrol/, "GoDaddy"],
          [/registrar\.amazon|awsdns/, "AWS"],
          [/vercel|dns\.vercel/, "Vercel"],
          [/porkbun/, "Porkbun"],
          [/name\.com/, "Name.com"],
          [/dynadot/, "Dynadot"],
        ];
        for (const [re, name] of known) {
          if (re.test(joined)) return { detected: name, nameservers: ns.sort() };
        }
        return { detected: null, nameservers: ns.sort() };
      }
    } catch {
      /* try next resolver */
    }
  }
  return { detected: null, nameservers: [] };
}

/** Verify every expected record against every resolver — the real check. */
export async function verifyDomain(
  domain: string,
  records: ExpectedRecord[],
  dnsToken: string
): Promise<DomainVerification> {
  const dnsHost = await detectDnsHost(domain);

  const checks: RecordCheck[] = await Promise.all(
    records.map(async (rec) => {
      const resolverResults = await Promise.all(
        VERIFY_RESOLVERS.map(async (server) => {
          const q = await queryRecord(server, rec.name, rec.type);
          if (!q.ok) {
            return {
              resolver: server,
              status: "error" as const,
              got: [],
              message: q.error === "record not found" ? "record not found" : q.error || "query failed",
            };
          }
          if (rec.type === "TXT") {
            const hit = q.values.some((v) => v.trim() === rec.value.trim());
            return {
              resolver: server,
              status: hit ? ("match" as const) : ("wrong" as const),
              got: q.values,
              message: hit
                ? "challenge record matches"
                : q.values.length
                  ? `found ${q.values.map((v) => JSON.stringify(v.slice(0, 40))).join(", ")} — expected ${JSON.stringify(rec.value.slice(0, 44))}`
                  : "no TXT values at this name yet",
            };
          }
          if (rec.type === "CNAME") {
            const hit = q.values.some((v) => v.toLowerCase() === rec.value.toLowerCase());
            return {
              resolver: server,
              status: hit ? ("match" as const) : ("wrong" as const),
              got: q.values,
              message: hit
                ? "points at the root domain"
                : q.values.length
                  ? `points at ${q.values.join(", ")} — expected ${rec.value}`
                  : "no CNAME yet",
            };
          }
          // A / AAAA — value must be among the answers
          const hit = q.values.includes(rec.value);
          return {
            resolver: server,
            status: hit ? ("match" as const) : q.values.length ? ("wrong" as const) : ("missing" as const),
            got: q.values,
            message: hit
              ? `resolves to this server (${rec.value})`
              : q.values.length
                ? `resolves to ${q.values.join(", ")} — expected ${rec.value}`
                : "no address published yet",
          };
        })
      );
      const answered = resolverResults.filter((r) => r.status !== "error");
      const matchCount = resolverResults.filter((r) => r.status === "match").length;
      const ok = rec.required
        ? answered.length > 0 && answered.every((r) => r.status === "match")
        : matchCount > 0;
      return {
        type: rec.type,
        name: rec.name,
        host: rec.host,
        expected: rec.value,
        required: rec.required,
        resolvers: resolverResults,
        ok,
      };
    })
  );

  const required = checks.filter((c) => c.required);
  const requiredOk = required.length > 0 && required.every((c) => c.ok);
  const wrong = checks.filter((c) => c.required && c.resolvers.some((r) => r.status === "wrong"));
  const missing = required.filter((c) => !c.ok && !c.resolvers.some((r) => r.status === "wrong"));
  const verdict: DomainVerification["verdict"] = requiredOk
    ? "verified"
    : wrong.length
      ? "failed"
      : "pending";

  const summary = requiredOk
    ? `All required records verified on ${VERIFY_RESOLVERS.join(", ")}.`
    : wrong.length
      ? `${wrong.map((c) => `${c.type} ${c.host}`).join(", ")} ${
          wrong.length === 1 ? "points" : "point"
        } at the wrong place — update the values at your DNS provider.`
      : missing.length
        ? `Waiting for ${missing.map((c) => `${c.type} ${c.host}`).join(", ")} — create the records at your DNS provider.`
        : "Records not verifiable yet — try again in a moment.";

  return { domain, at: Date.now(), dnsHost, records: checks, verdict, summary };
}

export function freshDnsToken(): string {
  return randomBase62(32);
}
