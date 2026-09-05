import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { commissionEntries, payouts } from "@/lib/db/schema";
import {
  requestPayout,
  approvePayout,
  rejectPayout,
  markPayoutPaid,
  markPayoutFailed,
  NothingAvailableError,
  BelowMinimumError,
  OpenPayoutExistsError,
} from "@/lib/payouts/engine";
import { createPendingConversion, confirmConversionAndEarn } from "@/lib/commission/engine";
import { releaseMaturedCommissions } from "@/lib/commission/scheduler";
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

const PAST = new Date(Date.now() - 60_000);

/** Runs a real order through the full pipeline — pending conversion,
 * capture, hold-period maturity, and the real scheduler — so these tests
 * exercise requestPayout against a genuinely AVAILABLE entry, not a
 * fabricated one. */
async function setupAvailableEarning(orderAmountPaise: number) {
  const buyer = await createTestUser();
  const affiliateOwner = await createTestUser();
  const affiliate = await createTestAffiliate(affiliateOwner.id, "ACTIVE");
  const { planId } = await createTestServiceWithPlan(orderAmountPaise);
  const orderId = await createTestOrder(buyer.id, planId, orderAmountPaise);
  await createPendingConversion({ affiliateId: affiliate.id, orderId, orderAmountPaise });
  const confirmed = await confirmConversionAndEarn(orderId);

  const db = getDb();
  await db.update(commissionEntries).set({ holdUntil: PAST }).where(eq(commissionEntries.id, confirmed!.entryId));
  await releaseMaturedCommissions();

  const [entry] = await db.select({ status: commissionEntries.status, paise: commissionEntries.paise }).from(commissionEntries).where(eq(commissionEntries.id, confirmed!.entryId)).limit(1);
  expect(entry?.status).toBe("AVAILABLE"); // sanity: the fixture itself must produce AVAILABLE money

  return { affiliateId: affiliate.id, entryId: confirmed!.entryId, earningPaise: entry!.paise };
}

describe("requestPayout", () => {
  it("computes gross/TDS/net correctly and claims the entry", async () => {
    // 10% commission on ₹20,000 = ₹2,000 earned — comfortably above the ₹1,000 minimum.
    const { affiliateId, entryId, earningPaise } = await setupAvailableEarning(2_000_000);

    const result = await requestPayout(affiliateId);
    expect(result.grossPaise).toBe(earningPaise);
    expect(result.tdsPaise).toBe(Math.floor((earningPaise * 500) / 10_000)); // seeded default: 5%
    expect(result.netPaise).toBe(result.grossPaise - result.tdsPaise);

    const db = getDb();
    const [entry] = await db.select({ payoutId: commissionEntries.payoutId }).from(commissionEntries).where(eq(commissionEntries.id, entryId)).limit(1);
    expect(entry?.payoutId).toBe(result.payoutId);

    const [payout] = await db.select().from(payouts).where(eq(payouts.id, result.payoutId)).limit(1);
    expect(payout?.status).toBe("REQUESTED");
    expect(payout?.netPaise).toBe(payout!.grossPaise - payout!.tdsPaise); // matches the DB CHECK constraint
  });

  it("refuses a payout below the minimum", async () => {
    // 10% of ₹10 = ₹1 — far below the ₹1,000 minimum.
    const { affiliateId } = await setupAvailableEarning(1_000);
    await expect(requestPayout(affiliateId)).rejects.toBeInstanceOf(BelowMinimumError);
  });

  it("refuses a payout when nothing is available", async () => {
    const affiliateOwner = await createTestUser();
    const affiliate = await createTestAffiliate(affiliateOwner.id, "ACTIVE");
    await expect(requestPayout(affiliate.id)).rejects.toBeInstanceOf(NothingAvailableError);
  });

  it("refuses a second payout while one is already open, even once new money becomes available", async () => {
    const { affiliateId } = await setupAvailableEarning(2_000_000);
    await requestPayout(affiliateId); // claims the first earning entirely — nothing left unclaimed

    // A second, independent conversion for the same affiliate matures and
    // releases while the first payout is still open.
    const buyer2 = await createTestUser();
    const { planId: plan2 } = await createTestServiceWithPlan(2_000_000);
    const order2 = await createTestOrder(buyer2.id, plan2, 2_000_000);
    await createPendingConversion({ affiliateId, orderId: order2, orderAmountPaise: 2_000_000 });
    const confirmed2 = await confirmConversionAndEarn(order2);
    const db = getDb();
    await db.update(commissionEntries).set({ holdUntil: PAST }).where(eq(commissionEntries.id, confirmed2!.entryId));
    await releaseMaturedCommissions();

    // Now there IS unclaimed available money, but an open payout already
    // exists — the database's partial unique index is what actually
    // rejects this, not "nothing available".
    await expect(requestPayout(affiliateId)).rejects.toBeInstanceOf(OpenPayoutExistsError);
  });

  it("a concurrent second request for the same affiliate never double-claims", async () => {
    const { affiliateId } = await setupAvailableEarning(2_000_000);
    const results = await Promise.allSettled([requestPayout(affiliateId), requestPayout(affiliateId)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});

describe("rejectPayout", () => {
  it("unclaims entries so a fresh request can claim them again", async () => {
    const { affiliateId, entryId } = await setupAvailableEarning(2_000_000);
    const first = await requestPayout(affiliateId);

    await rejectPayout(first.payoutId, "test rejection");

    const db = getDb();
    const [entry] = await db.select({ payoutId: commissionEntries.payoutId, status: commissionEntries.status }).from(commissionEntries).where(eq(commissionEntries.id, entryId)).limit(1);
    expect(entry?.payoutId).toBeNull();
    expect(entry?.status).toBe("AVAILABLE"); // still available, just unclaimed

    const second = await requestPayout(affiliateId); // no OpenPayoutExistsError — REJECTED isn't "open"
    expect(second.payoutId).not.toBe(first.payoutId);
    // A fresh idempotency key, not the one from the failed/rejected attempt.
    const [firstRow] = await db.select({ idempotencyKey: payouts.idempotencyKey }).from(payouts).where(eq(payouts.id, first.payoutId)).limit(1);
    const [secondRow] = await db.select({ idempotencyKey: payouts.idempotencyKey }).from(payouts).where(eq(payouts.id, second.payoutId)).limit(1);
    expect(secondRow?.idempotencyKey).not.toBe(firstRow?.idempotencyKey);
  });
});

describe("markPayoutFailed", () => {
  it("unclaims entries for a retry, exactly like reject", async () => {
    const { affiliateId, entryId } = await setupAvailableEarning(2_000_000);
    const first = await requestPayout(affiliateId);
    await approvePayout(first.payoutId, (await createTestUser()).id);

    await markPayoutFailed(first.payoutId, "bank transfer failed");

    const db = getDb();
    const [entry] = await db.select({ payoutId: commissionEntries.payoutId }).from(commissionEntries).where(eq(commissionEntries.id, entryId)).limit(1);
    expect(entry?.payoutId).toBeNull();

    const second = await requestPayout(affiliateId);
    expect(second.payoutId).not.toBe(first.payoutId);
  });
});

describe("markPayoutPaid", () => {
  it("moves the payout and its claimed entries to PAID", async () => {
    const { affiliateId, entryId } = await setupAvailableEarning(2_000_000);
    const result = await requestPayout(affiliateId);
    const approver = await createTestUser();
    await approvePayout(result.payoutId, approver.id);

    await markPayoutPaid(result.payoutId, "razorpayx_txn_123");

    const db = getDb();
    const [payout] = await db.select({ status: payouts.status, providerReference: payouts.providerReference }).from(payouts).where(eq(payouts.id, result.payoutId)).limit(1);
    expect(payout?.status).toBe("PAID");
    expect(payout?.providerReference).toBe("razorpayx_txn_123");

    const [entry] = await db.select({ status: commissionEntries.status }).from(commissionEntries).where(eq(commissionEntries.id, entryId)).limit(1);
    expect(entry?.status).toBe("PAID");
  });

  it("is idempotent against a replayed call", async () => {
    const { affiliateId } = await setupAvailableEarning(2_000_000);
    const result = await requestPayout(affiliateId);
    await approvePayout(result.payoutId, (await createTestUser()).id);

    await markPayoutPaid(result.payoutId, "ref-1");
    await expect(markPayoutPaid(result.payoutId, "ref-2")).resolves.toBeUndefined();

    const db = getDb();
    const [payout] = await db.select({ providerReference: payouts.providerReference }).from(payouts).where(eq(payouts.id, result.payoutId)).limit(1);
    // The first call's reference wins — a replay never overwrites a settled payout.
    expect(payout?.providerReference).toBe("ref-1");
  });
});
