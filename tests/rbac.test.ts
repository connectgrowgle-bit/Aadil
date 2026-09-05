import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { roles, userRoles } from "@/lib/db/schema";
import { can, requirePermission, listPermissionsForUser, ForbiddenError } from "@/lib/auth/can";
import { seedPermissionsAndRoles } from "@/lib/db/seed/catalogue.logic";
import { createTestUser } from "./helpers/fixtures";

beforeAll(async () => {
  await seedPermissionsAndRoles();
});

async function assignRole(userId: string, roleKey: string) {
  const db = getDb();
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, roleKey)).limit(1);
  if (!role) throw new Error(`role ${roleKey} not seeded`);
  await db.insert(userRoles).values({ userId, roleId: role.id });
}

describe("can(): resolved from the database, not role strings", () => {
  it("grants a permission the user's role includes", async () => {
    const user = await createTestUser();
    await assignRole(user.id, "AFFILIATE_MANAGER");
    expect(await can(user.id, "payout.approve")).toBe(true);
  });

  it("denies a permission the user's role does not include", async () => {
    const user = await createTestUser();
    await assignRole(user.id, "CLIENT");
    expect(await can(user.id, "payout.approve")).toBe(false);
  });

  it("denies every permission to a user with no role at all", async () => {
    const user = await createTestUser();
    expect(await can(user.id, "order.view.own")).toBe(false);
  });

  it("SUPER_ADMIN has every catalogued permission", async () => {
    const user = await createTestUser();
    await assignRole(user.id, "SUPER_ADMIN");
    expect(await can(user.id, "commission_policy.edit")).toBe(true);
    expect(await can(user.id, "webhook.view")).toBe(true);
    expect(await can(user.id, "training.publish")).toBe(true);
  });

  it("service.pricing is separate from service.edit — one role can hold either independently", async () => {
    const editor = await createTestUser();
    await assignRole(editor.id, "OPS_STAFF"); // has neither in this catalogue
    expect(await can(editor.id, "service.edit")).toBe(false);
    expect(await can(editor.id, "service.pricing")).toBe(false);

    const admin = await createTestUser();
    await assignRole(admin.id, "ADMIN"); // has both
    expect(await can(admin.id, "service.edit")).toBe(true);
    expect(await can(admin.id, "service.pricing")).toBe(true);
  });

  it("a user can hold multiple roles and the permissions union", async () => {
    const user = await createTestUser();
    await assignRole(user.id, "CLIENT");
    await assignRole(user.id, "AFFILIATE");
    expect(await can(user.id, "order.view.own")).toBe(true);
    expect(await can(user.id, "payout.request")).toBe(true);
    expect(await can(user.id, "payout.approve")).toBe(false);
  });
});

describe("requirePermission", () => {
  it("resolves without throwing when the actor has the permission", async () => {
    const user = await createTestUser();
    await assignRole(user.id, "SUPER_ADMIN");
    await expect(requirePermission(user.id, "audit.view")).resolves.toBeUndefined();
  });

  it("throws ForbiddenError when the actor lacks the permission", async () => {
    const user = await createTestUser();
    await assignRole(user.id, "CLIENT");
    await expect(requirePermission(user.id, "audit.view")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("listPermissionsForUser", () => {
  it("returns a deduplicated union across roles", async () => {
    const user = await createTestUser();
    await assignRole(user.id, "SUPPORT_AGENT");
    await assignRole(user.id, "CLIENT"); // CLIENT and SUPPORT_AGENT do not overlap
    const perms = await listPermissionsForUser(user.id);
    expect(new Set(perms).size).toBe(perms.length);
    expect(perms).toContain("support.ticket.respond");
    expect(perms).toContain("order.view.own");
  });
});
