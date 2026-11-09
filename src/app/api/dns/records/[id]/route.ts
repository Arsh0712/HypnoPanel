import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { assertNoCnameConflict, validateRecordInput } from "../../_lib/records";
import {
  providerZoneContext,
  labelContentFor,
  createCloudflareRecord,
  updateCloudflareRecord,
  deleteCloudflareRecord,
  type ProviderZoneContext,
} from "@/lib/cloudflare";

export const runtime = "nodejs";

interface SyncOutcome {
  state: "synced" | "pending" | "error" | "local_only";
  error?: string;
}

/**
 * Push a local record to Cloudflare when its zone is a verified provider
 * zone (FIX#2 §3.3 — bidirectional). Best-effort semantics: the local write
 * stands, but the sync outcome is persisted (syncState/syncError) and
 * returned so the UI can show an honest per-record badge.
 */
async function propagateToCloudflare(
  ctxInfo: ProviderZoneContext | null,
  local: { id: string; type: string; name: string; value: string; ttl: number; priority: number | null; port: number | null; weight: number | null; remoteId: string | null; enabled: boolean },
  op: "create" | "update" | "delete"
): Promise<SyncOutcome> {
  if (!ctxInfo) return { state: "local_only" };
  const { token, cfZoneId, zone } = ctxInfo;
  const payload = labelContentFor(local, zone.name);
  try {
    if (op === "delete") {
      if (local.remoteId) {
        try {
          await deleteCloudflareRecord(token, cfZoneId, local.remoteId);
        } catch (e) {
          // 404 on delete = already gone in Cloudflare — treat as success
          const status = e instanceof ApiError ? e.status : null;
          if (status !== 404) throw e;
        }
      }
      return { state: "synced" };
    }
    const body = {
      type: local.type,
      name: payload.name,
      content: payload.content,
      ttl: local.ttl,
      ...(payload.priority !== undefined ? { priority: payload.priority } : {}),
      comment: "managed by HipnoType",
    };
    if (op === "create") {
      const created = await createCloudflareRecord(token, cfZoneId, body);
      await db.dnsRecord.update({ where: { id: local.id }, data: { remoteId: created.id, syncState: "synced", syncError: null } });
      return { state: "synced" };
    }
    if (local.remoteId) {
      await updateCloudflareRecord(token, cfZoneId, local.remoteId, body);
    } else {
      // no remote linkage yet (e.g. imported locally) → create remotely
      const created = await createCloudflareRecord(token, cfZoneId, body);
      await db.dnsRecord.update({ where: { id: local.id }, data: { remoteId: created.id } });
    }
    await db.dnsRecord.update({ where: { id: local.id }, data: { syncState: "synced", syncError: null } });
    return { state: "synced" };
  } catch (e) {
    const message = e instanceof ApiError ? e.message : "Cloudflare rejected the change";
    await db.dnsRecord
      .update({ where: { id: local.id }, data: { syncState: "error", syncError: message.slice(0, 500) } })
      .catch(() => {});
    return { state: "error", error: message };
  }
}

/** Resolve provider context for the record's zone, or null for local zones. */
async function providerContextOrNull(zoneId: string): Promise<ProviderZoneContext | null> {
  const zone = await db.dnsZone.findUnique({ where: { id: zoneId } });
  if (!zone || zone.mode !== "provider" || zone.provider !== "cloudflare" || !zone.tokenEnc) return null;
  try {
    return await providerZoneContext(zoneId);
  } catch {
    // no token / CF unreachable — local write still proceeds, sync stays pending
    return null;
  }
}

/**
 * PATCH /api/dns/records/[id] — edit any subset of a record's fields (full
 * re-validation on the merged result) or toggle enabled/disabled. On a
 * provider zone the change is pushed to Cloudflare immediately.
 */
export const PATCH = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await guard(req, { permission: "dns:write" });
  const { id } = await params;
  const existing = await db.dnsRecord.findUnique({ where: { id }, include: { zone: true } });
  if (!existing) throw new ApiError(404, "not_found", "Record not found");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // pure enable/disable fast path (still propagates on provider zones)
  if (Object.keys(body).length === 1 && body.enabled !== undefined) {
    const enabled = !!body.enabled;
    const updated = await db.dnsRecord.update({ where: { id }, data: { enabled } });
    const providerCtx = await providerContextOrNull(existing.zoneId);
    const sync = await propagateToCloudflare(providerCtx, { ...updated, remoteId: existing.remoteId }, "update");
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: enabled ? "dns.record.enable" : "dns.record.disable",
      target: `${existing.type} ${existing.name === "@" ? existing.zone.name : `${existing.name}.${existing.zone.name}`}`,
      sourceIp: getClientIp(req),
      details: { zone: existing.zone.name, providerSync: sync.state, syncError: sync.error ?? null },
    });
    return NextResponse.json({ record: await db.dnsRecord.findUnique({ where: { id } }), sync });
  }

  const merged = validateRecordInput({
    type: body.type ?? existing.type,
    name: body.name ?? existing.name,
    value: body.value ?? existing.value,
    ttl: body.ttl ?? existing.ttl,
    priority: body.priority ?? existing.priority,
    port: body.port ?? existing.port,
    weight: body.weight ?? existing.weight,
  });
  await assertNoCnameConflict(existing.zoneId, merged, id);

  const updated = await db.dnsRecord.update({
    where: { id },
    data: {
      type: merged.type,
      name: merged.name,
      value: merged.value,
      ttl: merged.ttl,
      priority: merged.priority,
      port: merged.port,
      weight: merged.weight,
      ...(body.enabled !== undefined ? { enabled: !!body.enabled } : {}),
      syncState: "pending",
      syncError: null,
    },
  });

  const providerCtx = await providerContextOrNull(existing.zoneId);
  const sync = await propagateToCloudflare(providerCtx, { ...updated, remoteId: existing.remoteId }, "update");

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "dns.record.update",
    target: `${merged.type} ${merged.name === "@" ? existing.zone.name : `${merged.name}.${existing.zone.name}`}`,
    sourceIp: getClientIp(req),
    details: { zone: existing.zone.name, from: existing.value, to: merged.value, providerSync: sync.state, syncError: sync.error ?? null },
  });

  return NextResponse.json({ record: await db.dnsRecord.findUnique({ where: { id } }), sync });
});

/** DELETE /api/dns/records/[id] — on provider zones the remote record is deleted too. */
export const DELETE = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await guard(req, { permission: "dns:write" });
  const { id } = await params;
  const existing = await db.dnsRecord.findUnique({ where: { id }, include: { zone: true } });
  if (!existing) throw new ApiError(404, "not_found", "Record not found");

  const providerCtx = await providerContextOrNull(existing.zoneId);
  const sync = await propagateToCloudflare(providerCtx, { ...existing, remoteId: existing.remoteId }, "delete");

  await db.dnsRecord.delete({ where: { id } });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "dns.record.delete",
    target: `${existing.type} ${existing.name === "@" ? existing.zone.name : `${existing.name}.${existing.zone.name}`}`,
    sourceIp: getClientIp(req),
    details: { zone: existing.zone.name, value: existing.value, providerSync: sync.state, syncError: sync.error ?? null },
  });

  return NextResponse.json({ ok: true, sync });
});
