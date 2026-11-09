import type { Prisma } from "@prisma/client";

/**
 * Shared audit-log query filter (used by /api/audit and /api/audit/export).
 * action/actor are substring matches (case-insensitive on SQLite ASCII LIKE);
 * result/source are exact; from/to bound the ts range (inclusive).
 */

export interface AuditFilterParams {
  action?: string;
  actor?: string;
  result?: string;
  source?: string;
  from?: string;
  to?: string;
}

/** Parse a date filter: ISO strings pass through; YYYY-MM-DD is local-time. */
function parseDate(v: string, endOfDay = false): Date | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(d.getTime())) return null;
    if (endOfDay) d.setHours(23, 59, 59, 999);
    return d;
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function buildAuditWhere(
  params: AuditFilterParams
): { where: Prisma.AuditEntryWhereInput; error?: string } {
  const where: Prisma.AuditEntryWhereInput = {};
  const action = (params.action || "").trim();
  const actor = (params.actor || "").trim();
  const result = (params.result || "").trim();
  const source = (params.source || "").trim();

  if (action) where.action = { contains: action };
  if (actor) where.actorEmail = { contains: actor };
  if (result === "success" || result === "failure") where.result = result;
  if (source === "web" || source === "local-cli" || source === "system") where.source = source;

  if (params.from) {
    const from = parseDate(params.from);
    if (!from) return { where, error: "Invalid 'from' date" };
    where.ts = { ...(where.ts as Prisma.DateTimeFilter | undefined), gte: from };
  }
  if (params.to) {
    const to = parseDate(params.to, true);
    if (!to) return { where, error: "Invalid 'to' date" };
    where.ts = { ...(where.ts as Prisma.DateTimeFilter | undefined), lte: to };
  }
  return { where };
}

/** RFC 4180 CSV field escaping. */
export function csvField(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
