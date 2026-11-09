import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { verifyTotp } from "@/lib/auth/totp";
import { encrypt, generateRecoveryCodes, sha256Hex } from "@/lib/crypto";
import { ApiError, handle } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import { getClientIp } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * POST /api/auth/2fa/enable — { secret, token }
 * Verifies the token against the pending secret, enables TOTP and returns
 * recovery codes (shown exactly once; only hashes are stored).
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { allowDuringPasswordChange: true });
  const body = (await req.json().catch(() => ({}))) as { secret?: string; token?: string };
  if (!body.secret || !body.token || !/^[A-Z2-7]+=*$/.test(body.secret)) {
    throw new ApiError(400, "invalid_input", "Secret and 6-digit token are required");
  }
  if (!verifyTotp(body.secret, body.token)) {
    throw new ApiError(400, "invalid_totp", "That code did not match — check your authenticator clock and try again");
  }
  const codes = generateRecoveryCodes(10);
  await db.user.update({
    where: { id: ctx.userId },
    data: {
      totpEnabled: true,
      totpSecretEnc: encrypt(body.secret),
      recoveryCodesJson: JSON.stringify(codes.map((c) => sha256Hex(c))),
    },
  });
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "account.2fa_enabled",
    sourceIp: getClientIp(req),
  });
  return NextResponse.json({ ok: true, recoveryCodes: codes });
});
