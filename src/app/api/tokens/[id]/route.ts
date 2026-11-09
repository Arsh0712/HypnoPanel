import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * DELETE /api/tokens/[id] — revoke a token. Users may revoke their own
 * tokens; admins may revoke anyone's.
 */
export const DELETE = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, {});
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;

  const token = await db.apiToken.findUnique({ where: { id } });
  if (!token) throw new ApiError(404, "not_found", "Token not found");

  const isOwner = token.userId === ctx.userId;
  const isAdmin = hasPermission(ctx.role, "users:write");
  if (!isOwner && !isAdmin) {
    throw new ApiError(403, "forbidden", "You can only revoke your own tokens");
  }

  if (!token.revokedAt) {
    await db.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "token.revoke",
      target: token.name,
      sourceIp: ip,
      details: { prefix: token.prefix, owner: isOwner ? "self" : "other" },
    });
  }
  return NextResponse.json({ ok: true });
});
