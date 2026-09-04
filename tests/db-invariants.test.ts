/**
 * Proves the hand-written manual migrations (drizzle/manual/*.sql) are
 * actually enforced by the database, not just present as application-level
 * checks. Every test here tries to write an invalid row directly via
 * Drizzle and asserts the database itself rejects it — Rule 3: "partial
 * unique indexes enforce the invariants, not application code."
 */
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { commissionEntries, payouts, affiliateKyc } from "@/lib/db/schema";
import { createConversionFixture, createTestUser, createTestAffiliate } from "./helpers/fixtures";

describe("commission_entries: one EARNING per conversion (partial unique index)", () => {
  it("allows the first EARNING for a conversion", async () => {
    const db = getDb();
    const fixture = await createConversionFixture();
    await expect(
      db.insert(commissionEntries).values({
        affiliateId: fixture.affiliateId,
        conversionId: fixture.conversionId,
        type: "EARNING",
        paise: 10_000,
      }),
    ).resolves.toBeDefined();
  });

  it("rejects a second EARNING for the same conversion", async () => {
    const db = getDb();
    const fixture = await createConversionFixture();
    await db.insert(commissionEntries).values({
      affiliateId: fixture.affiliateId,
      conversionId: fixture.conversionId,
      type: "EARNING",
      paise: 10_000,
    });

    await expect(
      db.insert(commissionEntries).values({
        affiliateId: fixture.affiliateId,
        conversionId: fixture.conversionId,
        type: "EARNING",
        paise: 10_000, // a duplicate/race-condition double-earn attempt
      }),
    ).rejects.toThrow();
  });

  it("allows MULTIPLE REVERSAL rows against the same conversion (partial refunds)", async () => {
    const db = getDb();
    const fixture = await createConversionFixture();
    await db.insert(commissionEntries).values({
      affiliateId: fixture.affiliateId,
      conversionId: fixture.conversionId,
      type: "EARNING",
      paise: 10_000,
    });

    await expect(
      db.insert(commissionEntries).values({
        affiliateId: fixture.affiliateId,
        conversionId: fixture.conversionId,
        type: "REVERSAL",
        paise: -3_000,
      }),
    ).resolves.toBeDefined();
    await expect(
      db.insert(commissionEntries).values({
        affiliateId: fixture.affiliateId,
        conversionId: fixture.conversionId,
        type: "REVERSAL",
        paise: -2_000,
      }),
    ).resolves.toBeDefined();
  });
});

describe("commission_entries: sign CHECK constraints", () => {
  it("rejects an EARNING with non-positive paise", async () => {
    const db = getDb();
    const fixture = await createConversionFixture();
    await expect(
      db.insert(commissionEntries).values({
        affiliateId: fixture.affiliateId,
        conversionId: fixture.conversionId,
        type: "EARNING",
        paise: -5_000,
      }),
    ).rejects.toThrow();
  });

  it("rejects a REVERSAL with non-negative paise", async () => {
    const db = getDb();
    const fixture = await createConversionFixture();
    await db.insert(commissionEntries).values({
      affiliateId: fixture.affiliateId,
      conversionId: fixture.conversionId,
      type: "EARNING",
      paise: 10_000,
    });
    await expect(
      db.insert(commissionEntries).values({
        affiliateId: fixture.affiliateId,
        conversionId: fixture.conversionId,
        type: "REVERSAL",
        paise: 5_000, // should be negative
      }),
    ).rejects.toThrow();
  });

  it("allows an ADJUSTMENT of either sign (manual corrections)", async () => {
    const db = getDb();
    const fixture = await createConversionFixture();
    await expect(
      db.insert(commissionEntries).values({
        affiliateId: fixture.affiliateId,
        conversionId: fixture.conversionId,
        type: "ADJUSTMENT",
        paise: 500,
        reason: "manual correction, test",
      }),
    ).resolves.toBeDefined();
  });
});

describe("payouts: one open payout per affiliate (partial unique index)", () => {
  async function newAffiliate() {
    const user = await createTestUser();
    return createTestAffiliate(user.id);
  }

  it("allows the first REQUESTED payout for an affiliate", async () => {
    const db = getDb();
    const affiliate = await newAffiliate();
    await expect(
      db.insert(payouts).values({
        affiliateId: affiliate.id,
        status: "REQUESTED",
        grossPaise: 10_000,
        tdsPaise: 500,
        netPaise: 9_500,
        idempotencyKey: `test-${affiliate.id}-1`,
      }),
    ).resolves.toBeDefined();
  });

  it("rejects a second open payout for the same affiliate", async () => {
    const db = getDb();
    const affiliate = await newAffiliate();
    await db.insert(payouts).values({
      affiliateId: affiliate.id,
      status: "APPROVED",
      grossPaise: 10_000,
      tdsPaise: 500,
      netPaise: 9_500,
      idempotencyKey: `test-${affiliate.id}-1`,
    });

    await expect(
      db.insert(payouts).values({
        affiliateId: affiliate.id,
        status: "REQUESTED", // still "open"
        grossPaise: 5_000,
        tdsPaise: 250,
        netPaise: 4_750,
        idempotencyKey: `test-${affiliate.id}-2`,
      }),
    ).rejects.toThrow();
  });

  it("allows a new payout once the prior one reached a terminal status (PAID)", async () => {
    const db = getDb();
    const affiliate = await newAffiliate();
    const [first] = await db
      .insert(payouts)
      .values({
        affiliateId: affiliate.id,
        status: "REQUESTED",
        grossPaise: 10_000,
        tdsPaise: 500,
        netPaise: 9_500,
        idempotencyKey: `test-${affiliate.id}-1`,
      })
      .returning({ id: payouts.id });

    await db.update(payouts).set({ status: "PAID" }).where(eq(payouts.id, first!.id));

    await expect(
      db.insert(payouts).values({
        affiliateId: affiliate.id,
        status: "REQUESTED",
        grossPaise: 5_000,
        tdsPaise: 250,
        netPaise: 4_750,
        idempotencyKey: `test-${affiliate.id}-2`,
      }),
    ).resolves.toBeDefined();
  });

  it("rejects net_paise != gross_paise - tds_paise (CHECK constraint)", async () => {
    const db = getDb();
    const affiliate = await newAffiliate();
    await expect(
      db.insert(payouts).values({
        affiliateId: affiliate.id,
        status: "REQUESTED",
        grossPaise: 10_000,
        tdsPaise: 500,
        netPaise: 8_000, // wrong: should be 9,500
        idempotencyKey: `test-${affiliate.id}-bad`,
      }),
    ).rejects.toThrow();
  });
});

describe("affiliate_kyc: one active submission per affiliate (partial unique index)", () => {
  async function newAffiliate() {
    const user = await createTestUser();
    return createTestAffiliate(user.id);
  }

  it("allows the first SUBMITTED KYC row", async () => {
    const db = getDb();
    const affiliate = await newAffiliate();
    await expect(
      db.insert(affiliateKyc).values({ affiliateId: affiliate.id, status: "SUBMITTED" }),
    ).resolves.toBeDefined();
  });

  it("rejects a second SUBMITTED/APPROVED row while one is already active", async () => {
    const db = getDb();
    const affiliate = await newAffiliate();
    await db.insert(affiliateKyc).values({ affiliateId: affiliate.id, status: "APPROVED" });

    await expect(
      db.insert(affiliateKyc).values({ affiliateId: affiliate.id, status: "SUBMITTED" }),
    ).rejects.toThrow();
  });

  it("allows a resubmission after the prior row was REJECTED (not 'active')", async () => {
    const db = getDb();
    const affiliate = await newAffiliate();
    await db.insert(affiliateKyc).values({ affiliateId: affiliate.id, status: "REJECTED" });

    await expect(
      db.insert(affiliateKyc).values({ affiliateId: affiliate.id, status: "SUBMITTED" }),
    ).resolves.toBeDefined();
  });

  it("allows multiple DRAFT rows (not constrained — only SUBMITTED/APPROVED are 'active')", async () => {
    const db = getDb();
    const affiliate = await newAffiliate();
    await db.insert(affiliateKyc).values({ affiliateId: affiliate.id, status: "DRAFT" });
    await expect(
      db.insert(affiliateKyc).values({ affiliateId: affiliate.id, status: "DRAFT" }),
    ).resolves.toBeDefined();
  });
});
