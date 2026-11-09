import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, getClientIp } from "@/lib/auth/guard";
import { ApiError, handle } from "@/lib/api-error";
import { getSetting } from "@/lib/settings";
import { createBackup, type BackupScope } from "@/lib/backup";

export const runtime = "nodejs";

/** GET /api/backups — list (newest first) + retention/schedule/encryption settings. */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "backups:read" });
  const [backups, retention, schedule, encryption] = await Promise.all([
    db.backup.findMany({ orderBy: { createdAt: "desc" } }),
    getSetting("backup.retention", 10),
    getSetting("backup.schedule", "0 3 * * *"),
    getSetting("backup.encryption", false),
  ]);
  return NextResponse.json({ backups, retention, schedule, encryption });
});

/** POST /api/backups — create a backup { name?, scope: { panelDb, sites, databases, config } }. */
export const POST = handle(async (req: NextRequest) => {
  const ctx = await guard(req, { permission: "backups:write" });
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    scope?: Partial<BackupScope>;
  };

  const rawScope = body.scope || {};
  const scope: BackupScope = {
    panelDb: !!rawScope.panelDb,
    sites: !!rawScope.sites,
    databases: !!rawScope.databases,
    config: !!rawScope.config,
  };
  if (!scope.panelDb && !scope.sites && !scope.databases && !scope.config) {
    throw new ApiError(400, "invalid_scope", "Select at least one backup scope");
  }

  const name = body.name === undefined || body.name === null ? undefined : String(body.name).trim();
  const result = await createBackup(scope, name || undefined, {
    id: ctx.userId,
    email: ctx.email,
  });
  if (!result.ok) {
    throw new ApiError(500, "backup_failed", result.error || "Backup failed");
  }
  return NextResponse.json(result, { status: 201 });
});
