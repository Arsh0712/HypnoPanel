import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { renderBindZone } from "../../../../dns/_lib/records";

export const runtime = "nodejs";

/**
 * GET /api/dns/zones/[id]/export — a real BIND zone file: SOA header
 * (serial from the zone's last update), $ORIGIN/$TTL, NS, and every enabled
 * record with correct type-specific formatting and TXT quoting/chunking.
 */
export const GET = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await guard(req, { permission: "dns:read" });
  const { id } = await params;
  const zone = await db.dnsZone.findUnique({ where: { id }, include: { records: true } });
  if (!zone) throw new ApiError(404, "not_found", "Zone not found");

  const file = renderBindZone(zone, zone.records);

  return new NextResponse(file, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${zone.name}.zone"`,
      "cache-control": "no-store",
    },
  });
});
