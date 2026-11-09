import { NextRequest, NextResponse } from "next/server";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { normalizeDomain } from "@/lib/dns-verify";
import { domainToRow } from "../_lib/serialize";

export const runtime = "nodejs";

const SELECTOR_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** GET /api/mail/domains — every mail domain with its mailboxes and aliases. */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "mail:read" });
  const domains = await db.mailDomain.findMany({
    orderBy: { domain: "asc" },
    include: { mailboxes: { orderBy: { localPart: "asc" } }, aliases: { orderBy: { source: "asc" } } },
  });
  return NextResponse.json({ domains: domains.map(domainToRow) });
});

/**
 * POST /api/mail/domains { domain, dkimSelector? } — register a mail domain
 * the user owns so mailboxes, aliases and DKIM can be managed for it.
 */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "mail:write" });
  const body = (await req.json().catch(() => ({}))) as { domain?: string; dkimSelector?: string };

  const norm = normalizeDomain(body.domain || "");
  if (!norm.ok || !norm.domain) {
    throw new ApiError(400, "invalid_domain", norm.error || "Enter a valid domain, e.g. example.com");
  }

  let selector = "mail";
  if (body.dkimSelector !== undefined && body.dkimSelector !== "") {
    selector = body.dkimSelector.trim().toLowerCase();
    if (!SELECTOR_RE.test(selector)) {
      throw new ApiError(400, "invalid_selector", "DKIM selector: letters, digits and hyphens, max 32 chars, must start with a letter or digit.");
    }
  }

  const existing = await db.mailDomain.findUnique({ where: { domain: norm.domain } });
  if (existing) throw new ApiError(409, "domain_exists", `${norm.domain} is already a mail domain.`);

  const created = await db.mailDomain.create({
    data: { domain: norm.domain, dkimSelector: selector },
    include: { mailboxes: true, aliases: true },
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "mail.domain.create",
    target: norm.domain,
    sourceIp: getClientIp(req),
    details: { dkimSelector: selector },
  });

  return NextResponse.json({ domain: domainToRow(created) }, { status: 201 });
});
