import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  bigint,
  index,
  uniqueIndex,
  inet,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { auditOutcomeEnum, fileScanStatusEnum, jobRunStatusEnum } from "./enums";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  // Argon2id hash, m=19456 KiB t=2 p=1. Never a plaintext or reversibly
  // encrypted password.
  passwordHash: text("password_hash").notNull(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  // Bumped on password reset or suspension. Every session created before
  // this instant is invalid, regardless of its own expiry — see
  // docs/ARCHITECTURE.md §5.
  sessionsValidFrom: timestamp("sessions_valid_from", { withTimezone: true })
    .notNull()
    .defaultNow(),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  // TOTP secret, AES-256-GCM encrypted at rest (Phase 12). Null = MFA off.
  mfaSecretEncrypted: text("mfa_secret_encrypted"),
  mfaEnabledAt: timestamp("mfa_enabled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Case-insensitive uniqueness: two accounts differing only in case would
  // be an enumeration and takeover surface.
  uniqueIndex("users_email_lower_uidx").on(sql`lower(${t.email})`),
]);

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  avatarFileId: uuid("avatar_file_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("profiles_user_id_uidx").on(t.userId)]);

export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  // e.g. "service.pricing", "payout.approve" — dotted resource.action.
  key: text("key").notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("permissions_key_uidx").on(t.key)]);

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("roles_key_uidx").on(t.key)]);

export const rolePermissions = pgTable("role_permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("role_permissions_pair_uidx").on(t.roleId, t.permissionId)]);

export const userRoles = pgTable("user_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("user_roles_pair_uidx").on(t.userId, t.roleId),
  index("user_roles_user_id_idx").on(t.userId),
]);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Only the SHA-256 of the bearer token is ever stored — Rule 13.
  tokenHash: text("token_hash").notNull(),
  // Sliding: refreshed on activity, capped by absoluteExpiresAt.
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // Fixed at creation, never extended, regardless of activity.
  absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
  // Set once a valid MFA challenge has been answered. A session missing
  // this on an MFA-enabled account is refused exactly like an expired one
  // (Phase 12) — enforced in the actor guard, not the login route.
  mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
  ipAddress: inet("ip_address"),
  userAgent: text("user_agent"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("sessions_token_hash_uidx").on(t.tokenHash),
  index("sessions_user_id_idx").on(t.userId),
]);

// Password reset / email verification / invite tokens — single-use,
// hashed like sessions.
export const authTokens = pgTable("auth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(), // 'PASSWORD_RESET' | 'EMAIL_VERIFY' | 'INVITE'
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("auth_tokens_token_hash_uidx").on(t.tokenHash)]);

export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  storageDriver: text("storage_driver").notNull(), // 'local' | 's3'
  storageKey: text("storage_key").notNull(),
  // Detected from magic bytes at upload time, never trusted from the
  // Content-Type header or filename — Rule 15.
  detectedMimeType: text("detected_mime_type").notNull(),
  originalFilename: text("original_filename").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  scanStatus: fileScanStatusEnum("scan_status").notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(), // e.g. "payout.approve"
  outcome: auditOutcomeEnum("outcome").notNull(),
  // Denials are logged too, deliberately — Rule 16. A log of only
  // successes cannot show an attack in progress.
  targetType: text("target_type"),
  targetId: text("target_id"),
  metadata: jsonb("metadata"),
  ipAddress: inet("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("audit_logs_actor_created_idx").on(t.actorUserId, t.createdAt),
  index("audit_logs_target_idx").on(t.targetType, t.targetId),
]);

export const mfaRecoveryCodes = pgTable("mfa_recovery_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Argon2id-hashed — these are bearer credentials, same standard as
  // passwords, not a lighter one.
  codeHash: text("code_hash").notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("mfa_recovery_codes_user_id_idx").on(t.userId)]);

// Records each consumed TOTP step to block replay within its validity
// window (±1 step). Unique on (userId, stepIndex).
export const mfaUsedCodes = pgTable("mfa_used_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  stepIndex: bigint("step_index", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("mfa_used_codes_user_step_uidx").on(t.userId, t.stepIndex)]);

// One row per invocation of a scheduled job (commission release, payout
// batching, etc). Lets an authenticated cron endpoint detect a run already
// in flight without relying solely on the advisory lock.
export const jobRuns = pgTable("job_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobName: text("job_name").notNull(),
  status: jobRunStatusEnum("status").notNull().default("RUNNING"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  itemsProcessed: bigint("items_processed", { mode: "number" }).notNull().default(0),
  itemsFailed: bigint("items_failed", { mode: "number" }).notNull().default(0),
  errorSummary: text("error_summary"),
}, (t) => [index("job_runs_job_name_started_idx").on(t.jobName, t.startedAt)]);
