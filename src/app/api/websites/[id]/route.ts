import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { SITES_DIR, TRASH_DIR } from "@/lib/constants";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  generateVhostConfig,
  parseSettings,
  toClientWebsite,
  type SiteSettings,
  type SiteType,
} from "@/lib/site-config";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

async function getSite(id: string) {
  const site = await db.website.findUnique({ where: { id }, include: { certificate: true } });
  if (!site) throw new ApiError(404, "not_found", "Website not found");
  return site;
}

/** Regenerate + persist the vhost config from current stored state. */
async function refreshConfig(id: string): Promise<void> {
  const site = await db.website.findUnique({ where: { id } });
  if (!site) return;
  const settings = parseSettings(site.settings);
  const config = generateVhostConfig({
    name: site.name,
    slug: site.slug,
    domain: site.domain,
    type: site.type as SiteType,
    upstreamUrl: site.upstreamUrl,
    status: site.status,
    sslMode: site.sslMode,
    settings,
  });
  await db.website.update({ where: { id }, data: { config } });
}

/**
 * PATCH /api/websites/[id]
 *  - { action: "enable" | "disable" | "regenerate-config" }
 *  - { action: "attach-cert", certId } / { action: "detach-cert" }
 *  - { settings: {...} } → merge + persist settings JSON, regenerate config
 */
export const PATCH = handle(async (req: NextRequest, ctx: Ctx) => {
  const auth = await guard(req, { permission: "websites:write" });
  const { id } = await ctx.params;
  const site = await getSite(id);
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    certId?: string | null;
    settings?: Partial<SiteSettings> & {
      basicAuth?: { enabled?: boolean; user?: string | null; password?: string | null };
    };
  };

  if (body.action) {
    const action = body.action;
    if (action === "enable" || action === "disable") {
      const status = action === "enable" ? "active" : "disabled";
      await db.website.update({ where: { id }, data: { status } });
      await refreshConfig(id);
      await audit({
        actorId: auth.userId,
        actorEmail: auth.email,
        action: action === "enable" ? "website.enable" : "website.disable",
        target: site.domain,
        sourceIp: getClientIp(req),
      });
    } else if (action === "regenerate" || action === "regenerate-config") {
      await refreshConfig(id);
      await audit({
        actorId: auth.userId,
        actorEmail: auth.email,
        action: "website.regenerate_config",
        target: site.domain,
        sourceIp: getClientIp(req),
      });
    } else if (action === "attach-cert") {
      const certId = body.certId || "";
      const cert = await db.certificate.findUnique({ where: { id: certId } });
      if (!cert) throw new ApiError(404, "not_found", "Certificate not found");
      // Write the real cert + key material for the web server (0600, dir 0700).
      const sslDir = path.join(SITES_DIR, site.slug, "ssl");
      fs.mkdirSync(sslDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(sslDir, "cert.pem"), cert.certPem, { mode: 0o600 });
      fs.writeFileSync(path.join(sslDir, "key.pem"), decrypt(cert.keyEnc), { mode: 0o600 });
      await db.website.update({
        where: { id },
        data: { certId: cert.id, sslMode: cert.type === "self" ? "self" : "custom" },
      });
      await refreshConfig(id);
      await audit({
        actorId: auth.userId,
        actorEmail: auth.email,
        action: "website.attach_cert",
        target: site.domain,
        sourceIp: getClientIp(req),
        details: { cert: cert.name },
      });
    } else if (action === "detach-cert") {
      await db.website.update({ where: { id }, data: { certId: null, sslMode: "none" } });
      const sslDir = path.join(SITES_DIR, site.slug, "ssl");
      if (fs.existsSync(sslDir)) {
        fs.rmSync(sslDir, { recursive: true, force: true });
      }
      await refreshConfig(id);
      await audit({
        actorId: auth.userId,
        actorEmail: auth.email,
        action: "website.detach_cert",
        target: site.domain,
        sourceIp: getClientIp(req),
      });
    } else {
      throw new ApiError(400, "invalid_action", "Unknown action");
    }
  } else if (body.settings) {
    const current = parseSettings(site.settings);
    const incoming = body.settings;

    // redirects
    if (Array.isArray(incoming.redirects)) {
      const redirects = incoming.redirects
        .filter(
          (r) =>
            r &&
            typeof r.from === "string" &&
            r.from.startsWith("/") &&
            r.from.length <= 200 &&
            typeof r.to === "string" &&
            r.to.length > 0 &&
            r.to.length <= 300
        )
        .slice(0, 50)
        .map((r) => ({ from: r.from, to: r.to }));
      current.redirects = redirects;
    }

    // basic auth (password is AES-256-GCM encrypted at rest, never returned)
    if (incoming.basicAuth) {
      current.basicAuth.enabled = !!incoming.basicAuth.enabled;
      if (incoming.basicAuth.user !== undefined) {
        const user = (incoming.basicAuth.user || "").trim();
        current.basicAuth.user =
          user.length >= 1 && user.length <= 32 && /^[A-Za-z0-9._-]+$/.test(user) ? user : null;
      }
      if (typeof incoming.basicAuth.password === "string" && incoming.basicAuth.password.length > 0) {
        if (incoming.basicAuth.password.length < 6 || incoming.basicAuth.password.length > 128) {
          throw new ApiError(400, "invalid_input", "Basic-auth password must be 6–128 characters");
        }
        current.basicAuth.passwordEnc = encrypt(incoming.basicAuth.password);
      }
      if (!current.basicAuth.enabled) {
        delete current.basicAuth.passwordEnc;
        current.basicAuth.user = current.basicAuth.user || null;
      }
    }

    // cache headers
    if (incoming.cacheHeaders) {
      current.cacheHeaders.enabled = !!incoming.cacheHeaders.enabled;
      if (Number.isFinite(incoming.cacheHeaders.maxAge)) {
        current.cacheHeaders.maxAge = Math.min(
          Math.max(Math.round(incoming.cacheHeaders.maxAge), 0),
          2_592_000
        );
      }
    }

    if (typeof incoming.gzip === "boolean") current.gzip = incoming.gzip;
    if (typeof incoming.forceHttps === "boolean") current.forceHttps = incoming.forceHttps;

    await db.website.update({ where: { id }, data: { settings: JSON.stringify(current) } });
    await refreshConfig(id);
    await audit({
      actorId: auth.userId,
      actorEmail: auth.email,
      action: "website.update_settings",
      target: site.domain,
      sourceIp: getClientIp(req),
      details: {
        redirects: current.redirects.length,
        basicAuth: current.basicAuth.enabled,
        cache: current.cacheHeaders.enabled,
        gzip: current.gzip,
        forceHttps: current.forceHttps,
      },
    });
  } else {
    throw new ApiError(400, "invalid_input", "Provide an action or settings");
  }

  const updated = await db.website.findUnique({ where: { id }, include: { certificate: true } });
  return NextResponse.json({ website: toClientWebsite(updated!) });
});

/** DELETE /api/websites/[id] — move site dir to data/trash, then remove the row. */
export const DELETE = handle(async (req: NextRequest, ctx: Ctx) => {
  const auth = await guard(req, { permission: "websites:write" });
  const { id } = await ctx.params;
  const site = await getSite(id);

  const siteDir = path.join(SITES_DIR, site.slug);
  if (fs.existsSync(siteDir)) {
    fs.mkdirSync(TRASH_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const trashPath = path.join(TRASH_DIR, `site-${site.slug}-${ts}`);
    try {
      fs.renameSync(siteDir, trashPath);
    } catch {
      // cross-device fallback: copy then remove
      fs.cpSync(siteDir, trashPath, { recursive: true });
      fs.rmSync(siteDir, { recursive: true, force: true });
    }
  }

  await db.website.delete({ where: { id } });
  await audit({
    actorId: auth.userId,
    actorEmail: auth.email,
    action: "website.delete",
    target: site.domain,
    sourceIp: getClientIp(req),
    details: { slug: site.slug },
  });

  return NextResponse.json({ ok: true });
});
