import { NextRequest, NextResponse } from "next/server";
import os from "os";
import { guard } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import { db } from "@/lib/db";
import { binaryExists } from "@/lib/exec";
import {
  computePhpTuning,
  phpSnippet,
  getPhpTuning,
  readSwapStatus,
  readNetSysctls,
  readHttpFeatures,
} from "../_shared";

export const runtime = "nodejs";

/**
 * GET /api/performance/advisors — PHP-FPM advisor computed from host RAM,
 * SQLite PRAGMA inspection, swap state, congestion control and Caddyfile
 * features. All real; absent backends are reported honestly.
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "performance:read" });

  /* ————— PHP-FPM ————— */
  const hostRam = os.totalmem();
  const recommended = computePhpTuning(hostRam);
  const current = await getPhpTuning();
  const phpBinary =
    (await binaryExists("php")) ||
    (await binaryExists("php-fpm")) ||
    (await binaryExists("php-fpm8.2")) ||
    (await binaryExists("php-fpm8.3"));
  const php = {
    available: phpBinary,
    note: phpBinary
      ? "php-fpm detected on this host; values are stored in the panel config and FPM pools are generated per site on the VPS deployment."
      : "No php/php-fpm binary in this environment — the advisor still computes real values from host RAM; FPM pools are generated per site on the VPS deployment.",
    hostRam,
    recommended,
    current,
    snippet: phpSnippet(recommended),
  };

  /* ————— database advisors ————— */
  let sqlite = {
    available: false,
    pageSize: null as number | null,
    journalMode: null as string | null,
    walAutocheckpoint: null as number | null,
    dbBytes: null as number | null,
    guidance: ["Panel SQLite not reachable — advisory unavailable."],
  };
  try {
    const pageSize = await db.$queryRawUnsafe<{ page_size: number | bigint }[]>("PRAGMA page_size");
    const journalMode = await db.$queryRawUnsafe<{ journal_mode: string }[]>("PRAGMA journal_mode");
    const walAc = await db.$queryRawUnsafe<{ wal_autocheckpoint: number | bigint }[]>(
      "PRAGMA wal_autocheckpoint"
    );
    const pageCount = await db.$queryRawUnsafe<{ page_count: number | bigint }[]>("PRAGMA page_count");
    const ps = Number(pageSize?.[0]?.page_size ?? 0);
    const pc = Number(pageCount?.[0]?.page_count ?? 0);
    const jm = String(journalMode?.[0]?.journal_mode ?? "");
    const ac = Number(walAc?.[0]?.wal_autocheckpoint ?? 0);
    const guidance: string[] = [];
    guidance.push(
      jm.toLowerCase() === "wal"
        ? "journal_mode=wal — readers never block the writer, the right choice for a busy panel DB."
        : `journal_mode=${jm} — switching to WAL (PRAGMA journal_mode=WAL) improves concurrency.`
    );
    guidance.push(
      `wal_autocheckpoint=${ac} pages (≈ ${((ps * ac) / (1024 * 1024)).toFixed(1)} MB) — the default checkpoint cadence; raise it only if you see frequent writer stalls.`
    );
    guidance.push(
      ps >= 4096
        ? `page_size=${ps} B suits the panel's mixed read/write workload.`
        : `page_size=${ps} B is small; 4096 B typically reduces b-tree depth for the panel workload.`
    );
    sqlite = {
      available: true,
      pageSize: ps,
      journalMode: jm,
      walAutocheckpoint: ac,
      dbBytes: ps * pc,
      guidance,
    };
  } catch {
    /* keep the honest default above */
  }

  const [mariadbBinary, postgresBinary] = await Promise.all([
    (async () => (await binaryExists("mariadbd")) || (await binaryExists("mysqld")))(),
    binaryExists("postgres"),
  ]);
  const database = {
    sqlite,
    mariadb: mariadbBinary
      ? { available: true, reason: "mariadbd/mysqld detected on this host." }
      : {
          available: false,
          reason:
            "mariadbd/mysqld binary not found — MariaDB is provisioned per site on the VPS deployment, not in this panel environment.",
        },
    postgres: postgresBinary
      ? { available: true, reason: "postgres detected on this host." }
      : {
          available: false,
          reason:
            "postgres binary not found — PostgreSQL is provisioned per site on the VPS deployment, not in this panel environment.",
        },
  };

  /* ————— swap + network + http ————— */
  const [swap, net, http] = await Promise.all([readSwapStatus(), readNetSysctls(), readHttpFeatures()]);

  return NextResponse.json({
    php,
    database,
    swap,
    network: {
      available: net.available,
      congestionControl: net.congestionControl,
      availableAlgorithms: net.availableAlgorithms,
      bbrAvailable: net.availableAlgorithms.includes("bbr"),
    },
    http,
  });
});
