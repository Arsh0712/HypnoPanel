import { hashSync, verifySync } from "@node-rs/argon2";
import { checkPasswordPolicy, type PasswordPolicyResult } from "../validation";

/**
 * Argon2id password hashing (spec §4.5):
 * memory 64 MiB, time 3, parallelism 2, unique 16-byte salt.
 * Parameters are encoded inside the PHC string itself.
 */
export function hashPassword(password: string): string {
  return hashSync(password, {
    memoryCost: 65536, // 64 MiB
    timeCost: 3,
    parallelism: 2,
  });
}

export function verifyPassword(hash: string, password: string): boolean {
  try {
    return verifySync(hash, password);
  } catch {
    return false;
  }
}

export { checkPasswordPolicy, type PasswordPolicyResult };
