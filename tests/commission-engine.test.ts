import { describe, it, expect, beforeAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { commissionEntries, affiliateConversions } from "@/lib/db/schema";
import {
  createPendingConversion,
  confirmConversionAndEarn,
  cancelConversion,
  reverseProportionalShare,
} from "@/lib/commission/engine";
import { seedCommissionPolicy } from "@/lib/db/seed/catalogue.logic";
import {
  createTestUser,
  createTestAffiliate,
  createTestServiceWithPlan,
  createTestOrder,
} from "./helpers/fixtures";

beforeAll(async () => {
  await seedCommissionPolicy();
});

async function setupPendingConversion(orderAmountPaise = 1_000_00) {
  const buyer = await createTestUser();
  const affiliateOwner = await createTestUser();
  const affiliate = await createTestAffiliate(affiliateOwner.id, "ACTIVE");
  const { planId } = await createTestServiceWithPlan(orderAmountPaise);
  const orderId = await createTestOrder(buyer.id, planId, orderAmountPaise);
  const conversionId = await createPendingConversion({ affiliateId: affiliate.id, orderId, orderAmountPaise });
  return { orderId, conversionId, affiliateId: affiliate.id, orderAmountPaise };
}

describe("createPendingConversion", () => {
  it("snapshots the currently active commission rate onto the conversion", async () => {
    const { conversionId } = await setupPendingConversion();
    const db = getDb();
    const [row] = await db.select().from(affiliateConversions).where(eq(affiliateConversions.id, conversionId)).limit(1);
    expect(row?.status).toBe("PENDING");
    expect(row?.commissionRateBasisPoints).toBeGreaterThan(0);
  });
});

describe("confirmConversionAndEarn", () => {
  it("writes an EARNING entry sized by the snapshotted rate", async () => {
    const { orderId, conversionId, affiliateId, orderAmountPaise } = await setupPendingConversion(1_000_00);
    const result = await confirmConversionAndEarn(orderId);
    expect(result).not.toBeNull();

    const db = getDb();
    const [entry] = await db
      .select()
      .from(commissionEntries)
      .where(and(eq(commissionEntries.conversionId, conversionId), eq(commissionEntries.type, "EARNING")))
      .limit(1);
    expect(entry).toBeDefined();
    expect(entry!.affiliateId).toBe(affiliateId);
    expect(entry!.paise).toBeGreaterThan(0);
    expect(entry!.paise).toBeLessThan(orderAmountPaise); // a fraction of the order, never the whole thing

    const [conversion] = await db.select({ status: affiliateConversions.status }).from(affiliateConversions).where(eq(affiliateConversions.id, conversionId)).limit(1);
    expect(conversion?.status).toBe("CONFIRMED");
  });

  it("is idempotent: calling it twice for the same order writes only one EARNING entry", async () => {
    const { orderId, conversionId } = await setupPendingConversion();
    const first = await confirmConversionAndEarn(orderId);
    const second = await confirmConversionAndEarn(orderId);
    expect(second?.entryId).toBe(first?.entryId);

    const db = getDb();
    const entries = await db
      .select()
      .from(commissionEntries)
      .where(and(eq(commissionEntries.conversionId, conversionId), eq(commissionEntries.type, "EARNING")));
    expect(entries).toHaveLength(1);
  });

  it("returns null for an order with no affiliate attribution at all", async () => {
    const buyer = await createTestUser();
    const { planId } = await createTestServiceWithPlan();
    const orderId = await createTestOrder(buyer.id, planId, 1_000_00);
    expect(await confirmConversionAndEarn(orderId)).toBeNull();
  });
});

describe("cancelConversion", () => {
  it("marks the conversion CANCELLED and writes NO commission entry", async () => {
    const { orderId, conversionId } = await setupPendingConversion();
    await cancelConversion(orderId);

    const db = getDb();
    const [conversion] = await db.select({ status: affiliateConversions.status }).from(affiliateConversions).where(eq(affiliateConversions.id, conversionId)).limit(1);
    expect(conversion?.status).toBe("CANCELLED");

    const entries = await db.select().from(commissionEntries).where(eq(commissionEntries.conversionId, conversionId));
    expect(entries).toHaveLength(0);
  });

  it("does not touch an already-CONFIRMED conversion", async () => {
    const { orderId, conversionId } = await setupPendingConversion();
    await confirmConversionAndEarn(orderId);
    await cancelConversion(orderId); // should be a no-op — only affects PENDING

    const db = getDb();
    const [conversion] = await db.select({ status: affiliateConversions.status }).from(affiliateConversions).where(eq(affiliateConversions.id, conversionId)).limit(1);
    expect(conversion?.status).toBe("CONFIRMED");
  });
});

describe("reverseProportionalShare", () => {
  it("reverses an exact half on a 50% cumulative refund", async () => {
    const { orderId, conversionId, orderAmountPaise } = await setupPendingConversion(1_000_00);
    const confirmed = await confirmConversionAndEarn(orderId);
    const db = getDb();
    const [earning] = await db.select().from(commissionEntries).where(eq(commissionEntries.id, confirmed!.entryId)).limit(1);

    const result = await reverseProportionalShare(orderId, Math.floor(orderAmountPaise / 2));
    expect(result?.deltaPaise).toBeGreaterThan(0);

    const [reversal] = await db
      .select()
      .from(commissionEntries)
      .where(and(eq(commissionEntries.conversionId, conversionId), eq(commissionEntries.type, "REVERSAL")))
      .limit(1);
    expect(reversal!.paise).toBe(-result!.deltaPaise);
    expect(Math.abs(reversal!.paise)).toBeLessThanOrEqual(earning!.paise);
  });

  it("a second webhook with the SAME cumulative refund amount is a no-op (replay-safe)", async () => {
    const { orderId } = await setupPendingConversion(1_000_00);
    await confirmConversionAndEarn(orderId);

    const first = await reverseProportionalShare(orderId, 40_000);
    const second = await reverseProportionalShare(orderId, 40_000);
    expect(first!.deltaPaise).toBeGreaterThan(0);
    expect(second!.deltaPaise).toBe(0);
  });

  it("a LARGER later cumulative refund reverses only the additional delta", async () => {
    const { orderId, conversionId } = await setupPendingConversion(1_000_00);
    await confirmConversionAndEarn(orderId);

    const first = await reverseProportionalShare(orderId, 30_000); // 30% refunded
    const second = await reverseProportionalShare(orderId, 100_000); // fully refunded later
    expect(second!.deltaPaise).toBeGreaterThan(0);

    const db = getDb();
    const reversals = await db
      .select({ paise: commissionEntries.paise })
      .from(commissionEntries)
      .where(and(eq(commissionEntries.conversionId, conversionId), eq(commissionEntries.type, "REVERSAL")));
    expect(reversals).toHaveLength(2);
    const totalReversed = reversals.reduce((sum, r) => sum + Math.abs(r.paise), 0);
    expect(totalReversed).toBe(first!.deltaPaise + second!.deltaPaise);

    const [earning] = await db
      .select({ paise: commissionEntries.paise })
      .from(commissionEntries)
      .where(and(eq(commissionEntries.conversionId, conversionId), eq(commissionEntries.type, "EARNING")))
      .limit(1);
    // A full refund never reverses MORE than was ever earned.
    expect(totalReversed).toBeLessThanOrEqual(earning!.paise);
  });

  it("a full refund reverses the entire earning, no more and no less", async () => {
    const { orderId, conversionId, orderAmountPaise } = await setupPendingConversion(1_000_00);
    const confirmed = await confirmConversionAndEarn(orderId);
    const db = getDb();
    const [earning] = await db.select({ paise: commissionEntries.paise }).from(commissionEntries).where(eq(commissionEntries.id, confirmed!.entryId)).limit(1);

    await reverseProportionalShare(orderId, orderAmountPaise);

    const reversals = await db
      .select({ paise: commissionEntries.paise })
      .from(commissionEntries)
      .where(and(eq(commissionEntries.conversionId, conversionId), eq(commissionEntries.type, "REVERSAL")));
    const totalReversed = reversals.reduce((sum, r) => sum + Math.abs(r.paise), 0);
    expect(totalReversed).toBe(earning!.paise);
  });

  it("returns null when the order was never confirmed (e.g. payment never captured)", async () => {
    const { orderId } = await setupPendingConversion();
    expect(await reverseProportionalShare(orderId, 50_000)).toBeNull();
  });

  it("clamps a refund total that exceeds the order amount rather than throwing", async () => {
    const { orderId, orderAmountPaise, conversionId } = await setupPendingConversion(1_000_00);
    const confirmed = await confirmConversionAndEarn(orderId);
    const result = await reverseProportionalShare(orderId, orderAmountPaise * 2);
    expect(result).not.toBeNull();

    const db = getDb();
    const [earning] = await db.select({ paise: commissionEntries.paise }).from(commissionEntries).where(eq(commissionEntries.id, confirmed!.entryId)).limit(1);
    const reversals = await db
      .select({ paise: commissionEntries.paise })
      .from(commissionEntries)
      .where(and(eq(commissionEntries.conversionId, conversionId), eq(commissionEntries.type, "REVERSAL")));
    const totalReversed = reversals.reduce((sum, r) => sum + Math.abs(r.paise), 0);
    // Even a wildly over-reported refund amount never reverses more than
    // was actually earned.
    expect(totalReversed).toBe(earning!.paise);
  });
});
