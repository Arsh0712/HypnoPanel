import fs from "fs";
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

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/**
 * POST /api/databases/[id]/import — multipart form, field "file" (.sql ≤ 20MB).
 * Executes the dump inside a transaction (unless the dump carries its own
 * BEGIN/COMMIT, in which case it is executed verbatim).
 */
export const POST = handle(async (req: NextRequest, ctx: Ctx) => {
  const auth = await guard(req, { permission: "databases:write" });
  const { id } = await ctx.params;
  const row = await db.panelDatabase.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "not_found", "Database not found");

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    throw new ApiError(400, "invalid_input", "Expected a multipart/form-data upload with a 'file' field");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, "invalid_input", "Could not read the multipart upload");
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new ApiError(400, "invalid_input", "Missing 'file' field in the upload");
  }
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ApiError(400, "too_large", "Import file exceeds the 20MB limit");
  }
  if (!/\.sql$/i.test(file.name || "")) {
    throw new ApiError(400, "invalid_input", "Only .sql files can be imported");
  }

  const content = await file.text();
  if (!content.trim()) {
    throw new ApiError(400, "invalid_input", "The uploaded .sql file is empty");
  }

  const filePath = path.join(DATABASES_DIR, row.fileName);
  let sqlite: Database.Database;
  try {
    sqlite = new Database(filePath, { timeout: 3000, fileMustExist: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ApiError(400, "open_failed", `Could not open the database: ${msg}`);
  }

  try {
    const hasOwnTransaction = /begin\s+transaction/i.test(content) && /(^|[^a-z])commit\s*;/i.test(content);
    try {
      if (hasOwnTransaction) {
        sqlite.exec(content); // dump manages its own transaction
      } else {
        sqlite.exec("BEGIN");
        sqlite.exec(content);
        sqlite.exec("COMMIT");
      }
    } catch (err) {
      try {
        if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
      } catch {
        /* nothing to roll back */
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new ApiError(400, "sqlite_error", `Import failed: ${msg.replace(/\s+/g, " ").slice(0, 300)}`);
    }

    // refresh stored size
    try {
      const sizeBytes = fs.statSync(filePath).size;
      await db.panelDatabase.update({ where: { id }, data: { sizeBytes } });
    } catch {
      /* best effort */
    }

    await audit({
      actorId: auth.userId,
      actorEmail: auth.email,
      action: "database.import",
      target: row.name,
      sourceIp: getClientIp(req),
      details: { fileName: file.name, bytes: file.size },
    });

    return NextResponse.json({ ok: true, importedBytes: file.size });
  } finally {
    try {
      sqlite.close();
    } catch {
      /* already closed */
    }
  }
});
