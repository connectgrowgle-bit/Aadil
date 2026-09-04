import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users, sessions } from "@/lib/db/schema";
import { attemptLogin } from "@/lib/auth/login";
import { registerClient } from "@/lib/auth/register";
import {
  createSession,
  validateSessionToken,
  revokeSession,
  invalidateAllSessions,
} from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { seedPermissionsAndRoles } from "@/lib/db/seed/catalogue.logic";
import { createTestUser, uniqueEmail } from "./helpers/fixtures";

const PASSWORD = "CorrectHorseBattery9!";

beforeAll(async () => {
  // registerClient needs the CLIENT role to exist.
  await seedPermissionsAndRoles();
});

describe("password hashing", () => {
  it("verifies a matching password", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, "wrong-password")).toBe(false);
  });

  it("never stores the password in plaintext inside the hash", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).not.toContain(PASSWORD);
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });
});

describe("attemptLogin: enumeration resistance (Rule 14)", () => {
  it("succeeds with the right password", async () => {
    const user = await createTestUser({ password: PASSWORD });
    const result = await attemptLogin({ email: user.email, password: PASSWORD });
    expect(result.ok).toBe(true);
  });

  it("fails with a wrong password, shaped identically to an unknown email", async () => {
    const user = await createTestUser({ password: PASSWORD });
    const wrongPw = await attemptLogin({ email: user.email, password: "not-it" });
    const unknownEmail = await attemptLogin({ email: uniqueEmail("nobody"), password: "not-it" });

    expect(wrongPw.ok).toBe(false);
    expect(unknownEmail.ok).toBe(false);
    // Byte-identical shape: both are exactly `{ ok: false }`, nothing more.
    expect(Object.keys(wrongPw)).toEqual(["ok"]);
    expect(Object.keys(unknownEmail)).toEqual(["ok"]);
  });

  it("is case-insensitive on email", async () => {
    const mixedCaseEmail = uniqueEmail("MixedCase");
    const user = await createTestUser({ password: PASSWORD, email: mixedCaseEmail });
    const result = await attemptLogin({ email: user.email.toUpperCase(), password: PASSWORD });
    expect(result.ok).toBe(true);
  });

  it("refuses a suspended account even with the correct password", async () => {
    const user = await createTestUser({ password: PASSWORD });
    const db = getDb();
    await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, user.id));

    const result = await attemptLogin({ email: user.email, password: PASSWORD });
    expect(result.ok).toBe(false);
  });
});

describe("registerClient", () => {
  it("creates a user and an initial session", async () => {
    const email = uniqueEmail("register");
    const result = await registerClient({ email, password: PASSWORD, fullName: "Test User" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const validated = await validateSessionToken(result.session.token);
      expect(validated?.userId).toBe(result.userId);
    }
  });

  it("refuses a duplicate email", async () => {
    const email = uniqueEmail("dup");
    const first = await registerClient({ email, password: PASSWORD, fullName: "First" });
    expect(first.ok).toBe(true);
    const second = await registerClient({ email, password: PASSWORD, fullName: "Second" });
    expect(second).toEqual({ ok: false, error: "EMAIL_TAKEN" });
  });
});

describe("sessions: three independent expiry mechanisms", () => {
  it("validates a freshly created session", async () => {
    const user = await createTestUser();
    const session = await createSession({ userId: user.id });
    const validated = await validateSessionToken(session.token);
    expect(validated?.userId).toBe(user.id);
  });

  it("rejects an unknown token", async () => {
    const validated = await validateSessionToken("not-a-real-token");
    expect(validated).toBeNull();
  });

  it("sliding expiry: a session past its (sliding) expiresAt is rejected", async () => {
    const user = await createTestUser();
    const session = await createSession({ userId: user.id });
    const db = getDb();
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, session.sessionId));

    expect(await validateSessionToken(session.token)).toBeNull();
  });

  it("absolute expiry: a session past absoluteExpiresAt is rejected even with a fresh sliding expiry", async () => {
    const user = await createTestUser();
    const session = await createSession({ userId: user.id });
    const db = getDb();
    await db
      .update(sessions)
      .set({
        expiresAt: new Date(Date.now() + 1000 * 60 * 60), // far in the future
        absoluteExpiresAt: new Date(Date.now() - 1000), // but absolute already passed
      })
      .where(eq(sessions.id, session.sessionId));

    expect(await validateSessionToken(session.token)).toBeNull();
  });

  it("watermark: invalidateAllSessions rejects every prior session for the user instantly", async () => {
    const user = await createTestUser();
    const session = await createSession({ userId: user.id });
    expect(await validateSessionToken(session.token)).not.toBeNull();

    await invalidateAllSessions(user.id);

    expect(await validateSessionToken(session.token)).toBeNull();
  });

  it("watermark: a session created AFTER invalidateAllSessions remains valid", async () => {
    const user = await createTestUser();
    await invalidateAllSessions(user.id);
    const session = await createSession({ userId: user.id });

    expect(await validateSessionToken(session.token)).not.toBeNull();
  });

  it("revoke: a revoked session is rejected", async () => {
    const user = await createTestUser();
    const session = await createSession({ userId: user.id });
    await revokeSession(session.sessionId);

    expect(await validateSessionToken(session.token)).toBeNull();
  });

  it("only sha256(token) is stored, never the raw token", async () => {
    const user = await createTestUser();
    const session = await createSession({ userId: user.id });
    const db = getDb();
    const [row] = await db.select({ tokenHash: sessions.tokenHash }).from(sessions).where(eq(sessions.id, session.sessionId));
    expect(row?.tokenHash).not.toBe(session.token);
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sliding refresh extends expiresAt on successful validation", async () => {
    const user = await createTestUser();
    const session = await createSession({ userId: user.id });
    const db = getDb();
    // Force expiresAt close to now so the slide is measurable.
    const nearNow = new Date(Date.now() + 1000);
    await db.update(sessions).set({ expiresAt: nearNow }).where(eq(sessions.id, session.sessionId));

    await validateSessionToken(session.token);

    const [row] = await db.select({ expiresAt: sessions.expiresAt }).from(sessions).where(eq(sessions.id, session.sessionId));
    expect(row!.expiresAt.getTime()).toBeGreaterThan(nearNow.getTime());
  });
});
