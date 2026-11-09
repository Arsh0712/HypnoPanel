/**
 * HipnoType Panel — first-run initialisation (seed).
 *
 * Creates the initial admin account from HIPNO_INITIAL_ADMIN_EMAIL /
 * HIPNO_INITIAL_ADMIN_PASSWORD environment variables (installer-supplied).
 * The password is hashed immediately and never logged (spec §4.5).
 * Also creates the local CLI API token used by the `hypno` CLI.
 *
 * Run: bun scripts/seed.ts
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const db = new PrismaClient();

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function randomBase62(len: number): string {
  const out: string[] = [];
  while (out.length < len) {
    const b = crypto.randomBytes(1)[0];
    if (b < 256 - (256 % 62)) out.push(BASE62[b % 62]);
  }
  return out.join("");
}

async function main() {
  // VPS deployments pass HIPNO_STATE_DIR=/var/lib/hipno (installer);
  // the workspace default is <repo>/data.
  const dataDir = process.env.HIPNO_STATE_DIR
    ? path.resolve(process.env.HIPNO_STATE_DIR)
    : path.join(process.cwd(), "data");
  for (const sub of ["sites", "databases", "backups", "trash"]) {
    fs.mkdirSync(path.join(dataDir, sub), { recursive: true });
  }

  const email = (process.env.HIPNO_INITIAL_ADMIN_EMAIL || "admin@hypnotype.mangocloud.cyou").toLowerCase();
  const password = process.env.HIPNO_INITIAL_ADMIN_PASSWORD || "HypnoAdmin@6769";

  const existing = await db.user.findFirst({ where: { role: "admin" } });
  if (!existing) {
    const { hashSync } = await import("@node-rs/argon2");
    const hash = hashSync(password, { memoryCost: 65536, timeCost: 3, parallelism: 2 });
    const admin = await db.user.create({
      data: {
        email,
        name: "Administrator",
        passwordHash: hash,
        role: "admin",
        mustChangePassword: true, // forced change on first login (spec §4.5)
      },
    });
    console.log(`[seed] admin created: ${email} (must_change_password=true)`);
    console.log(`[seed] temporary password delivered via installer environment (never logged)`);

    // Audit genesis entry — the SAME Date object must be used for the stored
    // ts and the hash input, otherwise a 1ms skew breaks chain verification.
    const genesisTs = new Date();
    await db.auditEntry.create({
      data: {
        seq: 1,
        ts: genesisTs,
        actorEmail: email,
        actorId: admin.id,
        action: "panel.initialized",
        source: "system",
        result: "success",
        prevHash: "0".repeat(64),
        hash: crypto
          .createHash("sha256")
          .update(["0".repeat(64), "1", genesisTs.toISOString(), email, "panel.initialized", "", "success", ""].join("\n"))
          .digest("hex"),
      },
    });
  } else {
    console.log("[seed] admin already exists — skipping (idempotent)");
  }

  // Local CLI token (root-only file, hashed in DB)
  const cliTokenFile = path.join(dataDir, "cli-token.json");
  const existingToken = await db.apiToken.findFirst({ where: { name: "local-cli", revokedAt: null } });
  if (!existingToken && !fs.existsSync(cliTokenFile)) {
    const token = `hpt_${randomBase62(40)}`;
    await db.apiToken.create({
      data: {
        userId: (existing || (await db.user.findFirst({ where: { role: "admin" } })))!.id,
        name: "local-cli",
        prefix: token.slice(0, 10),
        tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
        scopes: JSON.stringify(["*"]),
      },
    });
    fs.writeFileSync(cliTokenFile, JSON.stringify({ token, createdAt: new Date().toISOString() }, null, 2), {
      mode: 0o600,
    });
    try { fs.chmodSync(cliTokenFile, 0o600); } catch {}
    console.log("[seed] local CLI token written to data/cli-token.json (0600)");
  }

  console.log("[seed] done");
}

main()
  .catch((e) => {
    console.error("[seed] failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
