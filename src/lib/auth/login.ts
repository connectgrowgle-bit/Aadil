import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPassword, getDummyHash } from "./password";
import { createSession, type CreatedSession } from "./session";

export type LoginResult =
  | { ok: true; userId: string; session: CreatedSession }
  | { ok: false };

/**
 * Unknown email and wrong password return byte-identical results and
 * (as far as Argon2id's own timing variance allows) near-identical timing
 * — Rule 14. Both paths always run one Argon2id verify.
 */
export async function attemptLogin(params: {
  email: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<LoginResult> {
  const db = getDb();
  const rows = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      suspendedAt: users.suspendedAt,
    })
    .from(users)
    .where(eq(sql`lower(${users.email})`, params.email.toLowerCase()))
    .limit(1);

  const user = rows[0];
  const hashToCheck = user?.passwordHash ?? (await getDummyHash());
  const passwordOk = await verifyPassword(hashToCheck, params.password);

  if (!user || !passwordOk || user.suspendedAt) {
    return { ok: false };
  }

  const session = await createSession({
    userId: user.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  return { ok: true, userId: user.id, session };
}
