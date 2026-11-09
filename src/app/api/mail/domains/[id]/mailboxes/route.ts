import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { encrypt, randomBase62 } from "@/lib/crypto";
import { mailboxToRow } from "../../../_lib/serialize";

export const runtime = "nodejs";

const LOCAL_PART_RE = /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?$/i;

/**
 * POST /api/mail/domains/[id]/mailboxes { localPart, quotaMb, ratePerHour } —
 * create a mailbox with a server-generated strong password (randomBase62(16)),
 * stored AES-256-GCM encrypted and returned exactly ONCE in this response.
 */
export const POST = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await guard(req, { permission: "mail:write" });
  const { id } = await params;
  const domain = await db.mailDomain.findUnique({ where: { id } });
  if (!domain) throw new ApiError(404, "not_found", "Mail domain not found");

  const body = (await req.json().catch(() => ({}))) as {
    localPart?: string;
    quotaMb?: number;
    ratePerHour?: number;
  };

  const localPart = (body.localPart || "").trim().toLowerCase();
  if (!LOCAL_PART_RE.test(localPart) || localPart.includes("..")) {
    throw new ApiError(400, "invalid_local_part", "Local part: letters, digits and . _ % + - (no leading/trailing dot, max 64 chars).");
  }

  const quotaMb = Number(body.quotaMb ?? 1024);
  if (!Number.isInteger(quotaMb) || quotaMb < 16 || quotaMb > 1_048_576) {
    throw new ApiError(400, "invalid_quota", "Quota must be an integer between 16 and 1048576 MB.");
  }
  const ratePerHour = Number(body.ratePerHour ?? 100);
  if (!Number.isInteger(ratePerHour) || ratePerHour < 1 || ratePerHour > 10_000) {
    throw new ApiError(400, "invalid_rate", "Rate limit must be an integer between 1 and 10000 messages/hour.");
  }

  const clash = await db.mailbox.findUnique({ where: { domainId_localPart: { domainId: domain.id, localPart } } });
  if (clash) throw new ApiError(409, "mailbox_exists", `${localPart}@${domain.domain} already exists.`);

  const password = randomBase62(16);
  const created = await db.mailbox.create({
    data: {
      domainId: domain.id,
      localPart,
      passwordEnc: encrypt(password),
      quotaMb,
      ratePerHour,
    },
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "mail.mailbox.create",
    target: `${localPart}@${domain.domain}`,
    sourceIp: getClientIp(req),
    details: { quotaMb, ratePerHour },
  });

  return NextResponse.json({ mailbox: mailboxToRow(created), password }, { status: 201 });
});
