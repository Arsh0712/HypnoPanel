import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { buildAuditWhere } from "./_filter";

export const runtime = "nodejs";

/**
 * GET /api/audit?page=1&pageSize=50&action=&actor=&result=&source=&from=&to=
 * Server-side filtering, newest seq first, with the total count for pagination.
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "audit:read" });
  const url = new URL(req.url);

  let page = Number(url.searchParams.get("page") || 1);
  let pageSize = Number(url.searchParams.get("pageSize") || 50);
  if (!Number.isInteger(page) || page < 1) page = 1;
  if (!Number.isInteger(pageSize) || pageSize < 1) pageSize = 50;
  if (pageSize > 200) pageSize = 200;

  const { where, error } = buildAuditWhere({
    action: url.searchParams.get("action") || undefined,
    actor: url.searchParams.get("actor") || undefined,
    result: url.searchParams.get("result") || undefined,
    source: url.searchParams.get("source") || undefined,
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
  });
  if (error) throw new ApiError(400, "invalid_filter", error);

  const [total, entries] = await Promise.all([
    db.auditEntry.count({ where }),
    db.auditEntry.findMany({
      where,
      orderBy: { seq: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    entries: entries.map((e) => ({
      seq: e.seq,
      ts: e.ts,
      actorEmail: e.actorEmail,
      action: e.action,
      target: e.target,
      source: e.source,
      sourceIp: e.sourceIp,
      result: e.result,
      details: e.details,
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  });
});
