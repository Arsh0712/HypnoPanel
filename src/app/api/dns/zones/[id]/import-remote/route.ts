import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import {
  providerZoneContext,
  listCloudflareRecords,
  cfNameToLabel,
  contentFromCf,
  type CfRecord,
} from "@/lib/cloudflare";

export const runtime = "nodejs";

/**
 * POST /api/dns/zones/[id]/import-remote {mode: "merge"|"replace"}
 * (FIX#2 §3.2) — pull the zone's REAL records from Cloudflare into the
 * panel: every record the token can see, paginated 100/page, mapped back to
 * zone-relative labels, with priority/port/weight and proxied state kept.
 * merge  → keep existing panel records, add remote ones (default)
 * replace→ panel mirrors Cloudflare exactly (local-only records are dropped)
 * Managed provenance is stored per record (origin: "import-cloudflare").
 */

const KEEP_TYPES = new Set(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"]);

export const POST = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await guard(req, { permission: "dns:write" });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { mode?: string };
  const mode = body.mode === "replace" ? "replace" : "merge";

  const { zone, token, cfZoneId } = await providerZoneContext(id);
  const zoneName = zone.name;

  const remote = await listCloudflareRecords(token, cfZoneId, zoneName);

  const skipped: { name: string; type: string; reason: string }[] = [];
  const mapped = remote.filter((r: CfRecord) => {
    if (!KEEP_TYPES.has(r.type)) {
      skipped.push({ name: r.name, type: r.type, reason: "type not managed by the panel" });
      return false;
    }
    return true;
  });

  const result = await db.$transaction(async (tx) => {
    let replaced = 0;
    if (mode === "replace") {
      const del = await tx.dnsRecord.deleteMany({ where: { zoneId: zone.id } });
      replaced = del.count;
    }

    const existing = await tx.dnsRecord.findMany({ where: { zoneId: zone.id } });
    const byNaturalKey = new Map(existing.map((r) => [`${r.type}|${r.name}|${r.value}`, r]));

    let imported = 0;
    let linked = 0;
    for (const cf of mapped) {
      const label = cfNameToLabel(cf.name, zoneName);
      const parsed = contentFromCf(cf, zoneName);
      const ttl = cf.ttl === 1 ? 300 : cf.ttl; // 1 = Cloudflare "auto"
      const key = `${cf.type}|${label}|${parsed.value}`;
      const match = byNaturalKey.get(key);
      if (match) {
        // link the existing local record to its Cloudflare id
        await tx.dnsRecord.update({
          where: { id: match.id },
          data: { remoteId: cf.id, syncState: "synced", syncError: null, proxied: cf.proxied ?? false, enabled: true },
        });
        byNaturalKey.delete(key);
        linked++;
      } else {
        await tx.dnsRecord.create({
          data: {
            zoneId: zone.id,
            type: cf.type,
            name: label,
            value: parsed.value,
            ttl: Math.min(Math.max(ttl, 30), 604800),
            priority: parsed.priority,
            port: parsed.port,
            weight: parsed.weight,
            enabled: true,
            remoteId: cf.id,
            syncState: "synced",
            syncError: null,
            proxied: cf.proxied ?? false,
            origin: "import-cloudflare",
          },
        });
        imported++;
      }
    }
    return { imported, linked, replaced };
  });

  await db.dnsZone.update({ where: { id: zone.id }, data: { lastSyncAt: new Date() } });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "dns.zone.import_remote",
    target: zoneName,
    sourceIp: getClientIp(req),
    details: { mode, remoteTotal: remote.length, ...result, skipped: skipped.length },
  });

  return NextResponse.json({
    zone: zoneName,
    mode,
    remoteTotal: remote.length,
    ...result,
    skipped,
  });
});
