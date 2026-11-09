import path from "path";
import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { DATABASES_DIR } from "@/lib/constants";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const MAX_ROWS = 100;
const MAX_RESULT_BYTES = 500 * 1024;
const BUSY_TIMEOUT_MS = 3000;

/** Strip comments + trailing semicolons to inspect the statement head. */
function inspectStatement(sql: string): { head: string; multi: boolean } {
  const stripped = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim()
    .replace(/;+\s*$/, "");
  const multi = /;\s*\S/.test(stripped);
  return { head: stripped, multi };
}

function statementKind(sql: string): "ddl" | "dml" {
  return /^\s*(create|alter|drop|truncate)\b/i.test(sql) ? "ddl" : "dml";
}

/**
 * POST /api/databases/[id]/query { sql, readOnly }
 * Runs a SINGLE statement against the real SQLite file.
 *  - readOnly (default true): only SELECT / PRAGMA, opened with readonly=true
 *  - !readOnly: writes allowed, returns the change count
 * Never logs the SQL body to the audit trail (statement count/type only).
 */
export const POST = handle(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { sql?: string; readOnly?: boolean };
  const sql = (body.sql || "").trim();
  const readOnly = body.readOnly !== false; // safe default: read-only

  if (!sql) throw new ApiError(400, "invalid_input", "Provide a SQL statement");
  if (sql.length > 500_000) throw new ApiError(400, "invalid_input", "Statement is too large (500KB max)");

  // read-only queries need databases:read; write mode needs databases:write
  const auth = await guard(req, { permission: readOnly ? "databases:read" : "databases:write" });

  const row = await db.panelDatabase.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "not_found", "Database not found");
  const filePath = path.join(DATABASES_DIR, row.fileName);

  const { head, multi } = inspectStatement(sql);
  const isReadStatement = /^(select|pragma)\b/i.test(head);

  if (readOnly) {
    if (multi || head.includes(";")) {
      throw new ApiError(
        400,
        "multi_statement",
        "Read-only mode accepts a single SELECT or PRAGMA statement"
      );
    }
    if (!isReadStatement) {
      throw new ApiError(
        400,
        "readonly_rejected",
        "Read-only mode rejects this statement — disable read-only for writes"
      );
    }
  }

  let sqlite: Database.Database;
  try {
    sqlite = new Database(filePath, { readonly: readOnly, timeout: BUSY_TIMEOUT_MS, fileMustExist: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ApiError(400, "open_failed", `Could not open the database: ${msg}`);
  }

  const startedAt = Date.now();
  try {
    const stmt = sqlite.prepare(sql); // better-sqlite3: single statement only

    if (isReadStatement) {
      const columns = stmt.columns().map((c) => c.name);
      let rows: unknown[] = stmt.all();
      let truncated = false;
      if (rows.length > MAX_ROWS) {
        rows = rows.slice(0, MAX_ROWS);
        truncated = true;
      }
      while (rows.length > 0 && JSON.stringify(rows).length > MAX_RESULT_BYTES) {
        rows = rows.slice(0, Math.max(1, Math.floor(rows.length / 2)));
        truncated = true;
      }
      const durationMs = Date.now() - startedAt;
      return NextResponse.json({
        kind: "select",
        columns,
        rows,
        rowCount: rows.length,
        truncated,
        durationMs,
      });
    }

    if (readOnly) {
      // unreachable (guarded above) — belt and braces
      throw new ApiError(400, "readonly_rejected", "Read-only mode rejects this statement");
    }

    const info = stmt.run();
    const durationMs = Date.now() - startedAt;

    // refresh stored size after a write
    try {
      const sizeBytes = sqlite.prepare("PRAGMA page_count").get() as
        | { page_count: number }
        | undefined;
      if (sizeBytes && typeof sizeBytes.page_count === "number") {
        const pageSize = sqlite.prepare("PRAGMA page_size").get() as { page_size: number } | undefined;
        const bytes =
          sizeBytes.page_count * ((pageSize && pageSize.page_size) || 4096);
        await db.panelDatabase.update({ where: { id }, data: { sizeBytes: bytes } });
      }
    } catch {
      /* size refresh is best-effort */
    }

    // Audit WRITE mode only — never the SQL body, just statement count/type
    await audit({
      actorId: auth.userId,
      actorEmail: auth.email,
      action: "database.write",
      target: row.name,
      sourceIp: getClientIp(req),
      details: { statements: 1, kind: statementKind(sql) },
    });

    return NextResponse.json({
      kind: "write",
      changes: info.changes,
      lastInsertRowid: String(info.lastInsertRowid),
      durationMs,
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ApiError(400, "sqlite_error", msg.replace(/\s+/g, " ").slice(0, 300));
  } finally {
    try {
      sqlite.close();
    } catch {
      /* already closed */
    }
  }
});
