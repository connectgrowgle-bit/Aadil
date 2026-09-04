/**
 * Seeds roles/permissions and the service catalogue. Safe to re-run
 * (upsert by natural key). This is the "system" seed — it must be safe to
 * run in production. Demo data with fake accounts lives in
 * src/lib/db/seed/demo.ts and must NEVER be run against production
 * (Deliverables §10: "seed scripts ... separate, so production never runs
 * the one that creates test accounts").
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { permissions, roles, rolePermissions, commissionPolicies, services, servicePlans } from "@/lib/db/schema";
import { PERMISSIONS, ROLES } from "@/lib/auth/permissions.catalogue";

async function seedPermissionsAndRoles() {
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
  console.log(`  permissions: ${permissionIdByKey.size}`);

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
      await db
        .insert(rolePermissions)
        .values({ roleId: roleRow.id, permissionId })
        .onConflictDoNothing();
    }
    console.log(`  role ${roleKey}: ${def.permissions.length} permissions`);
  }
}

async function seedCommissionPolicy() {
  const db = getDb();
  const existing = await db.select({ id: commissionPolicies.id }).from(commissionPolicies).limit(1);
  if (existing.length > 0) {
    console.log("  commission_policies: already seeded, skipping");
    return;
  }
  await db.insert(commissionPolicies).values({
    commissionRateBasisPoints: 1000, // 10%
    holdPeriodDays: 14,
    refundWindowDays: 30,
    payoutMinimumPaise: 100_000, // ₹1,000
    tdsRateBasisPoints: 500, // 5% — MUST be confirmed against current IT rules, see docs/ARCHITECTURE.md §2
    registrationFeeEnabled: "true",
    registrationFeePaise: 200_000, // ₹2,000
  });
  console.log("  commission_policies: seeded default");
}

const CATALOGUE = [
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

async function seedServiceCatalogue() {
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
        await db.insert(servicePlans).values({
          serviceId,
          name: plan.name,
          pricePaise: plan.pricePaise,
        });
      }
    }
  }
  console.log(`  services: ${CATALOGUE.length}`);
}

async function main() {
  console.log("==> Seeding permissions & roles");
  await seedPermissionsAndRoles();
  console.log("==> Seeding commission policy");
  await seedCommissionPolicy();
  console.log("==> Seeding service catalogue");
  await seedServiceCatalogue();
  console.log("==> Done");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
