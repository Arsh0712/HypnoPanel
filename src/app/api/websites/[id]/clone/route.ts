import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { isValidDomain } from "@/lib/validation";
import { SITES_DIR } from "@/lib/constants";
import {
  generateVhostConfig,
  parseSettings,
  slugifyName,
  toClientWebsite,
  uniqueSlug,
  type SiteType,
} from "@/lib/site-config";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/websites/[id]/clone { newDomain }
 * Real filesystem copy (fs.cpSync docRoot + logs + settings), new slug "-copy".
 */
export const POST = handle(async (req: NextRequest, ctx: Ctx) => {
  const auth = await guard(req, { permission: "websites:write" });
  const { id } = await ctx.params;
  const site = await db.website.findUnique({ where: { id } });
  if (!site) throw new ApiError(404, "not_found", "Website not found");

  const body = (await req.json().catch(() => ({}))) as { newDomain?: string };
  const newDomain = (body.newDomain || "").trim().toLowerCase();
  if (!isValidDomain(newDomain)) {
    throw new ApiError(400, "invalid_domain", "Enter a valid domain for the clone, e.g. staging.example.com");
  }
  const existing = await db.website.findFirst({ where: { domain: newDomain } });
  if (existing) {
    throw new ApiError(409, "domain_taken", `The domain ${newDomain} is already served by another website`);
  }

  const baseSlug = slugifyName(`${site.name} copy`);
  const newSlug = await uniqueSlug(baseSlug, async (candidate) => {
    const row = await db.website.findUnique({ where: { slug: candidate } });
    return !!row || fs.existsSync(path.join(SITES_DIR, candidate));
  });

  const srcDir = path.join(SITES_DIR, site.slug);
  const dstDir = path.join(SITES_DIR, newSlug);
  if (fs.existsSync(srcDir)) {
    fs.cpSync(srcDir, dstDir, { recursive: true, errorOnExist: true, force: false });
  } else {
    fs.mkdirSync(path.join(dstDir, "htdocs"), { recursive: true });
    fs.mkdirSync(path.join(dstDir, "logs"), { recursive: true });
  }

  // Clones never inherit the source site's certificate attachment.
  const clonedSslDir = path.join(dstDir, "ssl");
  if (fs.existsSync(clonedSslDir)) fs.rmSync(clonedSslDir, { recursive: true, force: true });

  const settings = parseSettings(site.settings);
  const config = generateVhostConfig({
    name: `${site.name} (copy)`,
    slug: newSlug,
    domain: newDomain,
    type: site.type as SiteType,
    upstreamUrl: site.upstreamUrl,
    status: "active",
    sslMode: "none",
    settings,
  });

  const clone = await db.website.create({
    data: {
      name: `${site.name} (copy)`,
      slug: newSlug,
      domain: newDomain,
      type: site.type,
      docRoot: path.join(dstDir, "htdocs"),
      linuxUser: `site-${newSlug}`,
      phpVersion: site.phpVersion,
      upstreamUrl: site.upstreamUrl,
      status: "active",
      sslMode: "none",
      config,
      settings: JSON.stringify(settings),
    },
    include: { certificate: true },
  });

  await audit({
    actorId: auth.userId,
    actorEmail: auth.email,
    action: "website.clone",
    target: newDomain,
    sourceIp: getClientIp(req),
    details: { source: site.domain, slug: newSlug },
  });

  return NextResponse.json({ website: toClientWebsite(clone) }, { status: 201 });
});
