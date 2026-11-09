import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { randomBase62 } from "@/lib/crypto";
import { ROLES } from "@/lib/constants";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";
import { isValidEmail } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * GET /api/users — list panel users with active session/token counts (users:read).
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "users:read" });
  const now = new Date();
  const [users, activeSessions, activeTokens] = await Promise.all([
    db.user.findMany({ orderBy: { createdAt: "asc" } }),
    db.session.groupBy({
      by: ["userId"],
      where: { revokedAt: null, expiresAt: { gt: now } },
      _count: { _all: true },
    }),
    db.apiToken.groupBy({
      by: ["userId"],
      where: { revokedAt: null },
      _count: { _all: true },
    }),
  ]);
  const sessionCounts = new Map(activeSessions.map((s) => [s.userId, s._count._all]));
  const tokenCounts = new Map(activeTokens.map((t) => [t.userId, t._count._all]));
  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      disabled: u.disabled,
      totpEnabled: u.totpEnabled,
      mustChangePassword: u.mustChangePassword,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      sessionCount: sessionCounts.get(u.id) || 0,
      tokenCount: tokenCounts.get(u.id) || 0,
    })),
  });
});

/**
 * POST /api/users — invite a user { email, name?, role }.
 * A temporary password is generated, returned ONCE, and must be changed at
 * first login (mustChangePassword). The password is never written to the audit log.
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "users:write" });
  const ip = getClientIp(req);
  const body = (await req.json().catch(() => ({}))) as { email?: string; name?: string; role?: string };

  const email = (body.email || "").trim().toLowerCase();
  const name = (body.name || "").trim() || null;
  const role = body.role || "viewer";

  if (!isValidEmail(email)) {
    throw new ApiError(400, "invalid_email", "A valid email address is required");
  }
  if (name && name.length > 64) {
    throw new ApiError(400, "invalid_name", "Name must be at most 64 characters");
  }
  if (!(ROLES as readonly string[]).includes(role)) {
    throw new ApiError(400, "invalid_role", `Role must be one of: ${ROLES.join(", ")}`);
  }
  const clash = await db.user.findUnique({ where: { email } });
  if (clash) {
    throw new ApiError(409, "email_taken", "A user with this email already exists");
  }

  const temporaryPassword = randomBase62(16);
  const user = await db.user.create({
    data: {
      email,
      name,
      role,
      passwordHash: hashPassword(temporaryPassword),
      mustChangePassword: true,
    },
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "user.create",
    target: email,
    sourceIp: ip,
    details: { role },
  });

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      disabled: user.disabled,
      totpEnabled: user.totpEnabled,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      sessionCount: 0,
      tokenCount: 0,
    },
    temporaryPassword,
  });
});
