import argon2 from "argon2";

// OWASP current baseline for Argon2id: m=19456 KiB, t=2, p=1.
const ARGON2ID_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2ID_OPTS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // A malformed/foreign hash format throws rather than returning false —
    // normalize it to a plain failed verification.
    return false;
  }
}

let dummyHashPromise: Promise<string> | undefined;

/**
 * A real Argon2id hash of a constant, never-used password. Verifying
 * against this when an email doesn't exist keeps the login endpoint doing
 * the same expensive work — and taking the same time — as a genuine wrong
 * password attempt, so the two cases are indistinguishable from outside
 * (Rule 14: account enumeration is closed).
 */
export function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword("groweazzy-enumeration-guard-do-not-use");
  }
  return dummyHashPromise;
}
