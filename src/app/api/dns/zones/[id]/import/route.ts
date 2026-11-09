import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { assertNoCnameInBatch, parseBindZone } from "../../../../dns/_lib/records";

export const runtime = "nodejs";

/**
 * POST /api/dns/zones/[id]/import {text, mode: replace|merge} — strict BIND
 * parser (line numbers in every error, $TTL/$ORIGIN, A/AAAA/CNAME/MX/TXT/NS).
 * Nothing is written unless the whole file parses and passes the CNAME rule.
 */
export const POST = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await guard(req, { permission: "dns:write" });
  const { id } = await params;
  const zone = await db.dnsZone.findUnique({ where: { id }, include: { records: true } });
  if (!zone) throw new ApiError(404, "not_found", "Zone not found");

  const body = (await req.json().catch(() => ({}))) as { text?: string; mode?: string };
  const mode = body.mode === "merge" ? "merge" : "replace";

  const { records } = parseBindZone(String(body.text ?? ""), zone.name);

  // CNAME exclusivity inside the batch (and against existing rows when merging)
  if (mode === "replace") {
    assertNoCnameInBatch(records);
  } else {
    assertNoCnameInBatch([
      ...zone.records.map((r) => ({ name: r.name, type: r.type })),
      ...records.map((r) => ({ name: r.name, type: r.type })),
    ]);
  }

  const imported = await db.$transaction(async (tx) => {
    let replaced = 0;
    if (mode === "replace") {
      const del = await tx.dnsRecord.deleteMany({ where: { zoneId: zone.id } });
      replaced = del.count;
    }
    for (const r of records) {
      await tx.dnsRecord.create({
        data: {
          zoneId: zone.id,
          type: r.type,
          name: r.name,
          value: r.value,
          ttl: r.ttl,
          priority: r.priority,
          port: r.port,
          weight: r.weight,
          enabled: true,
          origin: "import-bind",
        },
      });
    }
    return { imported: records.length, replaced };
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "dns.zone.import",
    target: zone.name,
    sourceIp: getClientIp(req),
    details: { mode, imported: imported.imported, replaced: imported.replaced },
  });

  return NextResponse.json(imported);
});
