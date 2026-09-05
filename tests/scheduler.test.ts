import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { commissionEntries, affiliates } from "@/lib/db/schema";
import { releaseMaturedCommissions } from "@/lib/commission/scheduler";
import { createPendingConversion, confirmConversionAndEarn, reverseProportionalShare } from "@/lib/commission/engine";
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

async function setupEarning(orderAmountPaise = 1_000_00) {
  const buyer = await createTestUser();
  const affiliateOwner = await createTestUser();
  const affiliate = await createTestAffiliate(affiliateOwner.id, "ACTIVE");
  const { planId } = await createTestServiceWithPlan(orderAmountPaise);
  const orderId = await createTestOrder(buyer.id, planId, orderAmountPaise);
  await createPendingConversion({ affiliateId: affiliate.id, orderId, orderAmountPaise });
  const confirmed = await confirmConversionAndEarn(orderId);
  return { orderId, affiliateId: affiliate.id, entryId: confirmed!.entryId, orderAmountPaise };
}

async function setHoldUntil(entryId: string, when: Date) {
  const db = getDb();
  await db.update(commissionEntries).set({ holdUntil: when }).where(eq(commissionEntries.id, entryId));
}

const PAST = new Date(Date.now() - 60_000);
const FAR_FUTURE = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);

describe("releaseMaturedCommissions: hold period", () => {
  it("does not release an entry whose hold period hasn't matured", async () => {
    const { entryId } = await setupEarning();
    await setHoldUntil(entryId, FAR_FUTURE);

    await releaseMaturedCommissions();

    const db = getDb();
    const [entry] = await db.select({ status: commissionEntries.status }).from(commissionEntries).where(eq(commissionEntries.id, entryId)).limit(1);
    expect(entry?.status).toBe("PENDING");
  });

  it("releases an entry whose hold period has matured and everything checks out", async () => {
    const { entryId } = await setupEarning();
    await setHoldUntil(entryId, PAST);

    const summary = await releaseMaturedCommissions();
    expect(summary.acquired).toBe(true);
    expect(summary.itemsReleased).toBeGreaterThanOrEqual(1);

    const db = getDb();
    const [entry] = await db.select({ status: commissionEntries.status }).from(commissionEntries).where(eq(commissionEntries.id, entryId)).limit(1);
    expect(entry?.status).toBe("AVAILABLE");
  });
});

describe("releaseMaturedCommissions: from-source verification", () => {
  it("does not release when the affiliate has been suspended since earning", async () => {
    const { entryId, affiliateId } = await setupEarning();
    await setHoldUntil(entryId, PAST);
    const db = getDb();
    await db.update(affiliates).set({ status: "SUSPENDED" }).where(eq(affiliates.id, affiliateId));

    await releaseMaturedCommissions();

    const [entry] = await db.select({ status: commissionEntries.status }).from(commissionEntries).where(eq(commissionEntries.id, entryId)).limit(1);
    expect(entry?.status).toBe("PENDING");
  });

  it("does not release an entry a payout already claims", async () => {
    const { entryId } = await setupEarning();
    await setHoldUntil(entryId, PAST);
    const db = getDb();
    await db.update(commissionEntries).set({ payoutId: randomUUID() }).where(eq(commissionEntries.id, entryId));

    await releaseMaturedCommissions();

    const [entry] = await db.select({ status: commissionEntries.status }).from(commissionEntries).where(eq(commissionEntries.id, entryId)).limit(1);
    expect(entry?.status).toBe("PENDING");
  });

  it("is idempotent: running twice in a row only releases once and doesn't error", async () => {
    const { entryId } = await setupEarning();
    await setHoldUntil(entryId, PAST);

    await releaseMaturedCommissions();
    const second = await releaseMaturedCommissions();

    // Second run finds nothing left in PENDING+matured for this entry.
    const db = getDb();
    const [entry] = await db.select({ status: commissionEntries.status }).from(commissionEntries).where(eq(commissionEntries.id, entryId)).limit(1);
    expect(entry?.status).toBe("AVAILABLE");
    expect(second.acquired).toBe(true);
  });
});

describe("releaseMaturedCommissions: advisory lock mutual exclusion", () => {
  it("a second concurrent run acquires nothing while the first still holds the lock", async () => {
    // Create enough matured candidates that the first run's per-row loop
    // takes measurably longer than an instant, so the second call's lock
    // attempt genuinely lands while the first still holds it.
    const entries = await Promise.all(Array.from({ length: 5 }, () => setupEarning()));
    await Promise.all(entries.map((e) => setHoldUntil(e.entryId, PAST)));

    const [first, second] = await Promise.all([releaseMaturedCommissions(), releaseMaturedCommissions()]);

    const outcomes = [first, second];
    const acquiredCount = outcomes.filter((o) => o.acquired).length;
    expect(acquiredCount).toBeGreaterThanOrEqual(1);
    // Every entry ends up released exactly once, by whichever run acquired
    // the lock — never both, never neither.
    const db = getDb();
    for (const e of entries) {
      const [entry] = await db.select({ status: commissionEntries.status }).from(commissionEntries).where(eq(commissionEntries.id, e.entryId)).limit(1);
      expect(entry?.status).toBe("AVAILABLE");
    }
  });
});

describe("release/reversal race: the available balance is always correct", () => {
  it("a refund landing concurrently with release still nets to the right available balance", async () => {
    const { orderId, entryId, affiliateId, orderAmountPaise } = await setupEarning(1_000_00);
    await setHoldUntil(entryId, PAST);

    // Run the scheduler's release and a 40% refund's reversal
    // concurrently — real row-locking (FOR UPDATE) on the earning row
    // serializes them for real, regardless of which "wins" the race.
    await Promise.all([releaseMaturedCommissions(), reverseProportionalShare(orderId, Math.floor(orderAmountPaise * 0.4))]);

    const db = getDb();
    const rows = await db
      .select({ paise: commissionEntries.paise, status: commissionEntries.status, type: commissionEntries.type })
      .from(commissionEntries)
      .where(eq(commissionEntries.affiliateId, affiliateId));

    const [earning] = rows.filter((r) => r.type === "EARNING");
    const reversals = rows.filter((r) => r.type === "REVERSAL");
    expect(reversals).toHaveLength(1);

    const availableSum = rows.filter((r) => r.status === "AVAILABLE").reduce((sum, r) => sum + r.paise, 0);
    const expectedNet = earning!.paise + reversals[0]!.paise;

    // Whichever order the race resolved in, both rows must have ended up
    // AVAILABLE together — never one without the other, which would
    // otherwise show a transiently wrong balance.
    expect(availableSum).toBe(expectedNet);
    expect(availableSum).toBeGreaterThan(0);
    expect(availableSum).toBeLessThan(earning!.paise);
  });

  it("a reversal written before release, then released later, nets correctly", async () => {
    const { orderId, entryId, affiliateId, orderAmountPaise } = await setupEarning(1_000_00);
    // Reversal happens first, while the earning is still PENDING (hold not yet set to the past).
    const reversal = await reverseProportionalShare(orderId, Math.floor(orderAmountPaise * 0.3));
    expect(reversal!.deltaPaise).toBeGreaterThan(0);

    const db = getDb();
    const [reversalRow] = await db
      .select({ status: commissionEntries.status })
      .from(commissionEntries)
      .where(and(eq(commissionEntries.affiliateId, affiliateId), eq(commissionEntries.type, "REVERSAL")))
      .limit(1);
    // Written PENDING because the earning hadn't been released yet.
    expect(reversalRow?.status).toBe("PENDING");

    await setHoldUntil(entryId, PAST);
    await releaseMaturedCommissions();

    const rows = await db
      .select({ paise: commissionEntries.paise, status: commissionEntries.status, type: commissionEntries.type })
      .from(commissionEntries)
      .where(eq(commissionEntries.affiliateId, affiliateId));
    expect(rows.every((r) => r.status === "AVAILABLE")).toBe(true);
    const net = rows.reduce((sum, r) => sum + r.paise, 0);
    expect(net).toBeGreaterThan(0);
    expect(net).toBeLessThan(rows.find((r) => r.type === "EARNING")!.paise);
  });

  it("a reversal written after release is immediately AVAILABLE (visible right away)", async () => {
    const { orderId, entryId, orderAmountPaise, affiliateId } = await setupEarning(1_000_00);
    await setHoldUntil(entryId, PAST);
    await releaseMaturedCommissions();

    const reversal = await reverseProportionalShare(orderId, Math.floor(orderAmountPaise * 0.2));
    expect(reversal!.deltaPaise).toBeGreaterThan(0);

    const db = getDb();
    const [reversalRow] = await db
      .select({ status: commissionEntries.status })
      .from(commissionEntries)
      .where(and(eq(commissionEntries.affiliateId, affiliateId), eq(commissionEntries.type, "REVERSAL")))
      .limit(1);
    expect(reversalRow?.status).toBe("AVAILABLE");
  });
});
