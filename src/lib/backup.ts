import fs from "fs";
import path from "path";
import crypto from "crypto";
import { db } from "@/lib/db";
import { run } from "@/lib/exec";
import { BACKUPS_DIR, ROOT_DIR, DATA_DIR } from "@/lib/constants";
import { getSetting } from "@/lib/settings";
import { audit } from "@/lib/audit";

/**
 * Backup engine (spec §5.10): real .tar.gz archives with SHA-256 integrity,
 * pre-restore snapshots, retention policy. Target: local disk in this
 * environment; S3-compatible target configuration is stored for the VPS
 * deployment (see docs/DECISIONS.md).
 */

export interface BackupScope {
  panelDb: boolean;
  sites: boolean;
  databases: boolean;
  config: boolean;
}

export interface BackupResult {
  ok: boolean;
  id?: string;
  fileName?: string;
  sizeBytes?: number;
  sha256?: string;
  error?: string;
}

function sha256File(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

/** Safe copy of the SQLite panel DB (WAL files copied alongside). */
function backupPanelDb(destDir: string): string | null {
  const src = path.join(ROOT_DIR, "db", "custom.db");
  if (!fs.existsSync(src)) return null;
  const dest = path.join(destDir, "panel-db.sqlite");
  fs.copyFileSync(src, dest);
  try {
    fs.copyFileSync(src + "-wal", dest + "-wal");
    fs.copyFileSync(src + "-shm", dest + "-shm");
  } catch {
    /* no WAL files — fine */
  }
  return "panel-db.sqlite";
}

export async function createBackup(
  scope: BackupScope,
  name?: string,
  actor?: { id?: string; email?: string }
): Promise<BackupResult> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeName = (name || "panel").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48);
  const fileName = `${stamp}-${safeName}.tar.gz`;
  const staging = path.join(BACKUPS_DIR, `.staging-${crypto.randomBytes(4).toString("hex")}`);
  fs.mkdirSync(staging, { recursive: true });

  try {
    const stagingItems: string[] = [];
    if (scope.panelDb) {
      const dbFile = backupPanelDb(staging);
      if (dbFile) stagingItems.push(dbFile);
    }
    if (scope.config) {
      const settings = await db.setting.findMany();
      fs.writeFileSync(
        path.join(staging, "panel-config.json"),
        JSON.stringify({ exportedAt: new Date().toISOString(), settings }, null, 2)
      );
      stagingItems.push("panel-config.json");
    }
    const dataItems: string[] = [];
    if (scope.sites && fs.existsSync(path.join(DATA_DIR, "sites"))) dataItems.push("sites");
    if (scope.databases && fs.existsSync(path.join(DATA_DIR, "databases"))) dataItems.push("databases");

    if (stagingItems.length === 0 && dataItems.length === 0) {
      return { ok: false, error: "Nothing to back up (empty scope)" };
    }

    // Single tar invocation; -C changes the base dir for the files that follow it.
    const res = await run(
      "tar",
      [
        "-czf", path.join(BACKUPS_DIR, fileName),
        "-C", staging, ...stagingItems,
        "-C", DATA_DIR, ...dataItems,
      ],
      { timeoutMs: 180_000 }
    );
    if (!res.ok) return { ok: false, error: `tar failed: ${res.stderr.slice(0, 300)}` };

    const full = path.join(BACKUPS_DIR, fileName);
    const size = fs.statSync(full).size;
    const sha = sha256File(full);

    const row = await db.backup.create({
      data: {
        name: safeName,
        scope: JSON.stringify(scope),
        fileName,
        sizeBytes: size,
        sha256: sha,
        status: "ok",
      },
    });
    await audit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: "backup.create",
      target: fileName,
      source: actor ? "web" : "system",
      details: { scope, size, sha256: sha.slice(0, 16) + "…" },
    });

    // Retention policy
    const retention = await getSetting("backup.retention", 10);
    const all = await db.backup.findMany({ orderBy: { createdAt: "desc" } });
    for (const old of all.slice(retention)) {
      try {
        fs.unlinkSync(path.join(BACKUPS_DIR, old.fileName));
      } catch {}
      await db.backup.delete({ where: { id: old.id } });
    }
    return { ok: true, id: row.id, fileName, sizeBytes: size, sha256: sha };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

export async function verifyBackup(
  id: string
): Promise<{ ok: boolean; status: string; error?: string }> {
  const row = await db.backup.findUnique({ where: { id } });
  if (!row) return { ok: false, status: "missing", error: "Backup not found" };
  const p = path.join(BACKUPS_DIR, row.fileName);
  if (!fs.existsSync(p)) {
    await db.backup.update({ where: { id }, data: { status: "missing" } });
    return { ok: false, status: "missing", error: "Archive file missing on disk" };
  }
  const sha = sha256File(p);
  const ok = sha === row.sha256;
  await db.backup.update({ where: { id }, data: { status: ok ? "ok" : "corrupt" } });
  return { ok, status: ok ? "ok" : "corrupt", error: ok ? undefined : "Checksum mismatch" };
}

/** List archive entries safely (inspected before restore). */
export async function inspectBackup(id: string): Promise<{ entries: string[] }> {
  const row = await db.backup.findUnique({ where: { id } });
  if (!row) return { entries: [] };
  const res = await run("tar", ["-tzf", path.join(BACKUPS_DIR, row.fileName)], { timeoutMs: 30_000 });
  return { entries: res.ok ? res.stdout.split("\n").filter(Boolean) : [] };
}

export async function restoreBackup(
  id: string,
  actor?: { id?: string; email?: string }
): Promise<{ ok: boolean; error?: string; snapshotId?: string; restartRequired?: boolean }> {
  const row = await db.backup.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Backup not found" };
  const p = path.join(BACKUPS_DIR, row.fileName);
  if (!fs.existsSync(p)) return { ok: false, error: "Archive file missing on disk" };
  if (sha256File(p) !== row.sha256) {
    await db.backup.update({ where: { id }, data: { status: "corrupt" } });
    return { ok: false, error: "Integrity check failed — archive is corrupt" };
  }

  const scope = JSON.parse(row.scope) as BackupScope;
  // Pre-restore snapshot (spec §5.10)
  const snap = await createBackup(scope, "pre-restore");

  const staging = path.join(BACKUPS_DIR, `.restore-${crypto.randomBytes(4).toString("hex")}`);
  fs.mkdirSync(staging, { recursive: true });
  try {
    const ex = await run("tar", ["-xzf", p, "-C", staging], { timeoutMs: 120_000 });
    if (!ex.ok) return { ok: false, error: "Extraction failed" };
    // zip-slip check: entries must be relative with no ..
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const rel = path.relative(staging, path.join(dir, e.name));
        return e.isDirectory() ? [rel, ...walk(path.join(dir, e.name))] : [rel];
      });
    for (const e of walk(staging)) {
      if (path.isAbsolute(e) || e.split(path.sep).includes("..")) {
        return { ok: false, error: `Unsafe entry in archive: ${e}` };
      }
    }
    let restartRequired = false;
    if (scope.panelDb) {
      const dbSrc = path.join(staging, "panel-db.sqlite");
      if (fs.existsSync(dbSrc)) {
        const dest = path.join(ROOT_DIR, "db", "custom.db.restored");
        fs.copyFileSync(dbSrc, dest);
        restartRequired = true;
      }
    }
    if (scope.sites) {
      const src = path.join(staging, "sites");
      if (fs.existsSync(src)) {
        fs.rmSync(path.join(DATA_DIR, "sites"), { recursive: true, force: true });
        fs.cpSync(src, path.join(DATA_DIR, "sites"), { recursive: true });
      }
    }
    if (scope.databases) {
      const src = path.join(staging, "databases");
      if (fs.existsSync(src)) {
        fs.rmSync(path.join(DATA_DIR, "databases"), { recursive: true, force: true });
        fs.cpSync(src, path.join(DATA_DIR, "databases"), { recursive: true });
      }
    }
    if (scope.config) {
      const cfgSrc = path.join(staging, "panel-config.json");
      if (fs.existsSync(cfgSrc)) {
        const parsed = JSON.parse(fs.readFileSync(cfgSrc, "utf8")) as {
          settings: { key: string; value: string }[];
        };
        for (const s of parsed.settings || []) {
          await db.setting.upsert({
            where: { key: s.key },
            update: { value: s.value },
            create: { key: s.key, value: s.value },
          });
        }
      }
    }
    await audit({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: "backup.restore",
      target: row.fileName,
      details: { scope, preRestoreSnapshot: snap.fileName },
    });
    return { ok: true, snapshotId: snap.id, restartRequired };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
