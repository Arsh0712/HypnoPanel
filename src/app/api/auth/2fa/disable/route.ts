import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { verifyPassword } from "@/lib/auth/password";
import { verifyTotp, totpObject } from "@/lib/auth/totp";
import { decrypt } from "@/lib/crypto";
import { ApiError, handle } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import { getClientIp } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * POST /api/auth/2fa/disable — { password, token }
 * Requires password AND a valid current TOTP code (or recovery code handled at login).
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, {});
  const body = (await req.json().catch(() => ({}))) as { password?: string; token?: string };
  const user = await db.user.findUnique({ where: { id: ctx.userId } });
  if (!user || !user.totpEnabled || !user.totpSecretEnc) {
    throw new ApiError(400, "not_enabled", "2FA is not enabled");
  }
  if (!verifyPassword(user.passwordHash, body.password || "")) {
    throw new ApiError(401, "invalid_credentials", "Password is incorrect");
  }
  if (!body.token || !verifyTotp(decrypt(user.totpSecretEnc), body.token)) {
    throw new ApiError(401, "invalid_totp", "Invalid 2FA code");
  }
  await db.user.update({
    where: { id: user.id },
    data: { totpEnabled: false, totpSecretEnc: null, recoveryCodesJson: null },
  });
  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: "account.2fa_disabled",
    sourceIp: getClientIp(req),
  });
  return NextResponse.json({ ok: true });
});
