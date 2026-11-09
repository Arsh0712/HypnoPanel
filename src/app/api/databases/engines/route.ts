import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import { binaryExists } from "@/lib/exec";

export const runtime = "nodejs";

/**
 * Probe cache: binary probes are cheap but there is no need to run `which`
 * on every render. 60s TTL in module scope (per server process).
 */
let cache: { at: number; engines: EngineInfo[] } | null = null;
const TTL_MS = 60_000;

interface EngineInfo {
  id: "sqlite" | "mariadb" | "postgresql";
  installed: boolean;
  /** The exact command the VPS installer runs when this engine is requested. */
  installCommand?: string;
}

/**
 * GET /api/databases/engines — probe which database engines exist on this host.
 * SQLite always exists (better-sqlite3 ships with the panel). MariaDB /
 * PostgreSQL are probed via `which mysql/mysqld/psql/postgres` — when absent
 * they remain installable on the VPS deployment (installer installs on demand).
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "databases:read" });

  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ engines: cache.engines });
  }

  const [mysql, mysqld, psql, postgres] = await Promise.all([
    binaryExists("mysql"),
    binaryExists("mysqld"),
    binaryExists("psql"),
    binaryExists("postgres"),
  ]);

  const engines: EngineInfo[] = [
    {
      id: "sqlite",
      installed: true,
    },
    {
      id: "mariadb",
      installed: mysql || mysqld,
      installCommand: "apt-get install -y mariadb-server",
    },
    {
      id: "postgresql",
      installed: psql || postgres,
      installCommand: "apt-get install -y postgresql",
    },
  ];

  cache = { at: Date.now(), engines };
  return NextResponse.json({ engines });
});
