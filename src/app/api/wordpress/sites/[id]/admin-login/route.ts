import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";
import { binaryExists } from "@/lib/exec";
import { getSiteOr404, parseScanJson, issueAdminLoginToken, type WpScanData } from "../../../_lib";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/** Detect whether a PHP runtime serves this machine at all (honest note). */
async function probePhpRuntime(): Promise<boolean> {
  const candidates = ["php", "php-fpm", "php-fpm8.4", "php-fpm8.3", "php-fpm8.2", "php-fpm8.1"];
  for (const bin of candidates) {
    if (await binaryExists(bin)) return true;
  }
  return false;
}

/**
 * POST /api/wordpress/sites/[id]/admin-login — issue a single-use 15-minute
 * admin login token. Only the SHA-256 hash is stored (in the scanJson
 * settings area); the token itself is returned exactly once.
 */
export const POST = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "wordpress:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;
  const site = await getSiteOr404(id);

  const scan = parseScanJson(site.scanJson) as WpScanData;
  const { token, settings } = issueAdminLoginToken(ctx.email);
  const nextScan: WpScanData = { ...scan, settings: { ...scan.settings, adminLogin: { ...settings, issuedBy: ctx.email } } };
  await db.wpSite.update({ where: { id }, data: { scanJson: JSON.stringify(nextScan) } });

  const phpRuntime = await probePhpRuntime();

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "wp.adminlogin.issue",
    target: site.name,
    sourceIp: ip,
    details: { expiresAt: settings.expiresAt, phpRuntime },
  });

  return NextResponse.json({
    url: `/api/wordpress/sites/${site.id}/admin-login?token=${token}`,
    expiresAt: settings.expiresAt,
    phpRuntime,
    note: phpRuntime
      ? "Single-use link: opening it validates the token and redirects to the site's wp-login.php. Fully automatic sign-on additionally requires the HipnoType companion plugin on the site."
      : "This environment has no PHP runtime serving the site, so the panel cannot inject a session — the link validates the token and redirects to the site's standard wp-login.php page. On the VPS deployment the HipnoType companion plugin turns this into a one-click sign-on.",
  });
});

/**
 * GET /api/wordpress/sites/[id]/admin-login?token=… — validate + consume the
 * single-use token and 302-redirect to <site url>/wp-login.php.
 */
export const GET = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "wordpress:read" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;
  const site = await getSiteOr404(id);

  const token = new URL(req.url).searchParams.get("token") || "";
  const scan = parseScanJson(site.scanJson) as WpScanData;
  const stored = scan.settings?.adminLogin;

  const fail = async (message: string, code: string) => {
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "wp.adminlogin.consume",
      target: site.name,
      sourceIp: ip,
      result: "failure",
      details: { reason: message },
    });
    throw new ApiError(401, code, message);
  };

  if (!token) return fail("Missing token", "missing_token");
  if (!stored) return fail("No admin-login token has been issued for this site", "no_token");
  const expired = new Date(stored.expiresAt).getTime() < Date.now();
  if (expired) {
    // consume the dead token so it can never be replayed
    await db.wpSite.update({
      where: { id },
      data: { scanJson: JSON.stringify({ ...scan, settings: { ...scan.settings, adminLogin: null } }) },
    });
    return fail("This login link expired (valid for 15 minutes after issue)", "token_expired");
  }
  const { sha256Hex } = await import("@/lib/crypto");
  if (sha256Hex(token) !== stored.tokenHash) {
    return fail("Invalid token", "invalid_token");
  }

  // valid → consume (single use) and redirect
  await db.wpSite.update({
    where: { id },
    data: { scanJson: JSON.stringify({ ...scan, settings: { ...scan.settings, adminLogin: null } }) },
  });
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "wp.adminlogin.consume",
    target: site.name,
    sourceIp: ip,
    details: { redirect: true },
  });

  const target = new URL("/wp-login.php", site.url).toString();
  return NextResponse.redirect(target, 302);
});
