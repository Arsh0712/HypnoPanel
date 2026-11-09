import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { isValidEmail } from "@/lib/validation";

export const runtime = "nodejs";

const SOURCE_RE = /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?$/i;

/**
 * POST /api/mail/domains/[id]/aliases { source, destination } — add a
 * forwarding rule. source "*" is the catch-all.
 */
export const POST = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await guard(req, { permission: "mail:write" });
  const { id } = await params;
  const domain = await db.mailDomain.findUnique({ where: { id } });
  if (!domain) throw new ApiError(404, "not_found", "Mail domain not found");

  const body = (await req.json().catch(() => ({}))) as { source?: string; destination?: string };

  const source = (body.source || "").trim().toLowerCase();
  if (source !== "*" && !(SOURCE_RE.test(source) && !source.includes(".."))) {
    throw new ApiError(400, "invalid_source", 'Source must be a local part (letters, digits, . _ % + -) or "*" for the catch-all.');
  }

  const destination = (body.destination || "").trim().toLowerCase();
  if (!isValidEmail(destination)) {
    throw new ApiError(400, "invalid_destination", "Destination must be a valid email address.");
  }

  const clash = await db.mailAlias.findUnique({
    where: { domainId_source_destination: { domainId: domain.id, source, destination } },
  });
  if (clash) throw new ApiError(409, "alias_exists", `${source === "*" ? "catch-all" : source}@${domain.domain} → ${destination} already exists.`);

  const created = await db.mailAlias.create({ data: { domainId: domain.id, source, destination } });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "mail.alias.create",
    target: `${source === "*" ? "catch-all" : source}@${domain.domain} → ${destination}`,
    sourceIp: getClientIp(req),
  });

  return NextResponse.json({ alias: created }, { status: 201 });
});
