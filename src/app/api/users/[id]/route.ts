import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { randomBase62 } from "@/lib/crypto";
import { ROLES } from "@/lib/constants";
import { audit } from "@/lib/audit";
import { ApiError, handle } from "@/lib/api-error";

export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/users/[id] — two shapes:
 *  { action: 'disable'|'enable'|'reset-password'|'reset-2fa' }
 *  { name?, role? } (profile update; last-admin protection on demotion)
 */
export const PATCH = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "users:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    name?: string;
    role?: string;
  };

  const target = await db.user.findUnique({ where: { id } });
  if (!target) throw new ApiError(404, "not_found", "User not found");

  if (body.action) {
    switch (body.action) {
      case "disable": {
        if (target.id === ctx.userId) {
          throw new ApiError(400, "self_disable", "You cannot disable your own account");
        }
        await db.user.update({ where: { id }, data: { disabled: true } });
        // A disabled account must not keep live sessions
        await db.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await audit({
          actorId: ctx.userId,
          actorEmail: ctx.email,
          action: "user.disable",
          target: target.email,
          sourceIp: ip,
        });
        return NextResponse.json({ ok: true });
      }
      case "enable": {
        await db.user.update({ where: { id }, data: { disabled: false } });
        await audit({
          actorId: ctx.userId,
          actorEmail: ctx.email,
          action: "user.enable",
          target: target.email,
          sourceIp: ip,
        });
        return NextResponse.json({ ok: true });
      }
      case "reset-password": {
        const temporaryPassword = randomBase62(16);
        await db.user.update({
          where: { id },
          data: {
            passwordHash: hashPassword(temporaryPassword),
            mustChangePassword: true,
          },
        });
        await db.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await audit({
          actorId: ctx.userId,
          actorEmail: ctx.email,
          action: "user.reset_password",
          target: target.email,
          sourceIp: ip,
          details: { sessionsRevoked: true },
        });
        // The temporary password is returned exactly once and never audited
        return NextResponse.json({ ok: true, temporaryPassword });
      }
      case "reset-2fa": {
        await db.user.update({
          where: { id },
          data: { totpEnabled: false, totpSecretEnc: null, recoveryCodesJson: null },
        });
        await audit({
          actorId: ctx.userId,
          actorEmail: ctx.email,
          action: "user.2fa_reset",
          target: target.email,
          sourceIp: ip,
        });
        return NextResponse.json({ ok: true });
      }
      default:
        throw new ApiError(
          400,
          "invalid_action",
          "action must be one of: disable, enable, reset-password, reset-2fa"
        );
    }
  }

  // Profile update: { name?, role? }
  const data: { name?: string | null; role?: string } = {};
  if (body.name !== undefined) {
    const name = (body.name || "").trim();
    if (name.length > 64) throw new ApiError(400, "invalid_name", "Name must be at most 64 characters");
    data.name = name || null;
  }
  if (body.role !== undefined) {
    if (!(ROLES as readonly string[]).includes(body.role)) {
      throw new ApiError(400, "invalid_role", `Role must be one of: ${ROLES.join(", ")}`);
    }
    if (body.role !== target.role && target.role === "admin" && body.role !== "admin") {
      const otherAdmins = await db.user.count({
        where: { role: "admin", disabled: false, id: { not: id } },
      });
      if (otherAdmins === 0) {
        throw new ApiError(409, "last_admin", "Cannot demote the last enabled admin");
      }
    }
    data.role = body.role;
  }
  if (Object.keys(data).length === 0) {
    throw new ApiError(400, "nothing_to_update", "Provide a name and/or role to update");
  }

  const updated = await db.user.update({ where: { id }, data });
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "user.update",
    target: updated.email,
    sourceIp: ip,
    details: { name: data.name !== undefined, role: data.role || null },
  });
  return NextResponse.json({
    ok: true,
    user: { id: updated.id, email: updated.email, name: updated.name, role: updated.role },
  });
});

/**
 * DELETE /api/users/[id] — refuse self-deletion and deleting the last admin.
 */
export const DELETE = handle(async (req: NextRequest, routeCtx: RouteCtx) => {
  const ctx = await guard(req, { permission: "users:write" });
  const ip = getClientIp(req);
  const { id } = await routeCtx.params;

  if (id === ctx.userId) {
    throw new ApiError(400, "self_delete", "You cannot delete your own account");
  }
  const target = await db.user.findUnique({ where: { id } });
  if (!target) throw new ApiError(404, "not_found", "User not found");
  if (target.role === "admin") {
    const otherAdmins = await db.user.count({
      where: { role: "admin", disabled: false, id: { not: id } },
    });
    if (otherAdmins === 0) {
      throw new ApiError(409, "last_admin", "Cannot delete the last enabled admin");
    }
  }

  await db.user.delete({ where: { id } }); // sessions + tokens cascade
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "user.delete",
    target: target.email,
    sourceIp: ip,
    details: { role: target.role },
  });
  return NextResponse.json({ ok: true });
});
