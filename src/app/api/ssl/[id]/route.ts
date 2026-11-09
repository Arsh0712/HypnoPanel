import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { SITES_DIR } from "@/lib/constants";
import { generateVhostConfig, parseSettings, type SiteType } from "@/lib/site-config";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/ssl/[id] — certificate detail (cert PEM included, never the key). */
export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  await guard(req, { permission: "websites:read" });
  const { id } = await ctx.params;
  const cert = await db.certificate.findUnique({
    where: { id },
    include: { websites: { select: { id: true, domain: true } } },
  });
  if (!cert) throw new ApiError(404, "not_found", "Certificate not found");
  return NextResponse.json({
    certificate: {
      id: cert.id,
      name: cert.name,
      type: cert.type,
      certPem: cert.certPem,
      subject: cert.subject,
      issuer: cert.issuer,
      sans: cert.sans,
      validFrom: cert.validFrom,
      validTo: cert.validTo,
      createdAt: cert.createdAt,
      sites: cert.websites.map((w) => ({ id: w.id, domain: w.domain })),
    },
  });
});

/** DELETE /api/ssl/[id] — detach from all sites first, then remove. */
export const DELETE = handle(async (req: NextRequest, ctx: Ctx) => {
  const auth = await guard(req, { permission: "websites:write" });
  const { id } = await ctx.params;
  const cert = await db.certificate.findUnique({ where: { id } });
  if (!cert) throw new ApiError(404, "not_found", "Certificate not found");

  const attached = await db.website.findMany({ where: { certId: id } });
  for (const site of attached) {
    await db.website.update({ where: { id: site.id }, data: { certId: null, sslMode: "none" } });
    const sslDir = path.join(SITES_DIR, site.slug, "ssl");
    if (fs.existsSync(sslDir)) fs.rmSync(sslDir, { recursive: true, force: true });
    // regenerate the affected vhost without the tls block
    const settings = parseSettings(site.settings);
    const config = generateVhostConfig({
      name: site.name,
      slug: site.slug,
      domain: site.domain,
      type: site.type as SiteType,
      upstreamUrl: site.upstreamUrl,
      status: site.status,
      sslMode: "none",
      settings,
    });
    await db.website.update({ where: { id: site.id }, data: { config } });
  }

  await db.certificate.delete({ where: { id } });

  await audit({
    actorId: auth.userId,
    actorEmail: auth.email,
    action: "ssl.delete",
    target: cert.subject || cert.name,
    sourceIp: getClientIp(req),
    details: { detachedFrom: attached.map((s) => s.domain) },
  });

  return NextResponse.json({ ok: true, detachedFrom: attached.map((s) => s.domain) });
});
