import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { verifyPassword, hashPassword, checkPasswordPolicy } from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/session";
import { ApiError, handle } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import { isValidEmail } from "@/lib/validation";
import { getClientIp } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * POST /api/auth/change-password — { currentPassword, newPassword, newEmail? }
 * Used by the forced first-login flow and by Settings → Account.
 * On success: password re-hashed (Argon2id), mustChangePassword=false,
 * all OTHER sessions revoked, audit entry written.
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { allowDuringPasswordChange: true });
  const body = (await req.json().catch(() => ({}))) as {
    currentPassword?: string;
    newPassword?: string;
    newEmail?: string;
  };

  const user = await db.user.findUnique({ where: { id: ctx.userId } });
  if (!user) throw new ApiError(404, "not_found", "User not found");
  if (!verifyPassword(user.passwordHash, body.currentPassword || "")) {
    throw new ApiError(401, "invalid_credentials", "Current password is incorrect");
  }

  const newEmail = (body.newEmail || user.email).trim().toLowerCase();
  if (newEmail !== user.email) {
    if (!isValidEmail(newEmail)) throw new ApiError(400, "invalid_input", "Invalid email address");
    const clash = await db.user.findUnique({ where: { email: newEmail } });
    if (clash) throw new ApiError(409, "email_taken", "This email is already in use");
  }

  const policy = checkPasswordPolicy(body.newPassword || "", newEmail);
  if (!policy.ok) {
    throw new ApiError(400, "weak_password", policy.errors.join(". ") + ".");
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      email: newEmail,
      passwordHash: hashPassword(body.newPassword!),
      mustChangePassword: false,
    },
  });

  // Revoke every session except the current one
  await db.session.updateMany({
    where: { userId: user.id, revokedAt: null, id: { not: ctx.sessionId } },
    data: { revokedAt: new Date() },
  });

  await audit({
    actorId: user.id,
    actorEmail: newEmail,
    action: "account.password_changed",
    sourceIp: getClientIp(req),
    details: { emailChanged: newEmail !== user.email, forcedFlow: user.mustChangePassword },
  });

  return NextResponse.json({ ok: true, email: newEmail });
});
