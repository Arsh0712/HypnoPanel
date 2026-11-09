import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { checkDomainRecords } from "../../../_lib/checks";

export const runtime = "nodejs";

/**
 * POST /api/mail/domains/[id]/verify — live SPF / DKIM / DMARC lookups for
 * this mail domain (direct queries against public resolvers, the pattern
 * from src/lib/dns-verify.ts). Read-only: no state is changed.
 */
export const POST = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await guard(req, { permission: "mail:read" });
  const { id } = await params;
  const domain = await db.mailDomain.findUnique({ where: { id } });
  if (!domain) throw new ApiError(404, "not_found", "Mail domain not found");

  const { spf, dkim, dmarc } = await checkDomainRecords({
    domain: domain.domain,
    dkimSelector: domain.dkimSelector,
    dkimPublic: domain.dkimPublic,
  });

  return NextResponse.json({ domain: domain.domain, spf, dmarc, dkim });
});
