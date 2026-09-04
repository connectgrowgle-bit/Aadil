import { randomBytes, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";

// Sliding window, refreshed on every validated request.
export const SESSION_SLIDING_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
// Fixed at creation; never extended regardless of activity.
export const SESSION_ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export interface CreatedSession {
  /** Raw bearer token — set as the session cookie value. Never stored. */
  token: string;
  sessionId: string;
  expiresAt: Date;
}

export interface ValidatedSession {
  sessionId: string;
  userId: string;
  mfaVerified: boolean;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(params: {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<CreatedSession> {
  const db = getDb();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_SLIDING_TTL_MS);
  const absoluteExpiresAt = new Date(now + SESSION_ABSOLUTE_TTL_MS);

  const [row] = await db
    .insert(sessions)
    .values({
      userId: params.userId,
      tokenHash,
      expiresAt,
      absoluteExpiresAt,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    })
    .returning({ id: sessions.id });

  if (!row) throw new Error("session insert returned no row");
  return { token, sessionId: row.id, expiresAt };
}

/**
 * Validates a bearer token against all three independent expiry
 * mechanisms (docs/ARCHITECTURE.md §5) plus account suspension, and
 * slides the window forward on success. Returns null for any failure —
 * callers must not distinguish "expired" from "revoked" from "not found"
 * in what they show the user (Rule 14).
 */
export async function validateSessionToken(rawToken: string): Promise<ValidatedSession | null> {
  const db = getDb();
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const rows = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      absoluteExpiresAt: sessions.absoluteExpiresAt,
      revokedAt: sessions.revokedAt,
      mfaVerifiedAt: sessions.mfaVerifiedAt,
      sessionCreatedAt: sessions.createdAt,
      sessionsValidFrom: users.sessionsValidFrom,
      suspendedAt: users.suspendedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.suspendedAt) return null;
  if (row.expiresAt.getTime() <= now.getTime()) return null; // sliding
  if (row.absoluteExpiresAt.getTime() <= now.getTime()) return null; // absolute
  // Watermark: a password reset or suspension bumps sessionsValidFrom,
  // instantly invalidating every session created before it, regardless of
  // that session's own expiry.
  if (row.sessionCreatedAt.getTime() < row.sessionsValidFrom.getTime()) return null;

  const slidTo = new Date(
    Math.min(now.getTime() + SESSION_SLIDING_TTL_MS, row.absoluteExpiresAt.getTime()),
  );
  if (slidTo.getTime() > row.expiresAt.getTime()) {
    await db.update(sessions).set({ expiresAt: slidTo }).where(eq(sessions.id, row.sessionId));
  }

  return {
    sessionId: row.sessionId,
    userId: row.userId,
    mfaVerified: row.mfaVerifiedAt != null,
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  const db = getDb();
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function markSessionMfaVerified(sessionId: string): Promise<void> {
  const db = getDb();
  await db.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, sessionId));
}

/**
 * Bumps the watermark, instantly invalidating every session for the user
 * — including the one making this call, if any — regardless of individual
 * expiry. Used on password reset and account suspension.
 */
export async function invalidateAllSessions(userId: string): Promise<void> {
  const db = getDb();
  await db.update(users).set({ sessionsValidFrom: new Date() }).where(eq(users.id, userId));
}
