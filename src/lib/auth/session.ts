import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { randomBase62, sha256Hex } from "@/lib/crypto";
import { SESSION_COOKIE } from "@/lib/constants";
import { getSetting } from "@/lib/settings";
import type { User } from "@prisma/client";

/** Session creation / validation / cookies. Sessions are DB-backed rows. */

export interface SessionUser {
  user: User;
  sessionId: string;
  via: "cookie" | "api-token";
}

export function getClientIp(req: NextRequest): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "127.0.0.1";
}

export function isSecureRequest(req: NextRequest): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto === "https";
  return req.nextUrl.protocol === "https:";
}

/**
 * CSRF protection for state-changing methods.
 *
 * Strategy (works behind the preview gateway and the HipnoType Relay even
 * when the Host header is rewritten by a proxy):
 *  1. Modern browsers send `Sec-Fetch-Site` on every request and it is a
 *     forbidden header name — page JavaScript can never forge it. When
 *     present we trust it completely: same-origin / none pass, everything
 *     else (cross-origin AND same-site — other subdomains of a shared
 *     preview domain — is rejected because cookies ride along on the host).
 *  2. Requests without `Sec-Fetch-Site` are not browser requests (curl, the
 *     local CLI, server-to-server); CSRF does not apply to them. If they
 *     still send an Origin we compare it leniently against every host-ish
 *     header the proxy chain may have preserved.
 */
export function verifySameOrigin(req: Request): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return true;

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite) {
    return fetchSite === "same-origin" || fetchSite === "none";
  }

  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser client — no ambient cookie auth
  try {
    const stripPort = (h: string) => h.trim().toLowerCase().replace(/:(80|443)$/, "");
    const originHost = stripPort(new URL(origin).host);
    const candidates = [
      req.headers.get("x-forwarded-host"),
      req.headers.get("x-original-host"),
      req.headers.get("host"),
      req.headers.get("x-forwarded-server"),
    ]
      .filter((v): v is string => !!v)
      .flatMap((v) => v.split(","))
      .map(stripPort);
    return candidates.includes(originHost);
  } catch {
    return false;
  }
}

export async function createSession(
  userId: string,
  ip: string,
  userAgent: string | null
): Promise<{ token: string; expiresAt: Date }> {
  const idleMin = await getSetting("session.idleTimeoutMin", 30);
  const absoluteH = await getSetting("session.absoluteTimeoutHours", 12);
  const token = randomBase62(48);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + idleMin * 60_000);
  const absoluteExpiresAt = new Date(now.getTime() + absoluteH * 3_600_000);
  await db.session.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      ip,
      userAgent,
      expiresAt,
      absoluteExpiresAt,
    },
  });
  return { token, expiresAt };
}

export async function validateSessionToken(
  token: string
): Promise<{ user: User; sessionId: string } | null> {
  const row = await db.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: true },
  });
  if (!row || row.revokedAt) return null;
  const now = new Date();
  if (row.expiresAt < now || row.absoluteExpiresAt < now) return null;
  if (row.user.disabled) return null;
  // Sliding idle renewal
  if (now.getTime() - row.lastSeenAt.getTime() > 30_000) {
    const idleMin = await getSetting("session.idleTimeoutMin", 30);
    await db.session.update({
      where: { id: row.id },
      data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + idleMin * 60_000) },
    });
  }
  return { user: row.user, sessionId: row.id };
}

export function setSessionCookie(
  res: NextResponse,
  token: string,
  secure: boolean,
  maxAgeSeconds: number
) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

export async function revokeSessionByToken(token: string) {
  await db.session.updateMany({
    where: { tokenHash: sha256Hex(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId?: string) {
  await db.session.updateMany({
    where: userId ? { userId, revokedAt: null } : { revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
