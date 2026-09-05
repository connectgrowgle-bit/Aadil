import { pgEnum } from "drizzle-orm/pg-core";

// Auth
export const auditOutcomeEnum = pgEnum("audit_outcome", ["SUCCESS", "DENIED", "ERROR"]);
export const fileScanStatusEnum = pgEnum("file_scan_status", [
  "PENDING",
  "CLEAN",
  "INFECTED",
  "SKIPPED",
]);
export const jobRunStatusEnum = pgEnum("job_run_status", [
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);

// Affiliate
export const affiliateStatusEnum = pgEnum("affiliate_status", [
  "REGISTERED",
  "KYC_PENDING",
  "KYC_SUBMITTED",
  "KYC_REJECTED",
  "FEE_PENDING",
  "ACTIVE",
  "SUSPENDED",
  "TERMINATED",
]);
export const kycStatusEnum = pgEnum("kyc_status", [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
]);
export const conversionStatusEnum = pgEnum("conversion_status", [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
]);
// Commission entry lifecycle. CANCELLED and REVERSED are deliberately
// distinct — see docs/ARCHITECTURE.md §6.
export const commissionStatusEnum = pgEnum("commission_status", [
  "PENDING",
  "APPROVED",
  "AVAILABLE",
  "PAID",
  "REVERSED",
  "CANCELLED",
]);
export const commissionEntryTypeEnum = pgEnum("commission_entry_type", [
  "EARNING",
  "REVERSAL",
  "ADJUSTMENT",
]);
export const payoutStatusEnum = pgEnum("payout_status", [
  "REQUESTED",
  "APPROVED",
  "PROCESSING",
  "PAID",
  "FAILED",
  "REJECTED",
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "CREATED",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
]);
export const paymentPurposeEnum = pgEnum("payment_purpose", [
  "SERVICE_ORDER",
  "AFFILIATE_REGISTRATION_FEE",
]);

// Client
export const orderStageEnum = pgEnum("order_stage", [
  "CREATED",
  "PAID",
  "ONBOARDING",
  "REQUIREMENTS_LOCKED",
  "TEAM_ASSIGNED",
  "IN_PROGRESS",
  "REVIEW",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
]);
export const crmStageEnum = pgEnum("crm_stage", [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "ONBOARDING",
  "IN_PROGRESS",
  "REVIEW",
  "DELIVERED",
  "COMPLETED",
  "LOST",
  "CANCELLED",
]);
export const meetingStatusEnum = pgEnum("meeting_status", [
  "SCHEDULED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);
export const crmTaskStatusEnum = pgEnum("crm_task_status", [
  "OPEN",
  "DONE",
  "CANCELLED",
]);

// Training
export const publishStatusEnum = pgEnum("publish_status", ["DRAFT", "PUBLISHED"]);

// Support
export const ticketStatusEnum = pgEnum("ticket_status", [
  "OPEN",
  "PENDING_CUSTOMER",
  "PENDING_STAFF",
  "RESOLVED",
  "CLOSED",
]);
export const ticketPriorityEnum = pgEnum("ticket_priority", [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
]);
