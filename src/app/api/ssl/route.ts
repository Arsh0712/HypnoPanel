import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { handle } from "@/lib/api-error";

export const runtime = "nodejs";

/** Certificate fields safe to expose (no key material, no PEM in the list). */
function toClientCert(c: {
  id: string;
  name: string;
  type: string;
  subject: string | null;
  issuer: string | null;
  sans: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  createdAt: Date;
}) {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    subject: c.subject,
    issuer: c.issuer,
    sans: c.sans,
    validFrom: c.validFrom,
    validTo: c.validTo,
    createdAt: c.createdAt,
  };
}

/** GET /api/ssl — list certificates (no key material, no PEM bodies). */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "websites:read" });
  const rows = await db.certificate.findMany({
    orderBy: { createdAt: "desc" },
    include: { websites: { select: { id: true, domain: true } } },
  });
  return NextResponse.json({
    certificates: rows.map((c) => ({
      ...toClientCert(c),
      sites: c.websites.map((w) => ({ id: w.id, domain: w.domain })),
    })),
  });
});
