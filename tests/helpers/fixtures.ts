/**
 * Per-test fixture builders. Every fixture uses a random suffix so tests
 * never share rows — the spec's own testing rules call out a shared
 * fixture as a source of false failures.
 */
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import {
  users,
  services,
  servicePlans,
  orders,
  affiliates,
  affiliateConversions,
} from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";

export function uniqueEmail(label: string): string {
  return `${label}-${randomUUID()}@fixtures.test`;
}

export async function createTestUser(opts?: { email?: string; password?: string }) {
  const db = getDb();
  const email = opts?.email ?? uniqueEmail("user");
  const passwordHash = await hashPassword(opts?.password ?? "TestPassword123!");
  const [row] = await db.insert(users).values({ email, passwordHash }).returning({ id: users.id });
  if (!row) throw new Error("failed to create test user");
  return { id: row.id, email };
}

export async function createTestServiceWithPlan(pricePaise = 1_000_00) {
  const db = getDb();
  const slug = `svc-${randomUUID()}`;
  const [service] = await db
    .insert(services)
    .values({
      slug,
      name: `Test Service ${slug}`,
      shortDescription: "fixture",
      longDescriptionHtml: "<p>fixture</p>",
      isPublished: true,
    })
    .returning({ id: services.id });
  if (!service) throw new Error("failed to create test service");

  const [plan] = await db
    .insert(servicePlans)
    .values({ serviceId: service.id, name: "Standard", pricePaise })
    .returning({ id: servicePlans.id });
  if (!plan) throw new Error("failed to create test plan");

  return { serviceId: service.id, planId: plan.id, slug, pricePaise };
}

export async function createTestOrder(userId: string, servicePlanId: string, amountPaise: number) {
  const db = getDb();
  const [row] = await db
    .insert(orders)
    .values({ userId, servicePlanId, amountPaise })
    .returning({ id: orders.id });
  if (!row) throw new Error("failed to create test order");
  return row.id;
}

export async function createTestAffiliate(userId: string) {
  const db = getDb();
  const code = `AFF${randomUUID().slice(0, 8).toUpperCase()}`;
  const [row] = await db.insert(affiliates).values({ userId, code }).returning({ id: affiliates.id });
  if (!row) throw new Error("failed to create test affiliate");
  return { id: row.id, code };
}

export async function createTestConversion(affiliateId: string, orderId: string, orderAmountPaise: number) {
  const db = getDb();
  const [row] = await db
    .insert(affiliateConversions)
    .values({
      affiliateId,
      orderId,
      commissionRateBasisPoints: 1000,
      orderAmountPaise,
    })
    .returning({ id: affiliateConversions.id });
  if (!row) throw new Error("failed to create test conversion");
  return row.id;
}

/**
 * A full chain of fixtures (user -> affiliate, user -> order -> conversion)
 * for tests that only care about the commission_entries invariants and
 * don't want to think about the rest of the graph.
 */
export async function createConversionFixture() {
  const buyer = await createTestUser();
  const affiliateUser = await createTestUser();
  const affiliate = await createTestAffiliate(affiliateUser.id);
  const { planId, pricePaise } = await createTestServiceWithPlan();
  const orderId = await createTestOrder(buyer.id, planId, pricePaise);
  const conversionId = await createTestConversion(affiliate.id, orderId, pricePaise);
  return { affiliateId: affiliate.id, orderId, conversionId, amountPaise: pricePaise };
}
