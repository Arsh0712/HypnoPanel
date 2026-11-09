import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";

export const runtime = "nodejs";

/**
 * GET /api/sessions — all active sessions with user info (users:read).
 */
export const GET = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "users:read" });
  const now = new Date();
  const rows = await db.session.findMany({
    where: { revokedAt: null, expiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
    include: { user: { select: { email: true, name: true } } },
    orderBy: { lastSeenAt: "desc" },
  });
  return NextResponse.json({
    sessions: rows.map((s) => ({
      id: s.id,
      userId: s.userId,
      email: s.user.email,
      name: s.user.name,
      current: s.id === ctx.sessionId,
      ip: s.ip,
      userAgent: (s.userAgent || "").slice(0, 80),
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      absoluteExpiresAt: s.absoluteExpiresAt,
    })),
  });
});

/**
 * PATCH /api/sessions — { sessionId } revokes one session,
 * { all: true, userId? } revokes every active session (optionally scoped to a user).
 */
export const PATCH = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "users:write" });
  const ip = getClientIp(req);
  const body = (await req.json().catch(() => ({}))) as { sessionId?: string; all?: boolean; userId?: string };
  const now = new Date();

  if (body.all === true) {
    const where = body.userId
      ? { userId: body.userId, revokedAt: null }
      : { revokedAt: null };
    const res = await db.session.updateMany({ where, data: { revokedAt: now } });
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "sessions.revoke_all",
      target: body.userId || "all",
      sourceIp: ip,
      details: { count: res.count, scope: body.userId || "all" },
    });
    return NextResponse.json({ ok: true, revoked: res.count });
  }

  if (!body.sessionId) {
    throw new ApiError(400, "invalid_input", "sessionId is required (or pass all: true)");
  }
  const session = await db.session.findUnique({
    where: { id: body.sessionId },
    include: { user: { select: { email: true } } },
  });
  if (!session || session.revokedAt) {
    throw new ApiError(404, "not_found", "Session not found (it may already be revoked)");
  }
  await db.session.update({ where: { id: body.sessionId }, data: { revokedAt: now } });
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "sessions.revoke",
    target: session.id,
    sourceIp: ip,
    details: { ownerEmail: session.user.email, sessionExpiresAt: session.expiresAt.toISOString() },
  });
  return NextResponse.json({ ok: true, revoked: 1 });
});
