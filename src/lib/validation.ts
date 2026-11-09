/**
 * Server-side input validation. Every identifier that reaches the OS or DB
 * is validated here against strict allow-lists (spec §7).
 */

export const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
export const DOMAIN_RE = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;
export const IDENT_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/; // slugs, linux users
export const DB_NAME_RE = /^[a-z][a-z0-9_]{2,40}$/;
export const IPV4_CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
export const SLUG_RE = /^[A-Za-z0-9_-]+$/;

export function isValidEmail(v: string): boolean {
  return v.length <= 254 && EMAIL_RE.test(v);
}

export function isValidDomain(v: string): boolean {
  return DOMAIN_RE.test(v);
}

export function isValidPort(v: number): boolean {
  return Number.isInteger(v) && v >= 1 && v <= 65535;
}

export function isValidCidr(v: string): boolean {
  if (!IPV4_CIDR_RE.test(v)) return false;
  if (v.includes("/")) {
    const mask = Number(v.split("/")[1]);
    if (mask < 0 || mask > 32) return false;
  }
  return v.split("/")[0].split(".").every((o) => Number(o) <= 255);
}

/** Bundled common / breached-lite password list (excerpt of most-used passwords). */
export const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "123456", "12345678", "123456789", "1234567890",
  "qwerty", "qwerty123", "abc123", "letmein", "welcome", "welcome1", "admin", "admin123",
  "administrator", "root", "toor", "iloveyou", "monkey", "dragon", "sunshine", "princess",
  "football", "baseball", "master", "michael", "shadow", "superman", "trustno1", "hunter2",
  "hypnoadmin", "hypnopanel", "hypno", "panel", "changeme", "secret", "freedom", "whatever",
  "zaq12wsx", "1q2w3e4r", "qazwsx", "passw0rd", "passw0rd!", "p@ssw0rd", "default",
  "google", "facebook", "apple", "samsung", "starwars", "pokemon", "minecraft", "lol123",
]);

export interface PasswordPolicyResult {
  ok: boolean;
  errors: string[];
}

/**
 * Password policy (spec §4.5): ≥12 chars, lower + upper + digit + symbol,
 * not a common password, must not contain the email local part.
 */
export function checkPasswordPolicy(password: string, email?: string): PasswordPolicyResult {
  const errors: string[] = [];
  if (password.length < 12) errors.push("Minimum 12 characters");
  if (!/[a-z]/.test(password)) errors.push("At least one lowercase letter");
  if (!/[A-Z]/.test(password)) errors.push("At least one uppercase letter");
  if (!/[0-9]/.test(password)) errors.push("At least one digit");
  if (!/[^A-Za-z0-9]/.test(password)) errors.push("At least one symbol");
  if (COMMON_PASSWORDS.has(password.toLowerCase())) errors.push("This password is too common");
  const lower = password.toLowerCase();
  for (const common of COMMON_PASSWORDS) {
    if (common.length >= 6 && lower.includes(common)) {
      errors.push("This password is too common");
      break;
    }
  }
  if (email) {
    const local = email.split("@")[0].toLowerCase();
    if (local.length >= 3 && lower.includes(local)) {
      errors.push("Must not contain your email name");
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Shannon entropy in bits/char for custom slugs. */
export function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const SLUG_DENYLIST = new Set([
  "aaaaaaaaaaaaaaaa", "abcdefghijklmnop", "qwertyuiopasdfgh", "1234567890123456",
  "aaaaaaaaaaaaaaaaaa", "mysupersecrettoken", "my-secret-token-1", "changeme-please-now",
  "this-is-my-token", "default", "example", "testtest", "token", "secret", "password",
  "administrator", "hackme", "pleasehackme", "letmein", "AAAAAAAAAAAAAAAA",
]);

export interface SlugResult {
  ok: boolean;
  reason?: string;
}

/**
 * Custom slug rules (spec §4.4): 16–64 chars, [A-Za-z0-9_-], no dictionary
 * word / repeated pattern / low-entropy string.
 */
export function validateCustomSlug(slug: string): SlugResult {
  if (slug.length < 16) return { ok: false, reason: "Too short — minimum 16 characters" };
  if (slug.length > 64) return { ok: false, reason: "Too long — maximum 64 characters" };
  if (!SLUG_RE.test(slug)) return { ok: false, reason: "Only letters, digits, - and _ allowed" };
  if (SLUG_DENYLIST.has(slug.toLowerCase())) return { ok: false, reason: "This value is not allowed" };
  if (/(.)\1{5,}/.test(slug)) return { ok: false, reason: "Repeated pattern — too predictable" };
  if (/^(.+?)\1{2,}/.test(slug)) return { ok: false, reason: "Repeated pattern — too predictable" };
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|qwer|asdf|zxcv)/i.test(slug)) {
    return { ok: false, reason: "Sequential pattern — too predictable" };
  }
  const ent = shannonEntropy(slug);
  if (ent < 3.0) return { ok: false, reason: "Entropy too low — mix more characters" };
  const unique = new Set(slug).size;
  if (unique < 6) return { ok: false, reason: "Too few distinct characters" };
  return { ok: true };
}

/** Validate a 5 or 6 digit TOTP code. */
export function isValidTotpCode(v: string): boolean {
  return /^\d{6}$/.test(v);
}

/** Unix-username style validation for "run as" terminal users. */
export function isValidUnixUser(v: string): boolean {
  return /^[a-z_][a-z0-9_-]{0,31}$/.test(v);
}

/**
 * File-manager path safety.
 */
export const FILE_MANAGER_ROOTS = [
  "/home/z/my-project",
  "/tmp",
];

/** Paths that can never be the TARGET of a destructive operation (exact match). */
const PROTECTED_EXACT = new Set(
  [
    "/", "/boot", "/etc", "/bin", "/sbin", "/usr", "/var", "/lib", "/lib64",
    "/opt", "/root", "/srv", "/sys", "/proc", "/dev", "/run",
    "/home", "/home/z", "/home/z/my-project",
    "/home/z/my-project/.env",
    "/home/z/my-project/data/secret.key",
    "/tmp",
  ].map((p) => p.replace(/\/+$/, "") || "/")
);

/** Subtrees where NO destructive operation may touch anything inside. */
const PROTECTED_SUBTREES = [
  "/boot", "/etc", "/bin", "/sbin", "/usr", "/var", "/lib", "/lib64",
  "/opt", "/root", "/srv", "/sys", "/proc", "/dev", "/run",
  "/home/z/my-project/.git",
  "/home/z/my-project/db",
  "/home/z/my-project/prisma",
  "/home/z/my-project/src",
  "/home/z/my-project/node_modules",
  "/home/z/my-project/mini-services",
  "/home/z/my-project/.next",
];

function normalize(p: string): string {
  return p.replace(/\/+$/, "") || "/";
}

/** True if path is inside one of the allowed roots. */
export function isWithinRoots(p: string): boolean {
  const norm = normalize(p);
  return FILE_MANAGER_ROOTS.some((root) => norm === root || norm.startsWith(root + "/"));
}

/** True if a DESTRUCTIVE operation on this path is forbidden. */
export function isProtectedPath(p: string): boolean {
  const norm = normalize(p);
  if (PROTECTED_EXACT.has(norm)) return true;
  return PROTECTED_SUBTREES.some(
    (sub) => norm === sub || norm.startsWith(sub + "/")
  );
}
