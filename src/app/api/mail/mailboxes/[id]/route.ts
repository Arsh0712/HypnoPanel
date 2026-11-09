import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { encrypt, randomBase62 } from "@/lib/crypto";
import { mailboxToRow } from "../../_lib/serialize";

export const runtime = "nodejs";

/**
 * PATCH /api/mail/mailboxes/[id] — update quota / rate limit / enabled, or
 * { action: "reset-password" } which generates a new strong password
 * (returned exactly once, stored encrypted).
 */
export const PATCH = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await guard(req, { permission: "mail:write" });
  const { id } = await params;
  const mailbox = await db.mailbox.findUnique({ where: { id }, include: { domain: true } });
  if (!mailbox) throw new ApiError(404, "not_found", "Mailbox not found");
  const address = `${mailbox.localPart}@${mailbox.domain.domain}`;

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    enabled?: boolean;
    quotaMb?: number;
    ratePerHour?: number;
  };

  if (body.action === "reset-password") {
    const password = randomBase62(16);
    const updated = await db.mailbox.update({ where: { id }, data: { passwordEnc: encrypt(password) } });
    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "mail.mailbox.reset_password",
      target: address,
      sourceIp: getClientIp(req),
    });
    return NextResponse.json({ mailbox: mailboxToRow(updated), password });
  }

  if (body.action) {
    throw new ApiError(400, "invalid_action", `Unknown action “${body.action}”.`);
  }

  const data: { enabled?: boolean; quotaMb?: number; ratePerHour?: number } = {};
  if (body.enabled !== undefined) data.enabled = !!body.enabled;
  if (body.quotaMb !== undefined) {
    if (!Number.isInteger(body.quotaMb) || body.quotaMb < 16 || body.quotaMb > 1_048_576) {
      throw new ApiError(400, "invalid_quota", "Quota must be an integer between 16 and 1048576 MB.");
    }
    data.quotaMb = body.quotaMb;
  }
  if (body.ratePerHour !== undefined) {
    if (!Number.isInteger(body.ratePerHour) || body.ratePerHour < 1 || body.ratePerHour > 10_000) {
      throw new ApiError(400, "invalid_rate", "Rate limit must be an integer between 1 and 10000 messages/hour.");
    }
    data.ratePerHour = body.ratePerHour;
  }
  if (Object.keys(data).length === 0) {
    throw new ApiError(400, "invalid_input", "Nothing to update.");
  }

  const updated = await db.mailbox.update({ where: { id }, data });
  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "mail.mailbox.update",
    target: address,
    sourceIp: getClientIp(req),
    details: { changed: Object.keys(data) },
  });

  return NextResponse.json({ mailbox: mailboxToRow(updated) });
});

/** DELETE /api/mail/mailboxes/[id] */
export const DELETE = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await guard(req, { permission: "mail:write" });
  const { id } = await params;
  const mailbox = await db.mailbox.findUnique({ where: { id }, include: { domain: true } });
  if (!mailbox) throw new ApiError(404, "not_found", "Mailbox not found");

  await db.mailbox.delete({ where: { id } });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "mail.mailbox.delete",
    target: `${mailbox.localPart}@${mailbox.domain.domain}`,
    sourceIp: getClientIp(req),
  });

  return NextResponse.json({ ok: true });
});
