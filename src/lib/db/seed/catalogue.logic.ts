/**
 * The actual seeding logic, factored out of catalogue.ts so both the CLI
 * entrypoint (`npm run seed:catalogue`) and the test suite can call it
 * without the CLI's `process.exit()` firing mid-test-run.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { permissions, roles, rolePermissions, commissionPolicies, services, servicePlans } from "@/lib/db/schema";
import { PERMISSIONS, ROLES } from "@/lib/auth/permissions.catalogue";

export async function seedPermissionsAndRoles(): Promise<void> {
  const db = getDb();

  const permissionIdByKey = new Map<string, string>();
  for (const p of PERMISSIONS) {
    const [row] = await db
      .insert(permissions)
      .values({ key: p.key, description: p.description })
      .onConflictDoUpdate({ target: permissions.key, set: { description: p.description } })
      .returning({ id: permissions.id, key: permissions.key });
    if (row) permissionIdByKey.set(row.key, row.id);
  }

  for (const [roleKey, def] of Object.entries(ROLES)) {
    const [roleRow] = await db
      .insert(roles)
      .values({ key: roleKey, name: def.name })
      .onConflictDoUpdate({ target: roles.key, set: { name: def.name } })
      .returning({ id: roles.id });
    if (!roleRow) continue;

    for (const permKey of def.permissions) {
      const permissionId = permissionIdByKey.get(permKey);
      if (!permissionId) {
        throw new Error(`Role ${roleKey} references unknown permission ${permKey}`);
      }
      await db.insert(rolePermissions).values({ roleId: roleRow.id, permissionId }).onConflictDoNothing();
    }
  }
}

export async function seedCommissionPolicy(): Promise<void> {
  const db = getDb();
  const existing = await db.select({ id: commissionPolicies.id }).from(commissionPolicies).limit(1);
  if (existing.length > 0) return;
  await db.insert(commissionPolicies).values({
    commissionRateBasisPoints: 1000, // 10%
    holdPeriodDays: 14,
    refundWindowDays: 30,
    payoutMinimumPaise: 100_000, // ₹1,000
    tdsRateBasisPoints: 500, // 5% — MUST be confirmed against current IT rules
    registrationFeeEnabled: "true",
    registrationFeePaise: 200_000, // ₹2,000
  });
}

export const CATALOGUE = [
  {
    slug: "real-estate-qualified-buyers",
    name: "Real Estate Qualified Buyers",
    shortDescription: "Qualified buyer leads for builders, developers, and brokers.",
    longDescriptionHtml: "<p>Qualified buyer leads for builders, developers, and brokers.</p>",
    plans: [{ name: "Standard", pricePaise: 2_500_000 }],
  },
  {
    slug: "ai-content-avatar",
    name: "AI Content Avatar",
    shortDescription: "An AI-driven video avatar for founders and personal brands.",
    longDescriptionHtml: "<p>An AI-driven video avatar for founders and personal brands.</p>",
    plans: [{ name: "Standard", pricePaise: 1_500_000 }],
  },
  {
    slug: "unlimited-video-editing",
    name: "Unlimited Video Editing",
    shortDescription: "Unlimited-request video editing for agencies and creators.",
    longDescriptionHtml: "<p>Unlimited-request video editing for agencies and creators.</p>",
    plans: [{ name: "Monthly", pricePaise: 3_500_000 }],
  },
] as const;

export async function seedServiceCatalogue(): Promise<void> {
  const db = getDb();
  for (const svc of CATALOGUE) {
    const [existing] = await db.select({ id: services.id }).from(services).where(eq(services.slug, svc.slug)).limit(1);
    let serviceId = existing?.id;
    if (!serviceId) {
      const [row] = await db
        .insert(services)
        .values({
          slug: svc.slug,
          name: svc.name,
          shortDescription: svc.shortDescription,
          longDescriptionHtml: svc.longDescriptionHtml,
          isPublished: true,
        })
        .returning({ id: services.id });
      serviceId = row?.id;
    }
    if (!serviceId) continue;

    for (const plan of svc.plans) {
      const existingPlans = await db
        .select({ id: servicePlans.id })
        .from(servicePlans)
        .where(eq(servicePlans.serviceId, serviceId));
      if (existingPlans.length === 0) {
        await db.insert(servicePlans).values({ serviceId, name: plan.name, pricePaise: plan.pricePaise });
      }
    }
  }
}

export async function seedAll(): Promise<void> {
  await seedPermissionsAndRoles();
  await seedCommissionPolicy();
  await seedServiceCatalogue();
}
