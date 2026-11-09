import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import { guard, getClientIp } from "@/lib/auth/guard";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { ApiError, handle } from "@/lib/api-error";
import { DB_NAME_RE } from "@/lib/validation";
import { DATABASES_DIR } from "@/lib/constants";

export const runtime = "nodejs";

/** Real on-disk size of a database file (0 when missing). */
function fileSizeOf(fileName: string): number {
  try {
    return fs.statSync(path.join(DATABASES_DIR, fileName)).size;
  } catch {
    return 0;
  }
}

/** GET /api/databases — list panel databases with real file sizes. */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "databases:read" });
  const rows = await db.panelDatabase.findMany({ orderBy: { createdAt: "desc" } });
  const databases: (typeof rows[number] & { exists: boolean })[] = [];
  const stale: { id: string; sizeBytes: number }[] = [];
  for (const row of rows) {
    const sizeBytes = fileSizeOf(row.fileName);
    if (sizeBytes !== row.sizeBytes) {
      stale.push({ id: row.id, sizeBytes });
      row.sizeBytes = sizeBytes;
    }
    databases.push({ ...row, exists: sizeBytes > 0 });
  }
  // opportunistic refresh of stored sizes (single pass, no awaits in loop body)
  await Promise.all(
    stale.map((s) => db.panelDatabase.update({ where: { id: s.id }, data: { sizeBytes: s.sizeBytes } }))
  );
  return NextResponse.json({ databases });
});

/** POST /api/databases { name } — create a REAL SQLite database file. */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "databases:write" });
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = (body.name || "").trim();

  if (!DB_NAME_RE.test(name)) {
    throw new ApiError(
      400,
      "invalid_name",
      "Database name must be 3–41 characters: lowercase letter first, then a–z, 0–9 or _"
    );
  }

  const existing = await db.panelDatabase.findUnique({ where: { name } });
  if (existing) throw new ApiError(409, "name_taken", `A database named "${name}" already exists`);

  const fileName = `${name}.db`;
  const filePath = path.join(DATABASES_DIR, fileName);
  if (fs.existsSync(filePath)) {
    throw new ApiError(409, "name_taken", `A database file "${fileName}" already exists on disk`);
  }

  fs.mkdirSync(DATABASES_DIR, { recursive: true });
  const sqlite = new Database(filePath); // creates the file for real
  sqlite.close();

  const row = await db.panelDatabase.create({
    data: { name, fileName, sizeBytes: fileSizeOf(fileName) },
  });

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "database.create",
    target: name,
    sourceIp: getClientIp(req),
  });

  return NextResponse.json({ database: { ...row, exists: true } }, { status: 201 });
});
