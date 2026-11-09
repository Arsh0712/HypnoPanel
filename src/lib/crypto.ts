import crypto from "crypto";
import fs from "fs";
import { SECRET_KEY_FILE, TOKEN_LEN } from "./constants";

/**
 * Cryptography helpers for HipnoType Panel.
 * - Secrets at rest: AES-256-GCM with a key stored in data/secret.key (0600).
 *   (On a VPS deployment the key lives at /etc/hipno/secret.key — docs/DECISIONS.md)
 * - Tokens: base62 [A-Za-z0-9] generated with rejection sampling (no modulo bias).
 */

let cachedKey: Buffer | null = null;

/** Load (or create) the panel master key. */
export function getSecretKey(): Buffer {
  if (cachedKey) return cachedKey;
  try {
    const key = fs.readFileSync(SECRET_KEY_FILE);
    if (key.length === 32) {
      cachedKey = key;
      return key;
    }
  } catch {
    /* create below */
  }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(SECRET_KEY_FILE.slice(0, SECRET_KEY_FILE.lastIndexOf("/")), { recursive: true });
  fs.writeFileSync(SECRET_KEY_FILE, key, { mode: 0o600 });
  try {
    fs.chmodSync(SECRET_KEY_FILE, 0o600);
  } catch {
    /* best effort on containers */
  }
  cachedKey = key;
  return key;
}

/** AES-256-GCM encrypt → base64(iv ‖ tag ‖ ciphertext). */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getSecretKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

/** AES-256-GCM decrypt. Throws on tamper. */
export function decrypt(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getSecretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Constant-time string comparison for secrets/tokens. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // still do a comparison to keep timing flat-ish, then fail
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Random base62 string with rejection sampling (no modulo bias), per spec §4.3.
 */
export function randomBase62(length: number): string {
  const out: string[] = [];
  const bytes = crypto.randomBytes(length * 2);
  let i = 0;
  while (out.length < length) {
    if (i >= bytes.length) {
      bytes.copy(crypto.randomBytes(bytes.length), 0); // refill
      i = 0;
    }
    const b = bytes[i++];
    // 256 % 62 = 8 → reject the top 8 values to avoid bias
    if (b < 256 - (256 % 62)) out.push(BASE62[b % 62]);
  }
  return out.join("");
}

/** 32-char access-URL token. */
export function generateAccessToken(): string {
  return randomBase62(TOKEN_LEN);
}

/** API token with prefix hpt_. */
export function generateApiToken(): string {
  return `hpt_${randomBase62(40)}`;
}

/** 10 recovery codes. */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => `${randomBase62(5)}-${randomBase62(5)}`);
}
