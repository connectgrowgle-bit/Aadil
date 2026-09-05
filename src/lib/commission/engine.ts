/**
 * The commission engine's write paths (Phase 4/12). Every write here goes
 * through a row-locked transaction on the conversion, so two concurrent
 * webhook deliveries for the same order can never both write an EARNING
 * entry, and a refund landing mid-computation can never race a capture.
 *
 * Release lifecycle: an EARNING entry is written PENDING with a holdUntil
 * timestamp; src/lib/commission/scheduler.ts is what moves it to AVAILABLE
 * once matured and verified. A REVERSAL entry's initial status depends on
 * whether its sibling EARNING has already been released: if the earning
 * is still PENDING, the reversal is written PENDING too and the scheduler
 * releases both together (so SUM(paise) WHERE status='AVAILABLE' is never
 * transiently wrong — neither counts until release, then both do,
 * netting correctly); if the earning is already AVAILABLE or PAID, the
 * reversal is written AVAILABLE immediately, since that money already
 * left the "held" state and the clawback must show up right away. The
 * EARNING row's own paise/type/conversionId are never mutated after
 * creation (Rule 2) — only its status advances, and only forward.
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

    // The hold period is read at capture time (when money is actually
    // earned), not snapshotted earlier at click/pending time — a policy
    // change affects only conversions not yet captured, which is the
    // more defensible application point for a hold-period change.
    const policy = await getActivePolicy();
    const holdUntil = new Date(Date.now() + policy.holdPeriodDays * 24 * 60 * 60 * 1000);

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
        holdUntil,
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

    // Locked in the same order the scheduler locks it (conversion, then
    // earning), so the two paths can never deadlock against each other.
    const [earning] = await tx
      .select()
      .from(commissionEntries)
      .where(and(eq(commissionEntries.conversionId, conversion.id), eq(commissionEntries.type, "EARNING")))
      .for("update")
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

    // If the earning has already been released (or paid out), the
    // clawback must be visible in the available balance immediately.
    // Otherwise it's written PENDING and the scheduler releases it
    // alongside the earning once that matures — see the module doc.
    const reversalStatus = earning.status === "AVAILABLE" || earning.status === "PAID" ? "AVAILABLE" : "PENDING";

    await tx.insert(commissionEntries).values({
      affiliateId: conversion.affiliateId,
      conversionId: conversion.id,
      type: "REVERSAL",
      status: reversalStatus,
      paise: -delta,
      reversalOfEntryId: earning.id,
      reason: "proportional reversal from payment refund webhook",
    });

    return { deltaPaise: delta };
  });
}
