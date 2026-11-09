import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticate } from "@/lib/auth/guard";
import { clearSessionCookie } from "@/lib/auth/session";
import { sha256Hex } from "@/lib/crypto";
import { handle } from "@/lib/api-error";
import { audit } from "@/lib/audit";
import { getClientIp } from "@/lib/auth/session";

export const runtime = "nodejs";

/** POST /api/auth/logout — revokes the current session. */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await authenticate(req);
  if (ctx?.via === "cookie") {
    const cookieHeader = req.headers.get("cookie") || "";
    const m = cookieHeader.match(/(?:^|;\s*)hipno_session=([^;]+)/);
    if (m) {
      await db.session.updateMany({
        where: { tokenHash: sha256Hex(decodeURIComponent(m[1])), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "logout",
      sourceIp: getClientIp(req),
    });
  }
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
});
