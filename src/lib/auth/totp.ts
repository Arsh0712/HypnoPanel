import * as OTPAuth from "otpauth";

/** TOTP (RFC 6238) helpers via the otpauth library. */

export function generateTotpSecret(): string {
  // 20 random bytes → base32 (RFC 4648, unpadded — the standard TOTP encoding)
  const buf = new ArrayBuffer(20);
  crypto.getRandomValues(new Uint8Array(buf));
  const secret = new OTPAuth.Secret({ buffer: buf });
  return secret.base32.replace(/=+$/, "");
}

export function totpObject(secret: string, email: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: "HipnoType Panel",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

export function totpUri(secret: string, email: string): string {
  return totpObject(secret, email).toString();
}

/** Verify a 6-digit code with ±1 step window. */
export function verifyTotp(secret: string, token: string): boolean {
  const totp = totpObject(secret, "user");
  const delta = totp.validate({ token, window: 1 });
  return delta !== null;
}
