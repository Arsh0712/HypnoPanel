import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { normalizeDomain } from "@/lib/dns-verify";
import { queryAllResolvers, recordWireValue, sameDnsValue, RECORD_TYPES } from "../_lib/records";

export const runtime = "nodejs";

/**
 * POST /api/dns/propagate {zoneId?, name, type} — propagation check that
 * queries every VERIFY_RESOLVER directly (one Resolver per server, 4 s
 * timeout, single try, all in parallel — the dns-verify.ts pattern) and
 * compares each answer with the zone's local value.
 */
export const POST = handle(async (req: NextRequest) => {
  await guard(req, { permission: "dns:read" });
  const body = (await req.json().catch(() => ({}))) as { zoneId?: string; name?: string; type?: string };

  const type = String(body.type || "A").toUpperCase();
  if (!(RECORD_TYPES as readonly string[]).includes(type)) {
    throw new ApiError(400, "invalid_type", `Type must be one of: ${RECORD_TYPES.join(", ")}`);
  }

  let fqdn: string;
  let localValues: string[] = [];

  if (body.zoneId) {
    const zone = await db.dnsZone.findUnique({ where: { id: body.zoneId }, include: { records: true } });
    if (!zone) throw new ApiError(404, "not_found", "Zone not found");

    const raw = String(body.name || "@").trim().toLowerCase().replace(/\.$/, "");
    if (!raw) throw new ApiError(400, "invalid_name", "Enter a name to check.");
    if (raw === "@") {
      fqdn = zone.name;
    } else if (raw === zone.name || raw.endsWith(`.${zone.name}`)) {
      fqdn = raw;
    } else {
      fqdn = `${raw}.${zone.name}`;
    }

    // matching local records ("@" or the relative label)
    const relName = fqdn === zone.name ? "@" : fqdn.slice(0, -zone.name.length - 1);
    localValues = zone.records
      .filter((r) => r.enabled && r.type === type && (r.name === relName || r.name === fqdn))
      .map((r) => recordWireValue(r));
  } else {
    const norm = normalizeDomain(String(body.name || ""));
    if (!norm.ok || !norm.domain) {
      throw new ApiError(400, "invalid_name", norm.error || "Enter a full name like www.example.com");
    }
    fqdn = norm.domain;
  }

  const resolvers = await queryAllResolvers(fqdn, type);

  return NextResponse.json({
    name: fqdn,
    type,
    localValues,
    resolvers: resolvers.map((r) => ({
      ...r,
      match: r.ok && localValues.length > 0 && r.values.some((v) => localValues.some((lv) => sameDnsValue(v, lv))),
    })),
  });
});
