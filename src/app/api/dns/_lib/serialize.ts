import { decrypt } from "@/lib/crypto";

/**
 * Serialisers for /api/dns/** responses. Secrets are never returned — only a
 * masked hint (•••• + last 2 chars), per the panel-wide convention.
 */

export interface ZoneRecordLike {
  id: string;
  zoneId: string;
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
  port: number | null;
  weight: number | null;
  enabled: boolean;
  remoteId?: string | null;
  syncState?: string | null;
  syncError?: string | null;
  proxied?: boolean;
  origin?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ZoneLike {
  id: string;
  name: string;
  mode: string;
  provider: string | null;
  tokenEnc: string | null;
  tokenStatus?: string | null;
  tokenVerifiedAt?: Date | null;
  lastSyncAt?: Date | null;
  primary: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function maskToken(tokenEnc: string | null): string | null {
  if (!tokenEnc) return null;
  try {
    const t = decrypt(tokenEnc);
    return `••••${t.slice(-2)}`;
  } catch {
    return "••••";
  }
}

export function zoneToSummary(z: ZoneLike, recordCount: number) {
  return {
    id: z.id,
    name: z.name,
    mode: z.mode,
    provider: z.provider,
    hasToken: !!z.tokenEnc,
    tokenMasked: maskToken(z.tokenEnc),
    tokenStatus: z.tokenStatus ?? (z.tokenEnc ? "unverified" : null),
    tokenVerifiedAt: z.tokenVerifiedAt ?? null,
    lastSyncAt: z.lastSyncAt ?? null,
    primary: z.primary,
    recordCount,
    createdAt: z.createdAt,
    updatedAt: z.updatedAt,
  };
}

export function zoneToDetail(z: ZoneLike, records: ZoneRecordLike[]) {
  return {
    ...zoneToSummary(z, records.length),
    records: [...records]
      .sort((a, b) => (a.name === "@" ? -1 : b.name === "@" ? 1 : a.name.localeCompare(b.name)) || a.type.localeCompare(b.type))
      .map((r) => ({
        ...r,
        syncState: r.syncState ?? null,
        syncError: r.syncError ?? null,
        remoteId: r.remoteId ?? null,
        proxied: r.proxied ?? false,
        origin: r.origin ?? "panel",
      })),
  };
}
