import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { userRoles, rolePermissions, permissions } from "@/lib/db/schema";
import type { PermissionKey } from "./permissions.catalogue";

/**
 * Resolves `user → user_roles → roles → role_permissions → permissions`
 * fresh, per request. Never branch on `role === "..."` anywhere else in
 * the codebase — this is the only function that is allowed to know how a
 * permission maps to a role, and it reads that mapping from the database,
 * not from permissions.catalogue.ts, so access stays configurable without
 * a deploy (Rule 12).
 */
export async function can(userId: string, permission: PermissionKey): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ key: permissions.key })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(userRoles.userId, userId), eq(permissions.key, permission)))
    .limit(1);

  return rows.length > 0;
}

/** Throws-on-false convenience wrapper for route handlers / server actions. */
export class ForbiddenError extends Error {
  constructor(permission: string) {
    super(`Missing permission: ${permission}`);
    this.name = "ForbiddenError";
  }
}

export async function requirePermission(userId: string, permission: PermissionKey): Promise<void> {
  if (!(await can(userId, permission))) {
    throw new ForbiddenError(permission);
  }
}

/** All permission keys granted to a user — for building UI, not for gating. */
export async function listPermissionsForUser(userId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ key: permissions.key })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId));
  return Array.from(new Set(rows.map((r) => r.key)));
}
