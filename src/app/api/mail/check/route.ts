import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { handle } from "@/lib/api-error";
import { runMailChecks } from "../_lib/checks";

export const runtime = "nodejs";

/**
 * POST /api/mail/check — run every deliverability readiness check (spec
 * §5.17) for real: PTR + FCrDNS per public IP, hostname alignment, outbound
 * port connects, DNSBL lookups and per-domain SPF/DKIM/DMARC. Read-only —
 * nothing is mutated, so no audit entry.
 */
export const POST = handle(async (req: NextRequest) => {
  await guard(req, { permission: "mail:read" });

  const domains = await db.mailDomain.findMany({
    select: { domain: true, dkimSelector: true, dkimPublic: true },
    orderBy: { domain: "asc" },
  });

  const result = await runMailChecks(domains);
  return NextResponse.json(result);
});
