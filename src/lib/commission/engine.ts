/**
 * The commission engine's write paths (Phase 4). Every write here goes
 * through a row-locked transaction on the conversion, so two concurrent
 * webhook deliveries for the same order can never both write an EARNING
 * entry, and a refund landing mid-computation can never race a capture.
 *
 * Scope note: Phase 12's scheduler (PENDING -> APPROVED -> AVAILABLE ->
 * PAID) is not built yet, so an EARNING entry's status is written as
 * PENDING and never advances in this build — see STATUS.md. The original
 * EARNING row's paise/type/conversionId are never mutated after creation
 * (Rule 2); only new REVERSAL rows are appended.
 */
import { and, eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { affiliateConversions, commissionEntries, commissionPolicies } from "@/lib/db/schema";
import { proportionalSharePaise } from "@/lib/money";

export async function getActivePolicy() {
  const db = getDb();
  const [policy] = await db
    .select()
    .from(commissionPolicies)
    .orderBy(desc(commissionPolicies.effectiveFrom))
    .limit(1);
  if (!policy) throw new Error("No commission policy configured — run npm run seed:catalogue.");
  return policy;
}

/** Called at order-creation time when a valid attribution cookie is
 * present. Snapshots the commission rate NOW, so a later admin rate
 * change never rewrites this order's history. */
export async function createPendingConversion(params: {
  affiliateId: string;
  affiliateClickId?: string;
  orderId: string;
  orderAmountPaise: number;
}): Promise<string> {
  const db = getDb();
  const policy = await getActivePolicy();
  const [row] = await db
    .insert(affiliateConversions)
    .values({
      affiliateId: params.affiliateId,
      affiliateClickId: params.affiliateClickId,
      orderId: params.orderId,
      status: "PENDING",
      commissionRateBasisPoints: policy.commissionRateBasisPoints,
      orderAmountPaise: params.orderAmountPaise,
    })
    .returning({ id: affiliateConversions.id });
  if (!row) throw new Error("failed to create conversion");
  return row.id;
}

export interface ConfirmResult {
  conversionId: string;
  entryId: string;
}

/**
 * Called from the webhook's `payment.captured` handler. Idempotent: a
 * replayed capture for an order whose conversion is already CONFIRMED
 * returns the existing entry rather than writing a second one (defense in
 * depth alongside the webhook_events dedup and the database's own
 * one-EARNING-per-conversion partial unique index).
 */
export async function confirmConversionAndEarn(orderId: string): Promise<ConfirmResult | null> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [conversion] = await tx
      .select()
      .from(affiliateConversions)
      .where(eq(affiliateConversions.orderId, orderId))
      .for("update")
      .limit(1);
    if (!conversion) return null; // this order was never attributed to an affiliate

    if (conversion.status === "CONFIRMED") {
      const [existing] = await tx
        .select({ id: commissionEntries.id })
        .from(commissionEntries)
        .where(and(eq(commissionEntries.conversionId, conversion.id), eq(commissionEntries.type, "EARNING")))
        .limit(1);
      return existing ? { conversionId: conversion.id, entryId: existing.id } : null;
    }
    if (conversion.status === "CANCELLED") return null;

    const earningPaise = proportionalSharePaise(
      conversion.orderAmountPaise,
      conversion.commissionRateBasisPoints,
      10_000,
    );

    await tx
      .update(affiliateConversions)
      .set({ status: "CONFIRMED", updatedAt: new Date() })
      .where(eq(affiliateConversions.id, conversion.id));

    const [entry] = await tx
      .insert(commissionEntries)
      .values({
        affiliateId: conversion.affiliateId,
        conversionId: conversion.id,
        type: "EARNING",
        status: "PENDING",
        paise: earningPaise,
      })
      .returning({ id: commissionEntries.id });
    if (!entry) throw new Error("failed to write EARNING entry");

    return { conversionId: conversion.id, entryId: entry.id };
  });
}

/** Called from the webhook's `payment.failed` handler. Rule: CANCELLED
 * means the order never completed — nothing was earned, so this never
 * writes a commission_entries row, only marks the conversion CANCELLED. */
export async function cancelConversion(orderId: string): Promise<void> {
  const db = getDb();
  await db
    .update(affiliateConversions)
    .set({ status: "CANCELLED", updatedAt: new Date() })
    .where(and(eq(affiliateConversions.orderId, orderId), eq(affiliateConversions.status, "PENDING")));
}

export interface ReversalResult {
  /** Paise actually reversed by THIS call — 0 if the cumulative refund
   * amount is already fully reflected (a webhook replay, or a delivery
   * that doesn't move the cumulative total forward). */
  deltaPaise: number;
}

/**
 * Called from the webhook's refund handlers with the provider's
 * CUMULATIVE refunded amount (Rule 10 — never a locally-incremented
 * counter). Computes the total proportional reversal owed at this
 * cumulative amount, subtracts what has already been reversed, and
 * writes only the delta — so calling this twice with the same cumulative
 * amount is a no-op the second time, and calling it with a larger
 * cumulative amount (a second, later partial refund) reverses only the
 * additional share.
 */
export async function reverseProportionalShare(
  orderId: string,
  cumulativeAmountRefundedPaise: number,
): Promise<ReversalResult | null> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [conversion] = await tx
      .select()
      .from(affiliateConversions)
      .where(eq(affiliateConversions.orderId, orderId))
      .for("update")
      .limit(1);
    if (!conversion || conversion.status !== "CONFIRMED") return null;

    const [earning] = await tx
      .select()
      .from(commissionEntries)
      .where(and(eq(commissionEntries.conversionId, conversion.id), eq(commissionEntries.type, "EARNING")))
      .limit(1);
    if (!earning) return null; // nothing was ever earned on this conversion

    // Clamp defensively: a provider-reported refund total should never
    // exceed what was charged, but never let a bad delivery throw here.
    const numerator = Math.min(cumulativeAmountRefundedPaise, conversion.orderAmountPaise);
    const targetReversal = proportionalSharePaise(earning.paise, numerator, conversion.orderAmountPaise);

    const existingReversals = await tx
      .select({ paise: commissionEntries.paise })
      .from(commissionEntries)
      .where(and(eq(commissionEntries.conversionId, conversion.id), eq(commissionEntries.type, "REVERSAL")));
    const alreadyReversed = existingReversals.reduce((sum, r) => sum + Math.abs(r.paise), 0);

    const delta = targetReversal - alreadyReversed;
    if (delta <= 0) return { deltaPaise: 0 };

    await tx.insert(commissionEntries).values({
      affiliateId: conversion.affiliateId,
      conversionId: conversion.id,
      type: "REVERSAL",
      status: "REVERSED",
      paise: -delta,
      reversalOfEntryId: earning.id,
      reason: "proportional reversal from payment refund webhook",
    });

    return { deltaPaise: delta };
  });
}
