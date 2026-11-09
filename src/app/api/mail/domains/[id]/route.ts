import { generateKeyPairSync } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { isValidEmail } from "@/lib/validation";
import { encrypt } from "@/lib/crypto";
import { domainToRow } from "../../_lib/serialize";

export const runtime = "nodejs";

const DMARC_POLICIES = ["none", "quarantine", "reject"];
const SELECTOR_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** GET /api/mail/domains/[id] — one mail domain incl. mailboxes + aliases. */
export const GET = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await guard(req, { permission: "mail:read" });
  const { id } = await params;
  const domain = await db.mailDomain.findUnique({
    where: { id },
    include: { mailboxes: { orderBy: { localPart: "asc" } }, aliases: { orderBy: { source: "asc" } } },
  });
  if (!domain) throw new ApiError(404, "not_found", "Mail domain not found");
  return NextResponse.json({ domain: domainToRow(domain) });
});

/**
 * PATCH /api/mail/domains/[id] — update settings (enabled, catchAll,
 * dmarcPolicy, mtaSts, dkimSelector) or { action: "generate-dkim" } to
 * generate a REAL 2048-bit RSA keypair: private key encrypted at rest,
 * public key returned as the DKIM TXT value.
 */
export const PATCH = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await guard(req, { permission: "mail:write" });
  const { id } = await params;
  const domain = await db.mailDomain.findUnique({ where: { id } });
  if (!domain) throw new ApiError(404, "not_found", "Mail domain not found");

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    enabled?: boolean;
    catchAll?: string | null;
    dmarcPolicy?: string;
    mtaSts?: boolean;
    dkimSelector?: string;
  };

  if (body.action === "generate-dkim") {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const dkimPublic = Buffer.isBuffer(publicKey) ? publicKey.toString("base64") : String(publicKey);
    const dkimPrivatePem = Buffer.isBuffer(privateKey) ? privateKey.toString("utf8") : String(privateKey);

    const updated = await db.mailDomain.update({
      where: { id },
      data: { dkimPublic, dkimPrivateEnc: encrypt(dkimPrivatePem) },
      include: { mailboxes: true, aliases: true },
    });

    await audit({
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: "mail.domain.dkim_generate",
      target: domain.domain,
      sourceIp: getClientIp(req),
      details: { selector: updated.dkimSelector, keyBits: 2048 },
    });

    return NextResponse.json({ domain: domainToRow(updated) });
  }

  if (body.action) {
    throw new ApiError(400, "invalid_action", `Unknown action “${body.action}”.`);
  }

  const data: {
    enabled?: boolean;
    catchAll?: string | null;
    dmarcPolicy?: string;
    mtaSts?: boolean;
    dkimSelector?: string;
  } = {};

  if (body.enabled !== undefined) data.enabled = !!body.enabled;
  if (body.catchAll !== undefined) {
    if (body.catchAll === null || body.catchAll === "") {
      data.catchAll = null;
    } else {
      const dest = body.catchAll.trim().toLowerCase();
      if (!isValidEmail(dest)) throw new ApiError(400, "invalid_catch_all", "Catch-all destination must be a valid email address.");
      data.catchAll = dest;
    }
  }
  if (body.dmarcPolicy !== undefined) {
    if (!DMARC_POLICIES.includes(body.dmarcPolicy)) {
      throw new ApiError(400, "invalid_dmarc", `DMARC policy must be one of: ${DMARC_POLICIES.join(", ")}.`);
    }
    data.dmarcPolicy = body.dmarcPolicy;
  }
  if (body.mtaSts !== undefined) data.mtaSts = !!body.mtaSts;
  if (body.dkimSelector !== undefined) {
    const sel = body.dkimSelector.trim().toLowerCase();
    if (!SELECTOR_RE.test(sel)) {
      throw new ApiError(400, "invalid_selector", "DKIM selector: letters, digits and hyphens, max 32 chars, must start with a letter or digit.");
    }
    data.dkimSelector = sel;
  }

  if (Object.keys(data).length === 0) {
    throw new ApiError(400, "invalid_input", "Nothing to update.");
  }

  const updated = await db.mailDomain.update({
    where: { id },
    data,
    include: { mailboxes: true, aliases: true },
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "mail.domain.update",
    target: domain.domain,
    sourceIp: getClientIp(req),
    details: { changed: Object.keys(data) },
  });

  return NextResponse.json({ domain: domainToRow(updated) });
});

/** DELETE /api/mail/domains/[id] — removes the domain and (cascade) mailboxes + aliases. */
export const DELETE = handle(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await guard(req, { permission: "mail:write" });
  const { id } = await params;
  const domain = await db.mailDomain.findUnique({
    where: { id },
    include: { mailboxes: { select: { id: true } }, aliases: { select: { id: true } } },
  });
  if (!domain) throw new ApiError(404, "not_found", "Mail domain not found");

  await db.mailDomain.delete({ where: { id } });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "mail.domain.delete",
    target: domain.domain,
    sourceIp: getClientIp(req),
    details: { mailboxesRemoved: domain.mailboxes.length, aliasesRemoved: domain.aliases.length },
  });

  return NextResponse.json({ ok: true });
});
