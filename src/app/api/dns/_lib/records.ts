import net from "node:net";
import dns from "node:dns/promises";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api-error";
import { VERIFY_RESOLVERS } from "@/lib/dns-verify";

/**
 * Shared server-side DNS record rules + BIND rendering/parsing for the
 * /api/dns/** routes. Private module (underscore folder) — not a route.
 */

export const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "CAA", "NS"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

const IMPORT_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS"] as const;

export interface ValidatedRecord {
  type: RecordType;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
  port: number | null;
  weight: number | null;
}

/* ————————————————————————— record validation ————————————————————————— */

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isIpv4(v: string): boolean {
  const m = v.match(IPV4_RE);
  return !!m && m.slice(1).every((o) => Number(o) <= 255);
}

export function isHostname(v: string): boolean {
  const s = v.toLowerCase().replace(/\.$/, "");
  if (!s || s.length > 253) return false;
  return s.split(".").every((l) => /^[a-z0-9_-]{1,63}$/.test(l) && !l.startsWith("-") && !l.endsWith("-"));
}

function isRecordName(n: string): boolean {
  const s = n.toLowerCase().replace(/\.$/, "");
  if (!s || s.length > 254) return false;
  if (s === "@") return true;
  if (s.includes("*") && !s.startsWith("*.")) return false;
  return s
    .replace(/^\*\./, "")
    .split(".")
    .every((l) => /^[a-z0-9_-]{1,63}$/.test(l) && !l.startsWith("-") && !l.endsWith("-"));
}

function intIn(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "string" && v !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

/**
 * Validate + normalise a complete record payload (used by create AND edit so
 * the rules can never drift between endpoints). Throws ApiError 400.
 */
export function validateRecordInput(raw: Record<string, unknown>): ValidatedRecord {
  const type = String(raw.type || "").toUpperCase();
  if (!(RECORD_TYPES as readonly string[]).includes(type)) {
    throw new ApiError(400, "invalid_type", `Type must be one of: ${RECORD_TYPES.join(", ")}`);
  }
  const name = String(raw.name || "").trim().toLowerCase().replace(/\.$/, "");
  if (!isRecordName(name)) {
    throw new ApiError(400, "invalid_name", 'Name must be "@", "*" or subdomain labels (letters, digits, hyphens).');
  }
  const value = String(raw.value ?? "").trim();
  if (!value) throw new ApiError(400, "invalid_value", "Value is required.");
  const ttl = intIn(raw.ttl, 30, 604800);
  if (ttl === null) throw new ApiError(400, "invalid_ttl", "TTL must be an integer between 30 and 604800 seconds.");

  let priority: number | null = null;
  let port: number | null = null;
  let weight: number | null = null;
  let storedValue = value;

  switch (type) {
    case "A":
      if (!isIpv4(value)) throw new ApiError(400, "invalid_value", "A records need a valid IPv4 address (e.g. 203.0.113.10).");
      break;
    case "AAAA":
      if (!net.isIPv6(value)) throw new ApiError(400, "invalid_value", "AAAA records need a valid IPv6 address (e.g. 2001:db8::1).");
      break;
    case "CNAME":
      if (name === "@") throw new ApiError(400, "cname_apex", "CNAME cannot live at the zone apex — SOA and NS already exist there.");
      if (!isHostname(value)) throw new ApiError(400, "invalid_value", "CNAME value must be a hostname.");
      storedValue = value.toLowerCase().replace(/\.$/, "");
      break;
    case "NS":
      if (!isHostname(value)) throw new ApiError(400, "invalid_value", "NS value must be a nameserver hostname.");
      storedValue = value.toLowerCase().replace(/\.$/, "");
      break;
    case "MX": {
      priority = intIn(raw.priority, 0, 65535);
      if (priority === null) throw new ApiError(400, "invalid_priority", "MX priority is required (0–65535, lower = preferred).");
      if (!isHostname(value)) throw new ApiError(400, "invalid_value", "MX value must be a mail server hostname.");
      storedValue = value.toLowerCase().replace(/\.$/, "");
      break;
    }
    case "TXT":
      if (value.length > 4096) throw new ApiError(400, "invalid_value", "TXT values are limited to 4096 characters.");
      break;
    case "SRV": {
      priority = intIn(raw.priority, 0, 65535);
      weight = intIn(raw.weight, 0, 65535);
      port = intIn(raw.port, 1, 65535);
      if (priority === null || weight === null || port === null) {
        throw new ApiError(400, "invalid_srv", "SRV records need priority (0–65535), weight (0–65535) and port (1–65535).");
      }
      if (!isHostname(value)) throw new ApiError(400, "invalid_value", "SRV value must be the target hostname.");
      if (!/^_[a-z0-9-]+\._(tcp|udp|tls|sctp)\b/.test(name)) {
        throw new ApiError(400, "invalid_srv_name", 'SRV names must look like "_service._proto", e.g. "_sip._tcp".');
      }
      storedValue = value.toLowerCase().replace(/\.$/, "");
      break;
    }
    case "CAA": {
      const m = value.match(/^(\d+)\s+(issue|issuewild|iodef)\s+"?(.+?)"?$/i);
      if (!m) throw new ApiError(400, "invalid_value", 'CAA value must look like: 0 issue "letsencrypt.org".');
      const flags = intIn(m[1], 0, 255);
      if (flags === null || (flags !== 0 && flags !== 128)) {
        throw new ApiError(400, "invalid_value", "CAA flags must be 0 or 128.");
      }
      storedValue = `${flags} ${m[2].toLowerCase()} "${m[3]}"`;
      break;
    }
  }

  return { type: type as RecordType, name, value: storedValue, ttl, priority, port, weight };
}

/** Server-side CNAME exclusivity rule: no other records at the same name. */
export async function assertNoCnameConflict(zoneId: string, rec: ValidatedRecord, excludeRecordId?: string): Promise<void> {
  const atName = await db.dnsRecord.findMany({ where: { zoneId, name: rec.name } });
  const others = atName.filter((r) => r.id !== excludeRecordId);
  if (rec.type === "CNAME" && others.length > 0) {
    throw new ApiError(
      409,
      "cname_conflict",
      `A CNAME cannot coexist with other records at “${rec.name}” — ${others.length} record${others.length === 1 ? "" : "s"} already exist${others.length === 1 ? "s" : ""} there.`
    );
  }
  if (rec.type !== "CNAME" && others.some((r) => r.type === "CNAME")) {
    throw new ApiError(
      409,
      "cname_conflict",
      `“${rec.name}” already has a CNAME record — a CNAME cannot coexist with other records at the same name.`
    );
  }
}

/** Same rule for a whole import batch. */
export function assertNoCnameInBatch(batch: { name: string; type: string }[]): void {
  const byName = new Map<string, Set<string>>();
  for (const r of batch) {
    const set = byName.get(r.name) ?? new Set<string>();
    set.add(r.type);
    byName.set(r.name, set);
  }
  for (const [name, types] of byName) {
    if (types.has("CNAME") && types.size > 1) {
      throw new ApiError(
        409,
        "cname_conflict",
        `A CNAME cannot coexist with other records at “${name}” — the batch contains ${[...types].join(", ")} there.`
      );
    }
  }
}

/** The wire value of a record (used for comparisons and Cloudflare payloads). */
export function recordWireValue(r: {
  type: string;
  value: string;
  priority: number | null;
  port: number | null;
  weight: number | null;
}): string {
  switch (r.type) {
    case "MX":
      return `${r.priority ?? 0} ${r.value}`;
    case "SRV":
      return `${r.priority ?? 0} ${r.weight ?? 0} ${r.port ?? 0} ${r.value}`;
    default:
      return r.value;
  }
}

/* ————————————————————————— BIND export ————————————————————————— */

function quoteTxt(v: string): string {
  const esc = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (esc.length <= 255) return `"${esc}"`;
  const chunks: string[] = [];
  for (let i = 0; i < esc.length; i += 255) chunks.push(esc.slice(i, i + 255));
  return chunks.map((c) => `"${c}"`).join(" ");
}

export function renderBindZone(
  zone: { name: string; primary: string | null; updatedAt: Date },
  records: { type: string; name: string; value: string; ttl: number; priority: number | null; port: number | null; weight: number | null; enabled: boolean }[]
): string {
  const enabled = records.filter((r) => r.enabled);
  const now = zone.updatedAt;
  const serial =
    `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}` +
    String(now.getUTCHours()).padStart(2, "0");
  const primary = (zone.primary || `ns1.${zone.name}`).replace(/\.$/, "");
  const lines: string[] = [
    `; HipnoType Panel — BIND zone export for ${zone.name}`,
    `; Generated ${new Date().toISOString()} (${enabled.length} records)`,
    `$ORIGIN ${zone.name}.`,
    `$TTL ${enabled.length ? Math.min(...enabled.map((r) => r.ttl)) : 3600}`,
    `@ IN SOA ${primary}. hostmaster.${zone.name}. (`,
    `    ${serial}  ; serial (yyyymmddhh)`,
    "    3600       ; refresh",
    "    900        ; retry",
    "    604800     ; expire",
    "    86400 )    ; negative cache TTL",
    `@ 86400 IN NS ${primary}.`,
  ];
  for (const r of enabled) {
    const label = r.name === "@" ? "@" : r.name;
    const ttl = r.ttl;
    switch (r.type) {
      case "A":
      case "AAAA":
        lines.push(`${label} ${ttl} IN ${r.type} ${r.value}`);
        break;
      case "CNAME":
      case "NS":
        lines.push(`${label} ${ttl} IN ${r.type} ${r.value}.`);
        break;
      case "MX":
        lines.push(`${label} ${ttl} IN MX ${r.priority ?? 0} ${r.value}.`);
        break;
      case "TXT":
        lines.push(`${label} ${ttl} IN TXT ${quoteTxt(r.value)}`);
        break;
      case "SRV":
        lines.push(`${label} ${ttl} IN SRV ${r.priority ?? 0} ${r.weight ?? 0} ${r.port ?? 0} ${r.value}.`);
        break;
      case "CAA":
        lines.push(`${label} ${ttl} IN CAA ${r.value}`);
        break;
      default:
        lines.push(`; skipped unsupported record ${r.type} ${label}`);
    }
  }
  return lines.join("\n") + "\n";
}

/* ————————————————————————— BIND import ————————————————————————— */

interface Token {
  text: string;
  quoted: boolean;
}

function fail(lineNo: number, msg: string): never {
  throw new ApiError(400, "import_invalid", `Line ${lineNo}: ${msg}`);
}

/** Quote-aware tokeniser for a single logical line. */
function tokenize(line: string, lineNo: number): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (i >= line.length) break;
    if (line[i] === '"') {
      let j = i + 1;
      let buf = "";
      let closed = false;
      while (j < line.length) {
        if (line[j] === "\\" && j + 1 < line.length) {
          buf += line[j + 1];
          j += 2;
          continue;
        }
        if (line[j] === '"') {
          closed = true;
          break;
        }
        buf += line[j];
        j++;
      }
      if (!closed) fail(lineNo, "unterminated quoted string");
      tokens.push({ text: buf, quoted: true });
      i = j + 1;
    } else {
      let j = i;
      while (j < line.length && !/\s/.test(line[j])) j++;
      tokens.push({ text: line.slice(i, j), quoted: false });
      i = j;
    }
  }
  return tokens;
}

/** Split into logical lines: joins parenthesis continuations, strips ; comments. */
function logicalLines(text: string): { lineNo: number; text: string }[] {
  const out: { lineNo: number; text: string }[] = [];
  const rawLines = text.split(/\r?\n/);
  let buf = "";
  let startLine = 0;
  let depth = 0;
  let inQuote = false;
  for (let n = 0; n < rawLines.length; n++) {
    let processed = "";
    for (const ch of rawLines[n]) {
      if (ch === '"') {
        inQuote = !inQuote;
        processed += ch;
        continue;
      }
      if (!inQuote && ch === "(") depth++;
      if (!inQuote && ch === ")") depth--;
      if (!inQuote && ch === ";") break;
      processed += ch;
    }
    if (!buf) startLine = n + 1;
    const trimmed = processed.trim();
    if (trimmed) buf += (buf ? " " : "") + trimmed;
    if (depth <= 0) {
      if (buf.trim()) out.push({ lineNo: startLine, text: buf.trim() });
      buf = "";
    }
  }
  if (buf.trim()) fail(startLine, "unterminated parenthesis group");
  return out;
}

function resolveToZoneName(rawName: string, origin: string, zoneName: string, lineNo: number): string {
  let n = rawName.toLowerCase();
  const absolute = n.endsWith(".");
  n = n.replace(/\.$/, "");
  if (n === "@") return "@";
  if (!absolute) n = `${n}.${origin.replace(/\.$/, "")}`;
  if (n === zoneName) return "@";
  if (n.endsWith("." + zoneName)) {
    return n.slice(0, n.length - zoneName.length - 1);
  }
  fail(lineNo, `record name "${rawName}" is outside zone ${zoneName}`);
}

export interface ParsedRecord extends ValidatedRecord {
  lineNo: number;
}

/**
 * Strict line-by-line BIND parser. Supports $TTL, $ORIGIN and
 * A/AAAA/CNAME/MX/TXT/NS records; SOA entries are skipped. Every problem is
 * reported with its line number.
 */
export function parseBindZone(text: string, zoneName: string): { records: ParsedRecord[]; defaultTtl: number } {
  if (!text.trim()) throw new ApiError(400, "import_empty", "The zone file is empty.");
  if (text.length > 512_000) throw new ApiError(400, "import_too_large", "Zone file too large (limit 512 KB).");

  let defaultTtl = 3600;
  let origin = zoneName;
  let lastName = "@";
  const records: ParsedRecord[] = [];

  for (const { lineNo, text: line } of logicalLines(text)) {
    if (line.startsWith("$")) {
      const m = line.match(/^(\$\S+)\s+(.+)$/);
      if (!m) fail(lineNo, "malformed control entry");
      const key = m[1].toUpperCase();
      const arg = m[2].trim();
      if (key === "$TTL") {
        const t = Number(arg);
        if (!Number.isInteger(t) || t < 30 || t > 604800) fail(lineNo, `invalid $TTL "${arg}" (30–604800 expected)`);
        defaultTtl = t;
      } else if (key === "$ORIGIN") {
        const o = arg.toLowerCase().split(/\s+/)[0].replace(/\.$/, "");
        if (!isHostname(o)) fail(lineNo, `invalid $ORIGIN "${arg}"`);
        origin = o;
      } else if (key === "$INCLUDE" || key === "$GENERATE") {
        fail(lineNo, `${key} is not supported`);
      } else {
        fail(lineNo, `unknown control entry ${key}`);
      }
      continue;
    }

    const tokens = tokenize(line, lineNo);
    if (tokens.length === 0) continue;
    let idx = 0;

    // optional owner name — skip when the first token is a TTL, class or type
    const first = tokens[0].text.toUpperCase();
    const looksLikeMeta =
      /^\d+$/.test(tokens[0].text) ||
      first === "IN" ||
      first === "SOA" ||
      (RECORD_TYPES as readonly string[]).includes(first);
    let owner: string;
    if (!looksLikeMeta) {
      owner = tokens[0].text;
      idx = 1;
    } else {
      owner = lastName;
    }

    let ttl = defaultTtl;
    if (idx < tokens.length && /^\d+$/.test(tokens[idx].text)) {
      ttl = Number(tokens[idx].text);
      if (ttl < 30 || ttl > 604800) fail(lineNo, `invalid TTL ${ttl} (30–604800 expected)`);
      idx++;
    }
    if (idx < tokens.length && tokens[idx].text.toUpperCase() === "IN") idx++;
    if (idx >= tokens.length) fail(lineNo, "missing record type");

    const type = tokens[idx].text.toUpperCase();
    idx++;
    const rest = tokens.slice(idx);
    if (["SOA", "RRSIG", "DNSKEY", "NSEC", "NSEC3", "NSEC3PARAM", "TSIG", "TYPE65534"].includes(type)) {
      continue; // zone housekeeping — deliberately skipped
    }
    if (!(IMPORT_TYPES as readonly string[]).includes(type)) {
      fail(lineNo, `unsupported record type "${type}" (supported: ${IMPORT_TYPES.join(", ")})`);
    }

    const name = resolveToZoneName(owner, origin, zoneName, lineNo);
    lastName = owner;

    let value: string;
    let priority: number | null = null;
    switch (type) {
      case "A": {
        if (rest.length !== 1) fail(lineNo, `A records need exactly one IPv4 address (got ${rest.length} value${rest.length === 1 ? "" : "s"})`);
        if (!isIpv4(rest[0].text)) fail(lineNo, `"${rest[0].text}" is not a valid IPv4 address`);
        value = rest[0].text;
        break;
      }
      case "AAAA": {
        if (rest.length !== 1) fail(lineNo, `AAAA records need exactly one IPv6 address (got ${rest.length} value${rest.length === 1 ? "" : "s"})`);
        if (!net.isIPv6(rest[0].text)) fail(lineNo, `"${rest[0].text}" is not a valid IPv6 address`);
        value = rest[0].text;
        break;
      }
      case "CNAME":
      case "NS": {
        if (rest.length !== 1) fail(lineNo, `${type} records need exactly one hostname`);
        if (!isHostname(rest[0].text)) fail(lineNo, `"${rest[0].text}" is not a valid hostname`);
        value = rest[0].text.toLowerCase().replace(/\.$/, "");
        break;
      }
      case "MX": {
        if (rest.length !== 2) fail(lineNo, "MX records need “priority hostname”");
        const prio = Number(rest[0].text);
        if (!Number.isInteger(prio) || prio < 0 || prio > 65535) fail(lineNo, `"${rest[0].text}" is not a valid MX priority (0–65535)`);
        if (!isHostname(rest[1].text)) fail(lineNo, `"${rest[1].text}" is not a valid mail server hostname`);
        priority = prio;
        value = rest[1].text.toLowerCase().replace(/\.$/, "");
        break;
      }
      case "TXT": {
        if (rest.length === 0) fail(lineNo, "TXT records need a value");
        value = rest.map((t) => t.text).join("");
        if (value.length > 4096) fail(lineNo, "TXT value exceeds 4096 characters");
        break;
      }
      default:
        fail(lineNo, `unsupported record type "${type}"`);
    }

    const validated = validateRecordInput({ type, name, value, ttl, priority, port: null, weight: null });
    records.push({ ...validated, lineNo });
  }

  if (records.length === 0) {
    throw new ApiError(400, "import_empty", "No importable records found — supported types: A, AAAA, CNAME, MX, TXT, NS.");
  }
  return { records, defaultTtl };
}

/* ————————————————————————— direct resolver queries ————————————————————————— */

/**
 * Same pattern as src/lib/dns-verify.ts: one direct Resolver per public
 * server (so we see the internet's view, not a local cache), 4 s timeout,
 * single try, all resolvers queried in parallel.
 */
export function makeDirectResolver(server: string): dns.Resolver {
  const r = new dns.Resolver({ timeout: 4000, tries: 1 });
  r.setServers([server]);
  return r;
}

export interface ResolverAnswer {
  resolver: string;
  ok: boolean;
  values: string[];
  error: string | null;
  ms: number;
}

export async function queryAllResolvers(name: string, type: string): Promise<ResolverAnswer[]> {
  return Promise.all(
    VERIFY_RESOLVERS.map(async (server): Promise<ResolverAnswer> => {
      const started = Date.now();
      const r = makeDirectResolver(server);
      try {
        let values: string[] = [];
        switch (type) {
          case "A":
            values = await r.resolve4(name);
            break;
          case "AAAA":
            values = await r.resolve6(name);
            break;
          case "CNAME":
            values = await r.resolveCname(name);
            break;
          case "TXT":
            values = (await r.resolveTxt(name)).map((chunks) => chunks.join(""));
            break;
          case "MX":
            values = (await r.resolveMx(name)).map((m) => `${m.priority} ${m.exchange}`);
            break;
          case "NS":
            values = await r.resolveNs(name);
            break;
          case "SRV":
            values = (await r.resolveSrv(name)).map((s) => `${s.priority} ${s.weight} ${s.port} ${s.name}`);
            break;
          case "CAA": {
            const res = (await r.resolve(name, "CAA")) as unknown as { flags: number; tag: string; value: string }[];
            values = res.map((c) => `${c.flags} ${c.tag} "${c.value}"`);
            break;
          }
          default:
            throw new Error("unsupported type");
        }
        return { resolver: server, ok: true, values, error: null, ms: Date.now() - started };
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code || "query failed";
        const err =
          code === "ENOTFOUND"
            ? "record not found"
            : code === "ETIMEOUT"
              ? "resolver timeout"
              : code === "EADDRNOTAVAIL"
                ? "resolver unreachable"
                : code;
        return { resolver: server, ok: false, values: [], error: err, ms: Date.now() - started };
      }
    })
  );
}

/** Normalise a live DNS answer and a local record value so they compare reliably. */
export function sameDnsValue(a: string, b: string): boolean {
  const norm = (v: string) => v.trim().toLowerCase().replace(/\.$/, "");
  const x = norm(a);
  const y = norm(b);
  if (x === y) return true;
  // MX-style answers may arrive as "10 host." while the local value is "host"
  const stripPrio = (v: string) => v.replace(/^\d+\s+/, "");
  if (/^\d+\s+\S/.test(x) && !/^\d+\s/.test(y)) return stripPrio(x) === y;
  if (/^\d+\s+\S/.test(y) && !/^\d+\s/.test(x)) return x === stripPrio(y);
  return false;
}
