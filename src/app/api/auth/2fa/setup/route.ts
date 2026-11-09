import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { generateTotpSecret, totpUri } from "@/lib/auth/totp";
import { handle } from "@/lib/api-error";

export const runtime = "nodejs";

/** POST /api/auth/2fa/setup — returns a fresh TOTP secret + QR code (data URL). */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { allowDuringPasswordChange: true });
  const secret = generateTotpSecret();
  const uri = totpUri(secret, ctx.email);
  const QRCode = (await import("qrcode")).default;
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  // secret is returned in clear to be confirmed by the user; it is only
  // persisted (encrypted) after successful verification in /2fa/enable
  return NextResponse.json({ secret, uri, qr: qrDataUrl });
});
