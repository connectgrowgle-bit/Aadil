import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { validateSessionToken } from "./session";
import { can } from "./can";
import type { PermissionKey } from "./permissions.catalogue";

export interface Actor {
  userId: string;
  sessionId: string;
  can(permission: PermissionKey): Promise<boolean>;
}

/**
 * The one function every page, route handler, and server action must call
 * to resolve who is asking. Deleting middleware must not change what this
 * returns for a given cookie — middleware is not the security boundary
 * (Rule 11).
 *
 * MFA (Phase 12) is enforced here, not in the login route: a session on an
 * MFA-enabled account that has not answered its challenge is refused
 * exactly like an expired one, so any endpoint added later — here or in
 * code not yet written — gets MFA covered for free.
 */
export async function resolveActor(rawToken: string | undefined): Promise<Actor | null> {
  if (!rawToken) return null;

  const validated = await validateSessionToken(rawToken);
  if (!validated) return null;

  const db = getDb();
  const rows = await db
    .select({ mfaEnabledAt: users.mfaEnabledAt })
    .from(users)
    .where(eq(users.id, validated.userId))
    .limit(1);
  const user = rows[0];
  if (!user) return null;

  if (user.mfaEnabledAt && !validated.mfaVerified) {
    return null;
  }

  return {
    userId: validated.userId,
    sessionId: validated.sessionId,
    can: (permission: PermissionKey) => can(validated.userId, permission),
  };
}
