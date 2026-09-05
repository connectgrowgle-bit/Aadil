import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { servicePlans, affiliateConversions, crmContacts, orders } from "@/lib/db/schema";
import { createOrder, InactivePlanError } from "@/lib/orders/create-order";
import { seedCommissionPolicy } from "@/lib/db/seed/catalogue.logic";
import {
  createTestUser,
  createTestServiceWithPlan,
  createTestAffiliate,
  createTestAffiliateLink,
  createTestAffiliateClick,
} from "./helpers/fixtures";
import type { ResolvedAttribution } from "@/lib/attribution/resolve";

beforeAll(async () => {
  await seedCommissionPolicy();
});

describe("createOrder: price is read server-side (Rule 4/5)", () => {
  it("snapshots the order amount from the plan's current DB price", async () => {
    const buyer = await createTestUser();
    const { planId, pricePaise } = await createTestServiceWithPlan(777_00);
    const result = await createOrder({ userId: buyer.id, servicePlanId: planId });
    expect(result.amountPaise).toBe(pricePaise);
  });

  it("creates a payment row with a provider order id already attached", async () => {
    const buyer = await createTestUser();
    const { planId } = await createTestServiceWithPlan();
    const result = await createOrder({ userId: buyer.id, servicePlanId: planId });
    expect(result.providerOrderId).toMatch(/^mock_order_/);
  });

  it("refuses to create an order for an inactive plan", async () => {
    const buyer = await createTestUser();
    const { planId } = await createTestServiceWithPlan();
    const db = getDb();
    await db.update(servicePlans).set({ isActive: false }).where(eq(servicePlans.id, planId));

    await expect(createOrder({ userId: buyer.id, servicePlanId: planId })).rejects.toBeInstanceOf(InactivePlanError);
  });

  it("a later price change never rewrites an already-created order's amount", async () => {
    const buyer = await createTestUser();
    const { planId, pricePaise } = await createTestServiceWithPlan(500_00);
    const result = await createOrder({ userId: buyer.id, servicePlanId: planId });

    const db = getDb();
    await db.update(servicePlans).set({ pricePaise: 999_00 }).where(eq(servicePlans.id, planId));

    const [order] = await db.select({ amountPaise: orders.amountPaise }).from(orders).where(eq(orders.id, result.orderId)).limit(1);
    expect(order?.amountPaise).toBe(pricePaise);
  });
});

describe("createOrder: CRM self-fill (Phase 7)", () => {
  it("creates a CRM contact for a first-time buyer and moves it to QUALIFIED", async () => {
    const buyer = await createTestUser();
    const { planId } = await createTestServiceWithPlan();
    await createOrder({ userId: buyer.id, servicePlanId: planId });

    const db = getDb();
    const [contact] = await db.select().from(crmContacts).where(eq(crmContacts.userId, buyer.id)).limit(1);
    expect(contact?.stage).toBe("QUALIFIED");
    expect(contact?.email.toLowerCase()).toBe(buyer.email.toLowerCase());
  });

  it("reuses (does not duplicate) an existing contact for a repeat buyer", async () => {
    const buyer = await createTestUser();
    const { planId: plan1 } = await createTestServiceWithPlan();
    const { planId: plan2 } = await createTestServiceWithPlan();
    await createOrder({ userId: buyer.id, servicePlanId: plan1 });
    await createOrder({ userId: buyer.id, servicePlanId: plan2 });

    const db = getDb();
    const contacts = await db.select().from(crmContacts).where(eq(crmContacts.userId, buyer.id));
    expect(contacts).toHaveLength(1);
  });
});

describe("createOrder: attribution", () => {
  async function makeAttribution(affiliateUserId: string): Promise<ResolvedAttribution> {
    const affiliate = await createTestAffiliate(affiliateUserId, "ACTIVE");
    const link = await createTestAffiliateLink(affiliate.id);
    const click = await createTestAffiliateClick(link.id);
    return { affiliateId: affiliate.id, affiliateClickId: click.id, affiliateUserId };
  }

  it("creates a PENDING conversion when a valid attribution is present", async () => {
    const buyer = await createTestUser();
    const affiliateOwner = await createTestUser();
    const attribution = await makeAttribution(affiliateOwner.id);
    const { planId } = await createTestServiceWithPlan(200_00);

    const result = await createOrder({ userId: buyer.id, servicePlanId: planId, attribution });

    const db = getDb();
    const [conversion] = await db.select().from(affiliateConversions).where(eq(affiliateConversions.orderId, result.orderId)).limit(1);
    expect(conversion?.status).toBe("PENDING");
    expect(conversion?.affiliateId).toBe(attribution.affiliateId);
  });

  it("never attributes an affiliate's own purchase to themselves", async () => {
    const affiliateOwner = await createTestUser();
    const attribution = await makeAttribution(affiliateOwner.id);
    const { planId } = await createTestServiceWithPlan();

    // The buyer IS the affiliate's own account.
    const result = await createOrder({ userId: affiliateOwner.id, servicePlanId: planId, attribution });

    const db = getDb();
    const conversions = await db.select().from(affiliateConversions).where(eq(affiliateConversions.orderId, result.orderId));
    expect(conversions).toHaveLength(0);
  });

  it("creates no conversion when there is no attribution", async () => {
    const buyer = await createTestUser();
    const { planId } = await createTestServiceWithPlan();
    const result = await createOrder({ userId: buyer.id, servicePlanId: planId, attribution: null });

    const db = getDb();
    const conversions = await db.select().from(affiliateConversions).where(eq(affiliateConversions.orderId, result.orderId));
    expect(conversions).toHaveLength(0);
  });
});
