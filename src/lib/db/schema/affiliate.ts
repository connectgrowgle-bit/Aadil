import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  bigint,
  integer,
  index,
  uniqueIndex,
  inet,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { orders } from "./client";
import {
  affiliateStatusEnum,
  kycStatusEnum,
  conversionStatusEnum,
  commissionStatusEnum,
  commissionEntryTypeEnum,
  payoutStatusEnum,
  paymentStatusEnum,
  paymentPurposeEnum,
} from "./enums";

// Deliberately no parent/upline column anywhere in this file. The
// programme is structurally single-level — see docs/COMPLIANCE.md.
export const affiliates = pgTable("affiliates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  code: text("code").notNull(), // public-facing code, e.g. "GEA10245"
  status: affiliateStatusEnum("status").notNull().default("REGISTERED"),
  registrationFeePaidAt: timestamp("registration_fee_paid_at", { withTimezone: true }),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspendedReason: text("suspended_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("affiliates_user_id_uidx").on(t.userId),
  uniqueIndex("affiliates_code_uidx").on(t.code),
]);

// KYC before fee payment (Phase 3) — a rejected KYC after fee payment would
// create a refund obligation. PAN/bank fields are AES-256-GCM ciphertext;
// only last-4 is ever stored in the clear for display.
export const affiliateKyc = pgTable("affiliate_kyc", {
  id: uuid("id").primaryKey().defaultRandom(),
  affiliateId: uuid("affiliate_id").notNull().references(() => affiliates.id, { onDelete: "cascade" }),
  status: kycStatusEnum("status").notNull().default("DRAFT"),
  panEncrypted: text("pan_encrypted"),
  panLast4: text("pan_last4"),
  // Keyed HMAC of the normalized PAN — detects duplicate identities across
  // affiliate applications without ever decrypting.
  panFingerprint: text("pan_fingerprint"),
  bankAccountEncrypted: text("bank_account_encrypted"),
  bankAccountLast4: text("bank_account_last4"),
  bankIfsc: text("bank_ifsc"),
  rejectionReason: text("rejection_reason"),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("affiliate_kyc_affiliate_id_idx").on(t.affiliateId),
  index("affiliate_kyc_pan_fingerprint_idx").on(t.panFingerprint),
  // One active (SUBMITTED/APPROVED) KYC row per affiliate — see
  // drizzle/manual/003_affiliate_kyc_indexes.sql for the partial unique
  // index; Drizzle's DSL cannot express the WHERE clause.
]);

export const affiliateLinks = pgTable("affiliate_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  affiliateId: uuid("affiliate_id").notNull().references(() => affiliates.id, { onDelete: "cascade" }),
  serviceSlug: text("service_slug").notNull(),
  refCode: text("ref_code").notNull(), // the ?ref= value, e.g. "GEA10245"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("affiliate_links_ref_code_uidx").on(t.refCode),
  index("affiliate_links_affiliate_id_idx").on(t.affiliateId),
]);

export const affiliateClicks = pgTable("affiliate_clicks", {
  id: uuid("id").primaryKey().defaultRandom(),
  affiliateLinkId: uuid("affiliate_link_id").notNull().references(() => affiliateLinks.id, { onDelete: "cascade" }),
  // Value inside the signed attribution cookie — lets a later conversion
  // be traced back to this exact click even if the cookie is presented on
  // a different page than the one clicked.
  clickToken: text("click_token").notNull(),
  landingUrl: text("landing_url").notNull(),
  ipAddress: inet("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("affiliate_clicks_click_token_uidx").on(t.clickToken),
  index("affiliate_clicks_link_id_idx").on(t.affiliateLinkId),
]);

// A lead is a visitor who arrived via a link but has not yet converted
// (e.g. filled a contact form). Distinct from a click (impression) and a
// conversion (paid order).
export const affiliateLeads = pgTable("affiliate_leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  affiliateClickId: uuid("affiliate_click_id").references(() => affiliateClicks.id, { onDelete: "set null" }),
  affiliateId: uuid("affiliate_id").notNull().references(() => affiliates.id, { onDelete: "cascade" }),
  email: text("email"),
  phone: text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("affiliate_leads_affiliate_id_idx").on(t.affiliateId)]);

export const affiliateConversions = pgTable("affiliate_conversions", {
  id: uuid("id").primaryKey().defaultRandom(),
  affiliateId: uuid("affiliate_id").notNull().references(() => affiliates.id, { onDelete: "cascade" }),
  affiliateClickId: uuid("affiliate_click_id").references(() => affiliateClicks.id, { onDelete: "set null" }),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  status: conversionStatusEnum("status").notNull().default("PENDING"),
  // Snapshot of the rate applied, in basis points (1000 = 10%). Snapshotted
  // at conversion time so a later admin rate change never rewrites history.
  commissionRateBasisPoints: integer("commission_rate_basis_points").notNull(),
  orderAmountPaise: bigint("order_amount_paise", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("affiliate_conversions_order_id_uidx").on(t.orderId),
  index("affiliate_conversions_affiliate_id_idx").on(t.affiliateId),
]);

// APPEND-ONLY. No balance column anywhere in this schema — Rule 2. A
// balance is always SUM(paise) over AVAILABLE rows, computed on read. An
// earning is a positive row; a reversal is a new negative row referencing
// the same conversion. Never UPDATE paise or DELETE a row here.
export const commissionEntries = pgTable("commission_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  affiliateId: uuid("affiliate_id").notNull().references(() => affiliates.id, { onDelete: "cascade" }),
  conversionId: uuid("conversion_id").notNull().references(() => affiliateConversions.id, { onDelete: "cascade" }),
  type: commissionEntryTypeEnum("type").notNull(),
  status: commissionStatusEnum("status").notNull().default("PENDING"),
  // Positive for an EARNING, negative for a REVERSAL/ADJUSTMENT clawback.
  paise: bigint("paise", { mode: "number" }).notNull(),
  // Earliest instant this entry may be released to AVAILABLE (hold period).
  holdUntil: timestamp("hold_until", { withTimezone: true }),
  payoutId: uuid("payout_id"), // set once claimed by a payout; see payouts below
  reversalOfEntryId: uuid("reversal_of_entry_id"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("commission_entries_affiliate_id_idx").on(t.affiliateId),
  index("commission_entries_conversion_id_idx").on(t.conversionId),
  index("commission_entries_status_idx").on(t.status),
  // "One EARNING per conversion" is a partial unique index — see
  // drizzle/manual/001_commission_indexes.sql. Not expressible here.
]);

// Admin-configurable rate/fee/hold parameters, versioned so a change never
// rewrites a conversion's already-snapshotted rate.
export const commissionPolicies = pgTable("commission_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  commissionRateBasisPoints: integer("commission_rate_basis_points").notNull().default(1000),
  holdPeriodDays: integer("hold_period_days").notNull().default(14),
  refundWindowDays: integer("refund_window_days").notNull().default(30),
  payoutMinimumPaise: bigint("payout_minimum_paise", { mode: "number" }).notNull().default(100_000), // ₹1,000
  tdsRateBasisPoints: integer("tds_rate_basis_points").notNull().default(500),
  registrationFeeEnabled: text("registration_fee_enabled").notNull().default("true"), // 'true' | 'false'
  registrationFeePaise: bigint("registration_fee_paise", { mode: "number" }).notNull().default(200_000), // ₹2,000
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("commission_policies_effective_from_idx").on(t.effectiveFrom)]);

export const payouts = pgTable("payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  affiliateId: uuid("affiliate_id").notNull().references(() => affiliates.id, { onDelete: "cascade" }),
  batchId: uuid("batch_id"),
  status: payoutStatusEnum("status").notNull().default("REQUESTED"),
  grossPaise: bigint("gross_paise", { mode: "number" }).notNull(),
  tdsPaise: bigint("tds_paise", { mode: "number" }).notNull(),
  netPaise: bigint("net_paise", { mode: "number" }).notNull(),
  // Keyed on more than the entry set so a retry after a failed transfer
  // reuses a *new* key, not the one already burned — see
  // docs/MISTAKES.md item 6.
  idempotencyKey: text("idempotency_key").notNull(),
  providerReference: text("provider_reference"),
  failureReason: text("failure_reason"),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("payouts_idempotency_key_uidx").on(t.idempotencyKey),
  index("payouts_affiliate_id_idx").on(t.affiliateId),
  index("payouts_batch_id_idx").on(t.batchId),
  // "One open payout per affiliate" is a partial unique index — see
  // drizzle/manual/002_payout_indexes.sql.
  // net_paise = gross_paise - tds_paise is a CHECK constraint — same file.
]);

export const payoutBatches = pgTable("payout_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  runDate: timestamp("run_date", { withTimezone: true }).notNull(),
  totalPayouts: integer("total_payouts").notNull().default(0),
  totalNetPaise: bigint("total_net_paise", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A payment collected from a customer or an affiliate (registration fee).
// Amount is always what was actually charged; never rewritten after the
// fact — Rule 5. Refunds are tracked via provider's cumulative
// amount_refunded, not a locally-incremented counter — Rule 10.
export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  purpose: paymentPurposeEnum("purpose").notNull(),
  payerUserId: uuid("payer_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
  affiliateId: uuid("affiliate_id").references(() => affiliates.id, { onDelete: "set null" }),
  status: paymentStatusEnum("status").notNull().default("CREATED"),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  // Provider's cumulative refunded amount — source of truth for partial
  // refund proportion, never a locally-incremented counter.
  amountRefundedPaise: bigint("amount_refunded_paise", { mode: "number" }).notNull().default(0),
  currency: text("currency").notNull().default("INR"),
  providerOrderId: text("provider_order_id"), // Razorpay order_id — required before capture
  providerPaymentId: text("provider_payment_id"),
  providerSignatureVerifiedAt: timestamp("provider_signature_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("payments_payer_user_id_idx").on(t.payerUserId),
  index("payments_order_id_idx").on(t.orderId),
  uniqueIndex("payments_provider_order_id_uidx").on(t.providerOrderId),
]);

// Every state transition of a payment (created → authorized → captured →
// refunded), each tied to the webhook_events row (if any) that caused it.
export const paymentTransactions = pgTable("payment_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
  fromStatus: paymentStatusEnum("from_status"),
  toStatus: paymentStatusEnum("to_status").notNull(),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  webhookEventId: uuid("webhook_event_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("payment_transactions_payment_id_idx").on(t.paymentId)]);

// Idempotency inbox for provider webhooks — Rule 9. Uniquely indexed on
// the provider's own event id; a replay finds the row and no-ops.
export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().default("razorpay"),
  providerEventId: text("provider_event_id").notNull(),
  eventType: text("event_type").notNull(),
  // Raw request body, exactly as received — signatures are verified over
  // these bytes, before any JSON parsing (Rule 7).
  rawBody: text("raw_body").notNull(),
  signatureVerifiedAt: timestamp("signature_verified_at", { withTimezone: true }),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  processingError: text("processing_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("webhook_events_provider_event_uidx").on(t.provider, t.providerEventId),
]);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const settingsHistory = pgTable("settings_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(),
  previousValue: jsonb("previous_value"),
  newValue: jsonb("new_value").notNull(),
  reason: text("reason").notNull(),
  changedByUserId: uuid("changed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("settings_history_key_idx").on(t.key)]);
