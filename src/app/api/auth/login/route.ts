import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { verifyTotp } from "@/lib/auth/totp";
import { decrypt, sha256Hex, timingSafeEqualStr } from "@/lib/crypto";
import { createSession, getClientIp, isSecureRequest, setSessionCookie, verifySameOrigin } from "@/lib/auth/session";
import { getLockStatus, recordFailure, recordSuccess } from "@/lib/auth/lockout";
import { ApiError, handle } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import { isValidEmail } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * POST /api/auth/login — { email, password, totp?, recoveryCode? }
 * Lockout: 5 failures → 1, 5, 15 minutes (per-account and per-IP).
 * Generic error messages; no user enumeration.
 */
export const POST = handle(async (req: NextRequest) => {
  if (!verifySameOrigin(req)) {
    throw new ApiError(403, "csrf", "Cross-origin request rejected");
  }
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    totp?: string;
    recoveryCode?: string;
  };
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const ip = getClientIp(req);

  if (!isValidEmail(email) || !password) {
    throw new ApiError(400, "invalid_input", "Email and password are required");
  }

  // Lockout gates (checked before touching the DB)
  const accountLock = getLockStatus(`acct:${email}`);
  const ipLock = getLockStatus(`ip:${ip}`);
  if (accountLock.locked || ipLock.locked) {
    const secs = Math.max(accountLock.secondsRemaining, ipLock.secondsRemaining);
    throw new ApiError(
      429,
      "locked",
      `Too many failed attempts. Try again in ${Math.ceil(secs / 60)} minute(s).`
    );
  }

  const user = await db.user.findUnique({ where: { email } });

  const failGeneric = async () => {
    recordFailure(`acct:${email}`);
    recordFailure(`ip:${ip}`);
    await db.loginAttempt.create({ data: { email, ip, success: false } });
    await audit({
      actorEmail: email,
      action: "login.failed",
      sourceIp: ip,
      result: "failure",
    });
  };

  if (!user || user.disabled || !verifyPassword(user.passwordHash, password)) {
    await failGeneric();
    throw new ApiError(401, "invalid_credentials", "Invalid email or password");
  }

  // 2FA
  if (user.totpEnabled && user.totpSecretEnc) {
    const secret = decrypt(user.totpSecretEnc);
    let secondOk = false;
    let usedRecoveryIdx = -1;
    if (body.totp && /^\d{6}$/.test(body.totp)) {
      secondOk = verifyTotp(secret, body.totp);
    } else if (body.recoveryCode) {
      const hashes: string[] = user.recoveryCodesJson ? JSON.parse(user.recoveryCodesJson) : [];
      const provided = sha256Hex(body.recoveryCode.trim().toUpperCase());
      usedRecoveryIdx = hashes.findIndex((h) => timingSafeEqualStr(h, provided));
      secondOk = usedRecoveryIdx !== -1;
    }
    if (!secondOk) {
      await failGeneric();
      // Valid password + missing/invalid second factor → ask for it (no lockout count for mere absence)
      return NextResponse.json(
        { twoFactorRequired: true, error: "Two-factor code required", code: "totp_required" },
        { status: 401 }
      );
    }
    if (usedRecoveryIdx !== -1) {
      // single-use recovery code
      const hashes: string[] = JSON.parse(user.recoveryCodesJson!);
      hashes.splice(usedRecoveryIdx, 1);
      await db.user.update({
        where: { id: user.id },
        data: { recoveryCodesJson: JSON.stringify(hashes) },
      });
      await audit({
        actorEmail: email,
        action: "login.recovery_code_used",
        sourceIp: ip,
        details: { remaining: hashes.length },
      });
    }
  }

  recordSuccess(`acct:${email}`);
  recordSuccess(`ip:${ip}`);
  await db.loginAttempt.create({ data: { email, ip, success: true } });
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const { token, expiresAt } = await createSession(user.id, ip, req.headers.get("user-agent"));
  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: "login.success",
    sourceIp: ip,
    details: { userAgent: (req.headers.get("user-agent") || "").slice(0, 120) },
  });

  const res = NextResponse.json({
    ok: true,
    user: {
      email: user.email,
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      totpEnabled: user.totpEnabled,
    },
  });
  setSessionCookie(
    res,
    token,
    isSecureRequest(req),
    Math.floor((expiresAt.getTime() - Date.now()) / 1000)
  );
  return res;
});
