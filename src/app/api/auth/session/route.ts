import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticate } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/** GET /api/auth/session — current authentication state. */
export const GET = handle(async (_req: NextRequest) => {
  const ctx = await authenticate(_req);
  if (!ctx) return NextResponse.json({ authenticated: false });
  const session = await db.session.findUnique({ where: { id: ctx.sessionId } });
  return NextResponse.json({
    authenticated: true,
    user: {
      id: ctx.userId,
      email: ctx.email,
      name: ctx.name,
      role: ctx.role,
      mustChangePassword: ctx.mustChangePassword,
      totpEnabled: ctx.totpEnabled,
      via: ctx.via,
    },
    session: session
      ? {
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          absoluteExpiresAt: session.absoluteExpiresAt,
        }
      : null,
  });
});
