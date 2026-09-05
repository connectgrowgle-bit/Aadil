import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users, profiles, userRoles, roles } from "@/lib/db/schema";
import { hashPassword } from "./password";
import { createSession, type CreatedSession } from "./session";

export type RegisterResult =
  | { ok: true; userId: string; session: CreatedSession }
  | { ok: false; error: "EMAIL_TAKEN" | "ROLE_MISSING" };

/**
 * New client self-registration. Unlike login, registration legitimately
 * needs to tell a user their email is already in use (there is no working
 * account-creation flow that avoids this without a much larger email-
 * verification-gated design) — this is a deliberate, narrower scope than
 * Rule 14's login-enumeration requirement, not an oversight.
 */
export async function registerClient(params: {
  email: string;
  password: string;
  fullName: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<RegisterResult> {
  const db = getDb();
  const email = params.email.toLowerCase();

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1);
  if (existing.length > 0) {
    return { ok: false, error: "EMAIL_TAKEN" };
  }

  const [clientRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, "CLIENT")).limit(1);
  if (!clientRole) {
    return { ok: false, error: "ROLE_MISSING" };
  }

  const passwordHash = await hashPassword(params.password);
  const [userRow] = await db
    .insert(users)
    .values({ email: params.email, passwordHash })
    .returning({ id: users.id });
  if (!userRow) throw new Error("user insert returned no row");

  await db.insert(profiles).values({ userId: userRow.id, fullName: params.fullName });
  await db.insert(userRoles).values({ userId: userRow.id, roleId: clientRole.id });

  const session = await createSession({
    userId: userRow.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  return { ok: true, userId: userRow.id, session };
}
