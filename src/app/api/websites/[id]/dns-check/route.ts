import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import { getPublicIps } from "@/lib/sysinfo";
import { expectedRecords, verifyDomain, VERIFY_RESOLVERS, type DomainVerification } from "@/lib/dns-verify";

export const runtime = "nodejs";

/**
 * POST /api/websites/[id]/dns-check — run the REAL multi-resolver
 * verification for this website's domain and persist the result + state
 * (pending_dns → dns_verified). The website's dnsToken is the ownership
 * challenge; the public IPs come from live detection.
 */
export const POST = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await guard(req, { permission: "websites:write" });
  const { id } = await params;
  const site = await db.website.findUnique({ where: { id } });
  if (!site) throw new ApiError(404, "not_found", "Website not found");
  if (!site.dnsToken) {
    throw new ApiError(409, "no_challenge", "This website predates the guided domain flow and has no challenge token");
  }

  const ips = await getPublicIps();
  const records = expectedRecords(site.domain, ips, site.dnsToken);
  const verification = await verifyDomain(site.domain, records, site.dnsToken);

  const nextStatus = verification.verdict === "verified" ? "dns_verified" : site.dnsStatus === "dns_verified" ? "dns_verified" : "pending_dns";
  await db.website.update({
    where: { id },
    data: {
      dnsStatus: nextStatus,
      dnsCheckJson: JSON.stringify(verification),
      dnsCheckedAt: new Date(),
    },
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "website.dns_check",
    target: site.domain,
    sourceIp: getClientIp(req),
    details: { verdict: verification.verdict, resolvers: VERIFY_RESOLVERS },
  });

  return NextResponse.json({ verification, dnsStatus: nextStatus });
});

/** GET /api/websites/[id]/dns-check — last persisted verification. */
export const GET = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await guard(req, { permission: "websites:read" });
  const { id } = await params;
  const site = await db.website.findUnique({ where: { id } });
  if (!site) throw new ApiError(404, "not_found", "Website not found");
  const verification: DomainVerification | null = site.dnsCheckJson
    ? (JSON.parse(site.dnsCheckJson) as DomainVerification)
    : null;
  return NextResponse.json({
    verification,
    dnsStatus: site.dnsStatus,
    dnsToken: site.dnsToken,
    dnsCheckedAt: site.dnsCheckedAt,
  });
});
