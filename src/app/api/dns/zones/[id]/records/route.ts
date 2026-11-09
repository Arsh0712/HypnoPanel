import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { assertNoCnameConflict, validateRecordInput } from "../../../_lib/records";
import {
  providerZoneContext,
  labelContentFor,
  createCloudflareRecord,
  type ProviderZoneContext,
} from "@/lib/cloudflare";

export const runtime = "nodejs";

/**
 * POST /api/dns/zones/[id]/records — add a record with per-type validation
 * (IPv4/IPv6, MX priority, SRV parts, CAA shape) and the server-side CNAME
 * exclusivity check. On a Cloudflare provider zone the record is ALSO
 * created in Cloudflare immediately (FIX#2 §3.3) and linked by remote id;
 * the response carries the honest per-record sync outcome.
 */
export const POST = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await guard(req, { permission: "dns:write" });
  const { id } = await params;
  const zone = await db.dnsZone.findUnique({ where: { id } });
  if (!zone) throw new ApiError(404, "not_found", "Zone not found");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const rec = validateRecordInput(body);
  await assertNoCnameConflict(zone.id, rec);

  const isProviderZone = zone.mode === "provider" && zone.provider === "cloudflare" && !!zone.tokenEnc;

  const created = await db.dnsRecord.create({
    data: {
      zoneId: zone.id,
      type: rec.type,
      name: rec.name,
      value: rec.value,
      ttl: rec.ttl,
      priority: rec.priority,
      port: rec.port,
      weight: rec.weight,
      enabled: body.enabled === false ? false : true,
      syncState: isProviderZone ? "pending" : null,
    },
  });

  // immediate propagation to Cloudflare (best-effort with honest outcome)
  let sync: { state: string; error?: string } = { state: "local_only" };
  if (isProviderZone) {
    let providerCtx: ProviderZoneContext | null = null;
    try {
      providerCtx = await providerZoneContext(zone.id);
    } catch (e) {
      sync = { state: "error", error: e instanceof ApiError ? e.message : "Cloudflare unreachable" };
      await db.dnsRecord.update({ where: { id: created.id }, data: { syncState: "error", syncError: sync.error } });
    }
    if (providerCtx) {
      const { token, cfZoneId } = providerCtx;
      const payload = labelContentFor(created, zone.name);
      try {
        const remote = await createCloudflareRecord(token, cfZoneId, {
          type: created.type,
          name: payload.name,
          content: payload.content,
          ttl: created.ttl,
          ...(payload.priority !== undefined ? { priority: payload.priority } : {}),
          comment: "managed by HipnoType",
        });
        await db.dnsRecord.update({ where: { id: created.id }, data: { remoteId: remote.id, syncState: "synced", syncError: null } });
        sync = { state: "synced" };
      } catch (e) {
        const message = e instanceof ApiError ? e.message : "Cloudflare rejected the record";
        await db.dnsRecord.update({ where: { id: created.id }, data: { syncState: "error", syncError: message.slice(0, 500) } });
        sync = { state: "error", error: message };
      }
    }
  }

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "dns.record.create",
    target: `${rec.type} ${rec.name === "@" ? zone.name : `${rec.name}.${zone.name}`}`,
    sourceIp: getClientIp(req),
    details: { zone: zone.name, value: rec.value, ttl: rec.ttl, priority: rec.priority, providerSync: sync.state, syncError: sync.error ?? null },
  });

  return NextResponse.json({ record: await db.dnsRecord.findUnique({ where: { id: created.id } }), sync }, { status: 201 });
});
