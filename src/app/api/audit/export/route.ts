import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { buildAuditWhere, csvField } from "../_filter";

export const runtime = "nodejs";

/**
 * GET /api/audit/export?format=csv|json (same filters as /api/audit)
 * Streams the full filtered log as an attachment.
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "audit:read" });
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "json" ? "json" : "csv";

  const { where, error } = buildAuditWhere({
    action: url.searchParams.get("action") || undefined,
    actor: url.searchParams.get("actor") || undefined,
    result: url.searchParams.get("result") || undefined,
    source: url.searchParams.get("source") || undefined,
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
  });
  if (error) throw new ApiError(400, "invalid_filter", error);

  const entries = await db.auditEntry.findMany({ where, orderBy: { seq: "desc" } });
  const date = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    const payload = entries.map((e) => ({
      seq: e.seq,
      ts: e.ts.toISOString(),
      actor: e.actorEmail,
      action: e.action,
      target: e.target,
      source: e.source,
      sourceIp: e.sourceIp,
      result: e.result,
      details: e.details ? safeJson(e.details) : null,
      prevHash: e.prevHash,
      hash: e.hash,
    }));
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="hipnotype-audit-${date}.json"`,
      },
    });
  }

  const header = "seq,ts,actor,action,target,source,sourceIp,result,details";
  const lines = entries.map((e) =>
    [
      e.seq,
      e.ts.toISOString(),
      e.actorEmail || "",
      e.action,
      e.target || "",
      e.source,
      e.sourceIp || "",
      e.result,
      e.details || "",
    ]
      .map(csvField)
      .join(",")
  );
  return new NextResponse([header, ...lines].join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="hipnotype-audit-${date}.csv"`,
    },
  });
});

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
