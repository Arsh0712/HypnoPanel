/**
 * Login rate limiting (spec §4.5): per-account and per-IP, exponential
 * lockout — 5 failures then 1, 5, 15 minutes. In-memory (single process).
 */

const MAX_FAILURES = 5;
const LOCK_STEPS_MIN = [1, 5, 15]; // minutes

interface LockState {
  failures: number;
  lockedUntil: number; // epoch ms
}

const states = new Map<string, LockState>();

function cleanup() {
  const now = Date.now();
  for (const [k, v] of states) {
    if (v.lockedUntil < now && v.failures === 0) states.delete(k);
  }
}

export interface LockStatus {
  locked: boolean;
  secondsRemaining: number;
  failures: number;
}

export function getLockStatus(key: string): LockStatus {
  const st = states.get(key);
  const now = Date.now();
  if (st && st.lockedUntil > now) {
    return {
      locked: true,
      secondsRemaining: Math.ceil((st.lockedUntil - now) / 1000),
      failures: st.failures,
    };
  }
  return { locked: false, secondsRemaining: 0, failures: st?.failures || 0 };
}

export function recordFailure(key: string): LockStatus {
  cleanup();
  const st = states.get(key) || { failures: 0, lockedUntil: 0 };
  st.failures += 1;
  if (st.failures >= MAX_FAILURES) {
    const step = Math.min(Math.floor(st.failures / MAX_FAILURES) - 1, LOCK_STEPS_MIN.length - 1);
    st.lockedUntil = Date.now() + LOCK_STEPS_MIN[step] * 60_000;
  }
  states.set(key, st);
  return getLockStatus(key);
}

export function recordSuccess(key: string) {
  states.delete(key);
}
