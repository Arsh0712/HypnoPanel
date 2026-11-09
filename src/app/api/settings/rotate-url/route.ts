import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { verifyPassword } from "@/lib/auth/password";
import { verifyTotp } from "@/lib/auth/totp";
import { decrypt, generateAccessToken } from "@/lib/crypto";
import { validateCustomSlug } from "@/lib/validation";
import { rotateAccessToken } from "@/lib/tunnel-client";
import { ApiError, handle } from "@/lib/api-error";

export const runtime = "nodejs";

/**
 * POST /api/settings/rotate-url — { password, totp?, custom? }
 * Two-phase rotation (spec §4.4): relay confirms first, then the panel commits.
 * Requires admin + access:rotate permission, password re-auth (+ TOTP when enabled).
 * All sessions (including this one) are revoked on success.
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "access:rotate" });
  const body = (await req.json().catch(() => ({}))) as {
    password?: string;
    totp?: string;
    custom?: string;
  };

  const user = await db.user.findUnique({ where: { id: ctx.userId } });
  if (!user) throw new ApiError(404, "not_found", "User not found");
  if (!verifyPassword(user.passwordHash, body.password || "")) {
    throw new ApiError(401, "invalid_credentials", "Password is incorrect");
  }
  if (user.totpEnabled && user.totpSecretEnc) {
    if (!body.totp || !verifyTotp(decrypt(user.totpSecretEnc), body.totp)) {
      throw new ApiError(401, "invalid_totp", "2FA code required for this action");
    }
  }

  let newToken: string;
  if (body.custom) {
    const v = validateCustomSlug(body.custom);
    if (!v.ok) throw new ApiError(400, "invalid_slug", v.reason || "Invalid custom slug");
    newToken = body.custom;
    // local collision check
    const clash = await db.accessToken.findFirst({
      where: { token: newToken, revokedAt: null },
    });
    if (clash) throw new ApiError(409, "unavailable", "That path is unavailable");
  } else {
    newToken = generateAccessToken();
  }

  const result = await rotateAccessToken(newToken, { id: ctx.userId, email: ctx.email });
  if (!result.ok) throw new ApiError(502, "rotate_failed", result.error || "Rotation failed");
  return NextResponse.json({
    ok: true,
    token: newToken,
    url: result.url,
    note: "All sessions were revoked — sign in again with the new URL.",
  });
});
