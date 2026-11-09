import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { IDENT_RE } from "@/lib/validation";
import { SITES_DIR } from "@/lib/constants";
import { normalizeDomain, freshDnsToken } from "@/lib/dns-verify";
import {
  buildIndexHtml,
  generatePhpFpmPoolConfig,
  generateVhostConfig,
  defaultSettings,
  slugifyName,
  toClientWebsite,
  uniqueSlug,
  type SiteType,
} from "@/lib/site-config";

export const runtime = "nodejs";

const SITE_TYPES: SiteType[] = ["static", "php", "node", "proxy"];
const PHP_VERSIONS = ["7.4", "8.0", "8.1", "8.2", "8.3"];

/** GET /api/websites — list all websites (with certificate summary). */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "websites:read" });
  const rows = await db.website.findMany({
    orderBy: { createdAt: "desc" },
    include: { certificate: true },
  });
  return NextResponse.json({ websites: rows.map(toClientWebsite) });
});

/**
 * POST /api/websites — create a website:
 * real docRoot + logs dirs on disk, real index.html scaffold, generated
 * Caddyfile vhost config, linux user site-<slug>.
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "websites:write" });
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    domain?: string;
    type?: string;
    phpVersion?: string;
    upstreamUrl?: string;
  };

  const name = (body.name || "").trim();
  const norm = normalizeDomain(body.domain || "");
  if (!norm.ok || !norm.domain) {
    throw new ApiError(400, "invalid_domain", norm.error || "Enter a valid domain, e.g. example.com");
  }
  const domain = norm.domain;
  const type = (body.type || "static") as SiteType;

  if (!name || name.length > 100) {
    throw new ApiError(400, "invalid_input", "Name is required (1–100 characters)");
  }
  if (!SITE_TYPES.includes(type)) {
    throw new ApiError(400, "invalid_input", "Type must be one of: static, php, node, proxy");
  }

  let phpVersion: string | null = null;
  if (type === "php") {
    phpVersion = body.phpVersion || "8.3";
    if (!PHP_VERSIONS.includes(phpVersion)) {
      throw new ApiError(400, "invalid_input", `phpVersion must be one of: ${PHP_VERSIONS.join(", ")}`);
    }
  }

  let upstreamUrl: string | null = null;
  if (type === "proxy") {
    upstreamUrl = (body.upstreamUrl || "").trim();
    if (!/^https?:\/\/[^\s]+$/.test(upstreamUrl)) {
      throw new ApiError(400, "invalid_input", "Proxy sites need an upstream URL (http:// or https://)");
    }
  }

  const existingDomain = await db.website.findFirst({ where: { domain } });
  if (existingDomain) {
    throw new ApiError(409, "domain_taken", `The domain ${domain} is already served by another website`);
  }

  const base = slugifyName(name);
  if (!IDENT_RE.test(base)) {
    throw new ApiError(400, "invalid_input", "Could not derive a safe slug from this name");
  }
  const slug = await uniqueSlug(base, async (candidate) => {
    const row = await db.website.findUnique({ where: { slug: candidate } });
    return !!row || fs.existsSync(path.join(SITES_DIR, candidate));
  });

  const siteDir = path.join(SITES_DIR, slug);
  const docRoot = path.join(siteDir, "htdocs");
  const logsDir = path.join(siteDir, "logs");
  fs.mkdirSync(docRoot, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(path.join(docRoot, "index.html"), buildIndexHtml(name, domain), { mode: 0o644 });

  const settings = defaultSettings();
  if (type === "php" && phpVersion) {
    settings.phpPool = generatePhpFpmPoolConfig(slug, phpVersion);
  }

  const linuxUser = `site-${slug}`;
  const config = generateVhostConfig({
    name,
    slug,
    domain,
    type,
    upstreamUrl,
    status: "active",
    sslMode: "none",
    settings,
  });

  const website = await db.website.create({
    data: {
      name,
      slug,
      domain,
      type,
      docRoot,
      linuxUser,
      phpVersion,
      upstreamUrl,
      status: "active",
      sslMode: "none",
      config,
      settings: JSON.stringify(settings),
      dnsStatus: "pending_dns",
      dnsToken: freshDnsToken(),
    },
    include: { certificate: true },
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "website.create",
    target: domain,
    sourceIp: getClientIp(req),
    details: { name, slug, type, phpVersion },
  });

  return NextResponse.json({ website: toClientWebsite(website) }, { status: 201 });
});
