import { db } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto";

/**
 * Append-only audit log with a SHA-256 hash chain for tamper evidence (spec §5.15).
 * hash_n = sha256(hash_{n-1} ‖ seq ‖ ts ‖ actor ‖ action ‖ target ‖ result ‖ details)
 */
const GENESIS = "0".repeat(64);

export interface AuditInput {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  target?: string | null;
  source?: "web" | "local-cli" | "system";
  sourceIp?: string | null;
  result?: "success" | "failure";
  details?: Record<string, unknown> | null;
}

function computeHash(
  prevHash: string,
  seq: number,
  ts: Date,
  actorEmail: string,
  action: string,
  target: string,
  result: string,
  details: string
): string {
  return sha256Hex(
    [prevHash, String(seq), ts.toISOString(), actorEmail, action, target, result, details].join("\n")
  );
}

export async function audit(input: AuditInput): Promise<void> {
  const last = await db.auditEntry.findFirst({ orderBy: { seq: "desc" } });
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash || GENESIS;
  const ts = new Date();
  const details = input.details ? JSON.stringify(input.details) : "";
  const hash = computeHash(
    prevHash,
    seq,
    ts,
    input.actorEmail || "",
    input.action,
    input.target || "",
    input.result || "success",
    details
  );
  await db.auditEntry.create({
    data: {
      seq,
      ts,
      actorId: input.actorId || null,
      actorEmail: input.actorEmail || null,
      action: input.action,
      target: input.target || null,
      source: input.source || "web",
      sourceIp: input.sourceIp || null,
      result: input.result || "success",
      details: details || null,
      prevHash,
      hash,
    },
  });
}

export interface ChainVerification {
  valid: boolean;
  checked: number;
  firstBrokenSeq?: number;
}

export async function verifyAuditChain(): Promise<ChainVerification> {
  const entries = await db.auditEntry.findMany({ orderBy: { seq: "asc" } });
  let prev = GENESIS;
  for (const e of entries) {
    if (e.prevHash !== prev) return { valid: false, checked: e.seq, firstBrokenSeq: e.seq };
    const expect = computeHash(
      e.prevHash,
      e.seq,
      e.ts,
      e.actorEmail || "",
      e.action,
      e.target || "",
      e.result,
      e.details || ""
    );
    if (expect !== e.hash) return { valid: false, checked: e.seq, firstBrokenSeq: e.seq };
    prev = e.hash;
  }
  return { valid: true, checked: entries.length };
}
