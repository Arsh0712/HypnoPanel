import path from "path";
import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { guard } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { DATABASES_DIR } from "@/lib/constants";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const MAX_DUMP_BYTES = 50 * 1024 * 1024;

/** SQL literal quoting for the dump. */
function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return v.toString();
  if (Buffer.isBuffer(v)) return `X'${v.toString("hex")}'`;
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * GET /api/databases/[id]/export — generate a real .sql dump:
 * schema from sqlite_master + INSERTs for every table (50MB cap),
 * served as a download via Content-Disposition.
 */
export const GET = handle(async (req: NextRequest, ctx: Ctx) => {
  await guard(req, { permission: "databases:read" });
  const { id } = await ctx.params;
  const row = await db.panelDatabase.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "not_found", "Database not found");

  const filePath = path.join(DATABASES_DIR, row.fileName);
  let sqlite: Database.Database;
  try {
    sqlite = new Database(filePath, { readonly: true, timeout: 3000, fileMustExist: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ApiError(400, "open_failed", `Could not open the database: ${msg}`);
  }

  try {
    const out: string[] = [];
    out.push(`-- HipnoType Panel SQL dump — database: ${row.name}`);
    out.push(`-- Generated: ${new Date().toISOString()}`);
    out.push(`PRAGMA foreign_keys=OFF;`);
    out.push(`BEGIN TRANSACTION;`);
    let bytes = out.join("\n").length;

    const objects = sqlite
      .prepare(
        `SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC, name`
      )
      .all() as { type: string; name: string; sql: string }[];

    for (const obj of objects) {
      if (obj.type === "table") continue; // tables handled below (schema first)
      out.push(`${obj.sql};`);
      bytes += obj.sql.length + 2;
    }

    for (const obj of objects) {
      if (obj.type !== "table") continue;
      out.push(`${obj.sql};`);
      bytes += obj.sql.length + 2;

      const select = sqlite.prepare(`SELECT * FROM "${obj.name.replace(/"/g, '""')}"`);
      const cols = select.columns().map((c) => `"${c.name.replace(/"/g, '""')}"`).join(", ");
      for (const rec of select.iterate() as IterableIterator<Record<string, unknown>>) {
        const values = Object.values(rec).map(sqlLiteral).join(", ");
        const line = `INSERT INTO "${obj.name.replace(/"/g, '""')}" (${cols}) VALUES (${values});`;
        out.push(line);
        bytes += line.length;
        if (bytes > MAX_DUMP_BYTES) {
          out.push(`-- dump truncated at 50MB by HipnoType Panel`);
          return finalize(out, row.name, true);
        }
      }
    }

    out.push(`COMMIT;`);
    return finalize(out, row.name, false);
  } finally {
    try {
      sqlite.close();
    } catch {
      /* already closed */
    }
  }
});

function finalize(out: string[], name: string, truncated: boolean): NextResponse {
  const body = out.join("\n") + "\n";
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/sql; charset=utf-8",
      "content-disposition": `attachment; filename="${name}.sql"`,
      "x-dump-truncated": truncated ? "true" : "false",
    },
  });
}
