import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ key: string }>;
}

/**
 * POST /api/security/checks/[key]/fix — apply a REAL in-panel fix.
 *
 * Only checks with a genuine, safe, in-panel remediation expose a fix.
 * Everything else is intentionally not fixable here: the Security Center
 * shows the exact manual steps instead of a fake "apply" button.
 */
export const POST = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "security:write" });
  const ip = getClientIp(req);
  const { key } = await routeCtx.params;

  if (key === "panel.sessions") {
    // Revoke every session except the caller's current one. API-token callers
    // have no web session, so this revokes all sessions (correct + audited).
    const result = await db.session.updateMany({
      where: { revokedAt: null, id: { not: ctx.sessionId } },
      data: { revokedAt: new Date() },
    });
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "security.check.fix",
      target: key,
      sourceIp: ip,
      details: { revokedSessions: result.count, via: ctx.via },
    });
    return NextResponse.json({
      ok: true,
      key,
      revoked: result.count,
      note:
        result.count === 0
          ? "No other active sessions existed — nothing to revoke."
          : `${result.count} session${result.count === 1 ? "" : "s"} revoked. Signed-out users must authenticate again.`,
    });
  }

  if (key === "panel.lockout") {
    throw new ApiError(
      400,
      "no_fix_available",
      "This check is informational — failed-login counts age out of the one-hour window on their own and there is nothing to reset."
    );
  }

  const known = await db.securityCheck.findUnique({ where: { key } });
  throw new ApiError(
    400,
    "no_automated_fix",
    known
      ? `"${known.title}" has no automated in-panel fix — apply the manual steps shown in the Security Center (they are copyable).`
      : "Unknown check — no automated fix exists."
  );
});
