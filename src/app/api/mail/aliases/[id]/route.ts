import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";

export const runtime = "nodejs";

/** DELETE /api/mail/aliases/[id] — remove a forwarding rule. */
export const DELETE = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await guard(req, { permission: "mail:write" });
  const { id } = await params;
  const alias = await db.mailAlias.findUnique({ where: { id }, include: { domain: true } });
  if (!alias) throw new ApiError(404, "not_found", "Alias not found");

  await db.mailAlias.delete({ where: { id } });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "mail.alias.delete",
    target: `${alias.source === "*" ? "catch-all" : alias.source}@${alias.domain.domain} → ${alias.destination}`,
    sourceIp: getClientIp(req),
  });

  return NextResponse.json({ ok: true });
});
