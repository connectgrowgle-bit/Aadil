/**
 * Payout claiming (Phase 12's other half): moves released commission from
 * AVAILABLE into a payout and, once disbursed, to PAID. Disbursement
 * itself (RazorpayX/Cashfree Payouts) is not built — `markPayoutPaid` is
 * a stand-in for what that provider's webhook would eventually call.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { commissionEntries, payouts } from "@/lib/db/schema";
import { getActivePolicy } from "@/lib/commission/engine";

export class NothingAvailableError extends Error {
  constructor() {
    super("No available commission to pay out.");
    this.name = "NothingAvailableError";
  }
}

export class BelowMinimumError extends Error {
  constructor(public readonly minimumPaise: number) {
    super(`Available balance is below the ₹${(minimumPaise / 100).toFixed(2)} minimum payout.`);
    this.name = "BelowMinimumError";
  }
}

export class OpenPayoutExistsError extends Error {
  constructor() {
    super("An open payout already exists for this affiliate.");
    this.name = "OpenPayoutExistsError";
  }
}

/** Walks `.cause` chains because Drizzle wraps driver errors — checking
 * only `error.message` for "duplicate key" is exactly spec's own mistake
 * #4 (the wrapped message is just the failed SQL, not the driver's
 * reason), so this checks the actual PG SQLSTATE instead. */
function isUniqueViolation(err: unknown): boolean {
  let cursor: unknown = err;
  while (cursor && typeof cursor === "object") {
    if ("code" in cursor && (cursor as { code?: unknown }).code === "23505") return true;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return false;
}

export interface PayoutResult {
  payoutId: string;
  grossPaise: number;
  tdsPaise: number;
  netPaise: number;
}

/**
 * Row-locks every currently AVAILABLE, unclaimed entry for this affiliate
 * before computing gross/TDS/net, so a concurrent request for the same
 * affiliate blocks on the lock rather than racing over which entries get
 * claimed. The database's own partial unique index (one open payout per
 * affiliate) is the second, authoritative guard — if it rejects the
 * insert, nothing has been claimed yet and this throws
 * OpenPayoutExistsError cleanly rather than leaving entries half-claimed.
 */
export async function requestPayout(affiliateId: string): Promise<PayoutResult> {
  const db = getDb();
  const policy = await getActivePolicy();

  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: commissionEntries.id, paise: commissionEntries.paise })
      .from(commissionEntries)
      .where(
        and(
          eq(commissionEntries.affiliateId, affiliateId),
          eq(commissionEntries.status, "AVAILABLE"),
          isNull(commissionEntries.payoutId),
        ),
      )
      .for("update");

    const grossPaise = candidates.reduce((sum, c) => sum + c.paise, 0);
    if (grossPaise <= 0) throw new NothingAvailableError();
    if (grossPaise < policy.payoutMinimumPaise) throw new BelowMinimumError(policy.payoutMinimumPaise);

    const tdsPaise = Math.floor((grossPaise * policy.tdsRateBasisPoints) / 10_000);
    const netPaise = grossPaise - tdsPaise;

    let payoutId: string;
    try {
      const [payout] = await tx
        .insert(payouts)
        .values({
          affiliateId,
          status: "REQUESTED",
          grossPaise,
          tdsPaise,
          netPaise,
          // A fresh key every request — never derived from the entry set —
          // so a retry after a failed transfer (a new call to this
          // function, after markPayoutFailed unclaims the old entries)
          // gets its own key instead of reusing one already burned by the
          // failed attempt (spec's own mistake #6).
          idempotencyKey: randomUUID(),
        })
        .returning({ id: payouts.id });
      if (!payout) throw new Error("failed to create payout");
      payoutId = payout.id;
    } catch (err) {
      if (isUniqueViolation(err)) throw new OpenPayoutExistsError();
      throw err;
    }

    await tx
      .update(commissionEntries)
      .set({ payoutId, updatedAt: new Date() })
      .where(
        inArray(
          commissionEntries.id,
          candidates.map((c) => c.id),
        ),
      );

    return { payoutId, grossPaise, tdsPaise, netPaise };
  });
}

export async function approvePayout(payoutId: string, approvedByUserId: string): Promise<void> {
  const db = getDb();
  await db
    .update(payouts)
    .set({ status: "APPROVED", approvedByUserId, approvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(payouts.id, payoutId), eq(payouts.status, "REQUESTED")));
}

/** Unclaims every entry the payout held, so a fresh requestPayout can
 * claim them again immediately — REJECTED is not in the partial unique
 * index's "open" set, so nothing blocks a new request right after. */
export async function rejectPayout(payoutId: string, reason: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [payout] = await tx.select({ status: payouts.status }).from(payouts).where(eq(payouts.id, payoutId)).for("update").limit(1);
    if (!payout) throw new Error(`payout ${payoutId} not found`);
    if (payout.status !== "REQUESTED" && payout.status !== "APPROVED") return; // already resolved — no-op

    await tx.update(payouts).set({ status: "REJECTED", failureReason: reason, updatedAt: new Date() }).where(eq(payouts.id, payoutId));
    await tx.update(commissionEntries).set({ payoutId: null, updatedAt: new Date() }).where(eq(commissionEntries.payoutId, payoutId));
  });
}

/** Stands in for the RazorpayX/Cashfree disbursement webhook this build
 * doesn't have — moves the claimed entries from AVAILABLE to PAID
 * atomically with the payout itself. Idempotent against replay. */
export async function markPayoutPaid(payoutId: string, providerReference: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [payout] = await tx.select({ status: payouts.status }).from(payouts).where(eq(payouts.id, payoutId)).for("update").limit(1);
    if (!payout) throw new Error(`payout ${payoutId} not found`);
    if (payout.status === "PAID") return; // replay — no-op
    if (payout.status !== "APPROVED" && payout.status !== "PROCESSING") {
      throw new Error(`cannot mark payout ${payoutId} paid from status ${payout.status}`);
    }

    await tx.update(payouts).set({ status: "PAID", providerReference, paidAt: new Date(), updatedAt: new Date() }).where(eq(payouts.id, payoutId));
    await tx
      .update(commissionEntries)
      .set({ status: "PAID", updatedAt: new Date() })
      .where(and(eq(commissionEntries.payoutId, payoutId), eq(commissionEntries.status, "AVAILABLE")));
  });
}

/** A failed transfer attempt: unclaims the entries (spec's mistake #6 —
 * they must be claimable by a fresh requestPayout, with a fresh
 * idempotency key, not stuck behind this payout forever). */
export async function markPayoutFailed(payoutId: string, reason: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [payout] = await tx.select({ status: payouts.status }).from(payouts).where(eq(payouts.id, payoutId)).for("update").limit(1);
    if (!payout) throw new Error(`payout ${payoutId} not found`);
    if (payout.status === "PAID" || payout.status === "FAILED") return;

    await tx.update(payouts).set({ status: "FAILED", failureReason: reason, updatedAt: new Date() }).where(eq(payouts.id, payoutId));
    await tx.update(commissionEntries).set({ payoutId: null, updatedAt: new Date() }).where(eq(commissionEntries.payoutId, payoutId));
  });
}
