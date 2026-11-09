import { db } from "@/lib/db";
import { randomBase62 } from "@/lib/crypto";
import { ApiError } from "@/lib/api-error";

/**
 * HipnoType — REAL Cloudflare API v4 client (spec FIX#2 §3).
 *
 * One shared implementation behind every DNS provider feature:
 *   · token verification (GET /user/tokens/verify + zone list + write probe)
 *   · record CRUD with immediate propagation
 *   · full-zone import + bidirectional sync
 *
 * Rules (mirrors docs/AUDIT2.md):
 *   · honest errors — every failure names the HTTP status / CF error code,
 *     and NEVER contains the API token (tokens only live encrypted in DB)
 *   · 429 → exponential backoff (2 retries), 5xx → 1 retry, hard 12 s timeout
 *   · pagination honoured (zones 50/page, records 100/page)
 *   · error 81058 ("record already exists") handled explicitly
 */

const CF_API = "https://api.cloudflare.com/client/v4";
const MAX_ZONE_PAGES = 5; // 250 zones
const MAX_RECORD_PAGES = 10; // 1000 records
const PERM_PROBE_LABEL = "_hipno-permtest";

export interface CfZoneSummary {
  id: string;
  name: string;
  status: string;
  paused: boolean;
}

export interface CfRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  priority?: number;
  proxied?: boolean;
  comment?: string | null;
  tags?: string[];
}

export class CloudflareError extends ApiError {
  readonly cfCode: number | null;
  readonly httpStatus: number | null;
  constructor(status: number, code: string, message: string, cfCode: number | null = null, httpStatus: number | null = null) {
    super(status, code, message);
    this.cfCode = cfCode;
    this.httpStatus = httpStatus;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Core request wrapper: auth, JSON, timeout, retries. */
async function cfFetch<T>(
  path: string,
  token: string,
  init: RequestInit = {},
  opts: { timeoutMs?: number; retries429?: number; retries5xx?: number } = {}
): Promise<T> {
  const { timeoutMs = 12_000, retries429 = 2, retries5xx = 1 } = opts;
  let attempt429 = 0;
  let attempt5xx = 0;

  for (;;) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${CF_API}${path}`, {
        ...init,
        signal: ctrl.signal,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(init.headers || {}),
        },
      });
    } catch (e) {
      clearTimeout(timer);
      const reason =
        e instanceof Error && e.name === "AbortError" ? "timed out" : e instanceof Error ? e.message : "network error";
      throw new CloudflareError(
        502,
        "cf_unreachable",
        `Could not reach api.cloudflare.com from this server (${reason}). Provider DNS needs outbound HTTPS to Cloudflare.`,
        null,
        null
      );
    }
    clearTimeout(timer);

    if (res.status === 429 && attempt429 < retries429) {
      attempt429++;
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 600 * attempt429;
      await sleep(Math.min(waitMs, 4000));
      continue;
    }
    if (res.status >= 500 && res.status < 600 && attempt5xx < retries5xx) {
      attempt5xx++;
      await sleep(400 * attempt5xx);
      continue;
    }

    const body = (await res.json().catch(() => null)) as
      | { success?: boolean; errors?: { code?: number; message?: string }[]; result?: T }
      | null;

    if (res.status === 401 || res.status === 403) {
      throw new CloudflareError(
        400,
        "invalid_token",
        `Cloudflare rejected the API token (HTTP ${res.status}). Check the token value and that it includes the Zone · Read and DNS · Edit permissions.`,
        body?.errors?.[0]?.code ?? null,
        res.status
      );
    }
    if (res.status === 404) {
      throw new CloudflareError(
        404,
        "cf_not_found",
        `Cloudflare returned 404 for ${path.split("?")[0]} — the zone or record no longer exists there.`,
        body?.errors?.[0]?.code ?? null,
        res.status
      );
    }
    if (!res.ok || !body || body.success === false) {
      const first = body?.errors?.[0];
      const detail = first ? `${first.code ?? ""} ${first.message ?? ""}`.trim() : `HTTP ${res.status}`;
      throw new CloudflareError(502, "cf_error", `Cloudflare API error: ${detail}`, first?.code ?? null, res.status);
    }
    return body.result as T;
  }
}

/* ————————————————————————— token verification (§3.1) ————————————————————————— */

export interface TokenVerification {
  valid: true;
  tokenStatus: string; // active | ...
  zones: CfZoneSummary[];
  zoneFound: boolean; // when a zone name was given
  writeProbe: "granted" | "denied" | "skipped";
  writeProbeDetail: string | null;
}

/**
 * Real end-to-end token check:
 *  1. GET /user/tokens/verify        — token exists + is active
 *  2. GET /zones (50/page ≤ 250)     — which zones it can see
 *  3. optional write probe on `zoneName`: create + delete a temporary
 *     TXT `_hipno-permtest` record (81058 "already exists" counts as granted
 *     — it proves DNS:Edit — and we try to clean the stale probe up)
 */
export async function verifyCloudflareToken(token: string, zoneName?: string | null): Promise<TokenVerification> {
  if (!token || token.length < 10) {
    throw new CloudflareError(400, "invalid_token", "That doesn't look like a Cloudflare API token (too short).");
  }

  // 1) token validity
  const verify = await cfFetch<{ id: string; status: string }>("/user/tokens/verify", token);
  if (verify.status !== "active") {
    throw new CloudflareError(400, "invalid_token", `Cloudflare says this token is “${verify.status}”, not active. Create a fresh token and paste it again.`);
  }

  // 2) visible zones (paginated)
  const zones: CfZoneSummary[] = [];
  for (let page = 1; page <= MAX_ZONE_PAGES; page++) {
    const batch = await cfFetch<CfZoneSummary[]>(`/zones?per_page=50&page=${page}`, token);
    zones.push(...batch);
    if (batch.length < 50) break;
  }

  const wanted = (zoneName || "").toLowerCase().replace(/\.$/, "");
  const zoneFound = !!wanted && zones.some((z) => z.name.toLowerCase() === wanted);

  // 3) write probe — only possible against a concrete zone the token can see
  let writeProbe: TokenVerification["writeProbe"] = "skipped";
  let writeProbeDetail: string | null = null;

  if (wanted && zoneFound) {
    const target = zones.find((z) => z.name.toLowerCase() === wanted)!;
    const probeName = `${PERM_PROBE_LABEL}.${wanted}`;
    const probeContent = `hipno-permtest-${randomBase62(8)}`;
    try {
      const created = await cfFetch<CfRecord>(`/zones/${target.id}/dns_records`, token, {
        method: "POST",
        body: JSON.stringify({ type: "TXT", name: probeName, content: probeContent, ttl: 60 }),
      });
      try {
        await cfFetch(`/zones/${target.id}/dns_records/${created.id}`, token, { method: "DELETE" });
        writeProbe = "granted";
        writeProbeDetail = "created and removed a temporary TXT probe (DNS · Edit confirmed).";
      } catch {
        writeProbe = "granted";
        writeProbeDetail = "write confirmed, but the temporary probe record could not be deleted — remove _hipno-permtest manually.";
      }
    } catch (e) {
      if (e instanceof CloudflareError && (e.cfCode === 81058 || e.cfCode === 10000)) {
        // 81058 = "record already exists" → the token CAN write; clean up the stale probe
        try {
          const existing = await listCloudflareRecords(token, target.id, target.name);
          const stale = existing.filter((r) => r.name.toLowerCase() === probeName);
          let removed = 0;
          for (const s of stale) {
            try {
              await cfFetch(`/zones/${target.id}/dns_records/${s.id}`, token, { method: "DELETE" });
              removed++;
            } catch { /* best effort */ }
          }
          writeProbe = "granted";
          writeProbeDetail = `write confirmed (probe already existed${removed ? `, cleaned ${removed} stale probe${removed === 1 ? "" : "s"}` : ""}).`;
        } catch {
          writeProbe = "granted";
          writeProbeDetail = "write confirmed (an old probe record already exists — you may delete _hipno-permtest in Cloudflare).";
        }
      } else {
        writeProbe = "denied";
        writeProbeDetail = e instanceof ApiError ? e.message : "Cloudflare refused the write probe — the token is missing DNS · Edit.";
      }
    }
  }

  return { valid: true, tokenStatus: verify.status, zones, zoneFound, writeProbe, writeProbeDetail };
}

/* ————————————————————————— zone + record operations ————————————————————————— */

export async function listCloudflareZones(token: string): Promise<CfZoneSummary[]> {
  const zones: CfZoneSummary[] = [];
  for (let page = 1; page <= MAX_ZONE_PAGES; page++) {
    const batch = await cfFetch<CfZoneSummary[]>(`/zones?per_page=50&page=${page}`, token);
    zones.push(...batch);
    if (batch.length < 50) break;
  }
  return zones;
}

/** Resolve a zone name to its Cloudflare id — exact, case-insensitive. */
export async function findCloudflareZoneId(token: string, zoneName: string): Promise<{ id: string; name: string }> {
  const found = await cfFetch<CfZoneSummary[]>(
    `/zones?per_page=50&page=1&name=${encodeURIComponent(zoneName.toLowerCase())}`,
    token
  );
  const exact = found.find((z) => z.name.toLowerCase() === zoneName.toLowerCase());
  if (!exact) {
    throw new CloudflareError(
      400,
      "zone_not_found",
      `Cloudflare does not list ${zoneName} under this token — make sure the zone exists in the same Cloudflare account the token belongs to.`,
      null,
      null
    );
  }
  return { id: exact.id, name: exact.name };
}

export async function listCloudflareRecords(token: string, cfZoneId: string, _zoneName?: string): Promise<CfRecord[]> {
  const records: CfRecord[] = [];
  for (let page = 1; page <= MAX_RECORD_PAGES; page++) {
    const batch = await cfFetch<CfRecord[]>(`/zones/${cfZoneId}/dns_records?per_page=100&page=${page}`, token);
    records.push(...batch);
    if (batch.length < 100) break;
  }
  return records;
}

export interface CfRecordPayload {
  type: string;
  name: string; // FQDN
  content: string;
  ttl: number;
  priority?: number;
  proxied?: boolean;
  comment?: string;
}

export function createCloudflareRecord(token: string, cfZoneId: string, payload: CfRecordPayload): Promise<CfRecord> {
  return cfFetch<CfRecord>(`/zones/${cfZoneId}/dns_records`, token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCloudflareRecord(
  token: string,
  cfZoneId: string,
  recordId: string,
  payload: CfRecordPayload
): Promise<CfRecord> {
  return cfFetch<CfRecord>(`/zones/${cfZoneId}/dns_records/${recordId}`, token, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteCloudflareRecord(token: string, cfZoneId: string, recordId: string): Promise<unknown> {
  return cfFetch<unknown>(`/zones/${cfZoneId}/dns_records/${recordId}`, token, { method: "DELETE" });
}

/* ————————————————————————— mapping helpers ————————————————————————— */

/** Cloudflare FQDN ("sub.example.com") → zone-relative label ("sub" | "@"). */
export function cfNameToLabel(fqdn: string, zoneName: string): string {
  const f = fqdn.toLowerCase().replace(/\.$/, "");
  const z = zoneName.toLowerCase().replace(/\.$/, "");
  if (f === z) return "@";
  if (f.endsWith(`.${z}`)) return f.slice(0, f.length - z.length - 1);
  return f; // out-of-zone (shouldn't happen) — keep the full name
}

/** Zone-relative label ("sub" | "@") → Cloudflare FQDN. */
export function labelToCfName(label: string, zoneName: string): string {
  if (label === "@") return zoneName;
  if (label === "*" || label.startsWith("*.")) return `${label}.${zoneName}`;
  if (label.toLowerCase().endsWith(`.${zoneName.toLowerCase()}`)) return label; // already an FQDN
  return `${label}.${zoneName}`;
}

/** The content Cloudflare expects for a record (SRV gets weight/port baked in). */
export function labelContentFor(
  rec: { type: string; name: string; value: string; priority: number | null; port: number | null; weight: number | null },
  zoneName: string
): { name: string; content: string; priority?: number } {
  const name = labelToCfName(rec.name ?? "", zoneName);
  switch (rec.type) {
    case "MX":
      return { name, content: rec.value, priority: rec.priority ?? undefined };
    case "SRV":
      return {
        name: labelToCfName(rec.name ?? "", zoneName),
        content: `${rec.weight ?? 0} ${rec.port ?? 0} ${rec.value}`,
        priority: rec.priority ?? undefined,
      };
    default:
      return { name, content: rec.value };
  }
}

/** Split a Cloudflare SRV/TXT-style content back into our value shape. */
export function contentFromCf(cf: CfRecord, zoneName: string): { value: string; priority: number | null; port: number | null; weight: number | null } {
  const name = cfNameToLabel(cf.name, zoneName);
  if (cf.type === "SRV") {
    const parts = cf.content.trim().split(/\s+/);
    // SRV content is "weight port target" and priority lives in cf.priority
    const weight = Number(parts[0]) || 0;
    const port = Number(parts[1]) || 0;
    const target = parts.slice(2).join(" ") || cf.content;
    return { value: target.replace(/\.$/, "").toLowerCase(), priority: cf.priority ?? 0, port, weight };
  }
  if (cf.type === "MX") {
    // CF returns MX content as the hostname; priority is a separate field
    return { value: cf.content.trim().replace(/\.$/, "").toLowerCase(), priority: cf.priority ?? 0, port: null, weight: null };
  }
  return { value: cf.content, priority: null, port: null, weight: null };
}

/* ————————————————————————— zone-scoped helper (DB-aware) ————————————————————————— */

export interface ProviderZoneContext {
  zone: { id: string; name: string; mode: string; provider: string | null; tokenEnc: string | null; cfZoneId: string | null };
  token: string;
  cfZoneId: string;
}

/**
 * Load a zone, decrypt its token and resolve the Cloudflare zone id
 * (using the cached id when present). Throws honest ApiErrors when the
 * zone isn't provider/cloudflare, has no token, or CF doesn't know it.
 */
export async function providerZoneContext(zoneId: string): Promise<ProviderZoneContext> {
  const zone = await db.dnsZone.findUnique({ where: { id: zoneId } });
  if (!zone) throw new ApiError(404, "not_found", "Zone not found");
  if (zone.mode !== "provider" || zone.provider !== "cloudflare") {
    throw new ApiError(400, "not_provider_zone", "This zone is not a Cloudflare provider zone (Edit zone → mode provider → Cloudflare).");
  }
  if (!zone.tokenEnc) {
    throw new ApiError(
      409,
      "no_token",
      "No Cloudflare API token stored for this zone. Edit the zone and paste a token with Zone · Read and DNS · Edit permissions."
    );
  }
  let token: string;
  try {
    const { decrypt } = await import("@/lib/crypto");
    token = decrypt(zone.tokenEnc);
  } catch {
    throw new ApiError(500, "token_decrypt_failed", "The stored token could not be decrypted — save it again via Edit zone.");
  }

  if (zone.cfZoneId) {
    // validate the cached id cheaply via one record page (404 → re-resolve)
    try {
      await listCloudflareRecords(token, zone.cfZoneId);
      return { zone, token, cfZoneId: zone.cfZoneId };
    } catch (e) {
      if (!(e instanceof CloudflareError && e.httpStatus === 404)) throw e;
    }
  }
  const found = await findCloudflareZoneId(token, zone.name);
  await db.dnsZone.update({ where: { id: zone.id }, data: { cfZoneId: found.id } });
  return { zone, token, cfZoneId: found.id };
}
