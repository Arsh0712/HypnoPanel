import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import {
  providerZoneContext,
  listCloudflareRecords,
  createCloudflareRecord,
  updateCloudflareRecord,
  deleteCloudflareRecord,
  labelContentFor,
  cfNameToLabel,
  type CfRecord,
} from "@/lib/cloudflare";

export const runtime = "nodejs";

/** Normalise a value for comparison (case, trailing dots, MX priority prefixes). */
function contentEqual(a: string, b: string): boolean {
  const x = a.trim().toLowerCase().replace(/\.$/, "");
  const y = b.trim().toLowerCase().replace(/\.$/, "");
  if (x === y) return true;
  // Cloudflare returns MX content as "10 host" while we store just "host" (priority is separate)
  const strip = (v: string) => v.replace(/^\d+\s+(?=[a-z0-9])/, "");
  return strip(x) === strip(y);
}

/**
 * POST /api/dns/zones/[id]/sync {dryRun, deleteRemote?} — REAL Cloudflare
 * sync (FIX#2 §3.3/§3.4). Fetches the live records, three-way-diffs against
 * the panel, and applies: create missing, update changed values, optionally
 * delete remote records the panel no longer has (deleteRemote, default off),
 * and reports remote-only records without touching them. Per-record sync
 * state + lastSyncAt are persisted so the UI can show honest badges.
 */
export const POST = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await guard(req, { permission: "dns:write" });
  const { id } = await params;
  const zone = await db.dnsZone.findUnique({ where: { id }, include: { records: true } });
  if (!zone) throw new ApiError(404, "not_found", "Zone not found");

  const { zone: zoneRow, token, cfZoneId } = await providerZoneContext(id);

  const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean; deleteRemote?: boolean };
  const dryRun = body.dryRun !== false;
  const deleteRemote = body.deleteRemote === true;

  // 1) live remote records (all pages, real API)
  const remote = await listCloudflareRecords(token, cfZoneId, zone.name);

  // 2) three-way diff: panel (enabled) vs remote by (type, fqdn name)
  const local = zone.records.filter((r) => r.enabled);
  const key = (type: string, name: string) => `${type}|${name.toLowerCase()}`;
  const remoteByKey = new Map<string, CfRecord[]>();
  for (const r of remote) {
    const k = key(r.type, r.name);
    const arr = remoteByKey.get(k) ?? [];
    arr.push(r);
    remoteByKey.set(k, arr);
  }

  const toCreate: typeof local = [];
  const toUpdate: { local: (typeof local)[number]; remote: CfRecord }[] = [];
  let unchanged = 0;
  const consumedRemote = new Set<string>();

  for (const rec of local) {
    const fqdn = rec.name === "@" ? zone.name : `${rec.name}.${zone.name}`;
    const content =
      rec.type === "MX" ? rec.value : rec.type === "SRV" ? `${rec.weight ?? 0} ${rec.port ?? 0} ${rec.value}` : rec.value;
    const candidates = remoteByKey.get(key(rec.type, fqdn)) ?? [];
    const exact = candidates.find(
      (c) => !consumedRemote.has(c.id) && contentEqual(c.content, content) && (c.priority ?? null) === rec.priority
    );
    if (exact) {
      consumedRemote.add(exact.id);
      unchanged++;
      continue;
    }
    const sameNameType = candidates.find((c) => !consumedRemote.has(c.id));
    if (sameNameType) {
      consumedRemote.add(sameNameType.id);
      toUpdate.push({ local: rec, remote: sameNameType });
    } else {
      toCreate.push(rec);
    }
  }

  const remoteOnly = remote
    .filter((r) => !consumedRemote.has(r.id))
    .map((r) => ({ id: r.id, name: r.name, type: r.type, content: r.content, label: cfNameToLabel(r.name, zone.name) }));

  const diff = {
    create: toCreate.map((r) => ({ recordId: r.id, type: r.type, name: r.name === "@" ? zone.name : `${r.name}.${zone.name}`, content: r.value, ttl: r.ttl })),
    update: toUpdate.map(({ local: l, remote: rm }) => ({
      recordId: l.id,
      remoteId: rm.id,
      type: l.type,
      name: l.name === "@" ? zone.name : `${l.name}.${zone.name}`,
      from: rm.content,
      to: l.value,
    })),
    unchanged,
    remoteOnly,
  };

  if (dryRun) {
    return NextResponse.json({ dryRun: true, zoneName: zone.name, diff });
  }

  // 3) apply — real POST/PUT per record, honest per-item failures
  const failed: { name: string; error: string }[] = [];
  let created = 0;
  let updated = 0;
  let deleted = 0;
  let deletionsFailed = 0;

  for (const rec of toCreate) {
    const payload = labelContentFor(rec, zone.name);
    try {
      const remoteCreated = await createCloudflareRecord(token, cfZoneId, {
        type: rec.type,
        name: payload.name,
        content: payload.content,
        ttl: rec.ttl,
        ...(payload.priority !== undefined ? { priority: payload.priority } : {}),
        comment: "managed by HipnoType",
      });
      created++;
      await db.dnsRecord.update({
        where: { id: rec.id },
        data: { remoteId: remoteCreated.id, syncState: "synced", syncError: null },
      });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Cloudflare rejected the record";
      failed.push({ name: `${rec.type} ${payload.name}`, error: message });
      await db.dnsRecord.update({ where: { id: rec.id }, data: { syncState: "error", syncError: message.slice(0, 500) } }).catch(() => {});
    }
  }

  for (const { local: rec, remote: rm } of toUpdate) {
    const payload = labelContentFor(rec, zone.name);
    try {
      await updateCloudflareRecord(token, cfZoneId, rm.id, {
        type: rec.type,
        name: payload.name,
        content: payload.content,
        ttl: rec.ttl,
        ...(payload.priority !== undefined ? { priority: payload.priority } : {}),
        comment: rm.comment ?? "managed by HipnoType",
      });
      updated++;
      await db.dnsRecord.update({
        where: { id: rec.id },
        data: { remoteId: rm.id, syncState: "synced", syncError: null },
      });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Cloudflare rejected the record";
      failed.push({ name: `${rec.type} ${payload.name}`, error: message });
      await db.dnsRecord.update({ where: { id: rec.id }, data: { syncState: "error", syncError: message.slice(0, 500) } }).catch(() => {});
    }
  }

  // unchanged records get their remote linkage refreshed
  for (const rec of local) {
    if (rec.syncState !== "synced" && !failed.some((f) => f.name.startsWith(`${rec.type} `))) {
      const rm = remote.find(
        (r) => r.type === rec.type && (r.name === (rec.name === "@" ? zone.name : `${rec.name}.${zone.name}`))
      );
      if (rm) {
        await db.dnsRecord.update({ where: { id: rec.id }, data: { remoteId: rm.id, syncState: "synced", syncError: null } }).catch(() => {});
      }
    }
  }

  // optional: delete remote-only records (explicit opt-in only)
  if (deleteRemote && remoteOnly.length > 0) {
    for (const r of remoteOnly) {
      try {
        await deleteCloudflareRecord(token, cfZoneId, r.id);
        deleted++;
      } catch {
        deletionsFailed++;
      }
    }
  }

  const now = new Date();
  await db.dnsZone.update({ where: { id: zone.id }, data: { lastSyncAt: now } });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "dns.zone.sync",
    target: zone.name,
    sourceIp: getClientIp(req),
    details: { created, updated, deleted, failed: failed.length, remoteOnly: remoteOnly.length, deleteRemote },
  });

  return NextResponse.json({
    dryRun: false,
    zoneName: zone.name,
    diff,
    applied: { created, updated, deleted, failed, deletionsFailed },
  });
});
