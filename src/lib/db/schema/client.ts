import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  bigint,
  boolean,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import { orderStageEnum, crmStageEnum, meetingStatusEnum, crmTaskStatusEnum } from "./enums";

// Catalogue moves here in Phase 9 (previously static content behind the
// repository seam — see docs/ARCHITECTURE.md §4).
export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  shortDescription: text("short_description").notNull(),
  longDescriptionHtml: text("long_description_html").notNull(),
  isPublished: boolean("is_published").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("services_slug_uidx").on(t.slug)]);

export const servicePlans = pgTable("service_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Price is read server-side from here, never trusted from the client
  // (Rule 4). Repricing writes a new row in service_plan_price_history in
  // the same transaction; existing orders keep their own snapshotted
  // amount and are unaffected (Rule 5).
  pricePaise: bigint("price_paise", { mode: "number" }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("service_plans_service_id_idx").on(t.serviceId)]);

export const servicePlanPriceHistory = pgTable("service_plan_price_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  servicePlanId: uuid("service_plan_id").notNull().references(() => servicePlans.id, { onDelete: "cascade" }),
  previousPricePaise: bigint("previous_price_paise", { mode: "number" }).notNull(),
  newPricePaise: bigint("new_price_paise", { mode: "number" }).notNull(),
  reason: text("reason").notNull(), // required — Phase 9: "requires a reason"
  changedByUserId: uuid("changed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("service_plan_price_history_plan_id_idx").on(t.servicePlanId)]);

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  servicePlanId: uuid("service_plan_id").notNull().references(() => servicePlans.id, { onDelete: "restrict" }),
  stage: orderStageEnum("stage").notNull().default("CREATED"),
  // Snapshotted at order creation — immutable thereafter (Rule 5), even if
  // service_plans.pricePaise changes later.
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("INR"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("orders_user_id_idx").on(t.userId),
  index("orders_stage_idx").on(t.stage),
]);

export const orderEvents = pgTable("order_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  fromStage: orderStageEnum("from_stage"),
  toStage: orderStageEnum("to_stage").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("order_events_order_id_idx").on(t.orderId)]);

export const orderAssignments = pgTable("order_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  assigneeUserId: uuid("assignee_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  role: text("role").notNull(), // e.g. 'EDITOR', 'ACCOUNT_MANAGER'
  assignedByUserId: uuid("assigned_by_user_id").references(() => users.id, { onDelete: "set null" }),
  unassignedAt: timestamp("unassigned_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("order_assignments_order_id_idx").on(t.orderId)]);

export const orderFiles = pgTable("order_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  fileId: uuid("file_id").notNull(),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  kind: text("kind").notNull(), // 'BRIEF_ATTACHMENT' | 'DELIVERABLE' | ...
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("order_files_order_id_idx").on(t.orderId)]);

// Draft (everything optional) vs submit (real requirements) schemas are
// validated in exactly one place in application code (Phase 6); both write
// to this same JSON column so "save and come back" and the final brief
// share storage.
export const onboardingSubmissions = pgTable("onboarding_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  formData: jsonb("form_data").notNull().default({}),
  isDraft: boolean("is_draft").notNull().default(true),
  // Submitting the brief does NOT lock requirements — that is a distinct,
  // later, one-way transition (see orders.stage REQUIREMENTS_LOCKED).
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("onboarding_submissions_order_id_uidx").on(t.orderId)]);

export const meetings = pgTable("meetings", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  status: meetingStatusEnum("status").notNull().default("SCHEDULED"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("meetings_order_id_idx").on(t.orderId)]);

export const deliverables = pgTable("deliverables", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  fileId: uuid("file_id"),
  title: text("title").notNull(),
  version: integer("version").notNull().default(1),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("deliverables_order_id_idx").on(t.orderId)]);

// Dedupe on email — Phase 7. The user account is resolved by email even
// when no userId is supplied at contact-creation time, so a contact
// created before signup still gets linked to the orders that follow.
export const crmContacts = pgTable("crm_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  email: text("email").notNull(),
  fullName: text("full_name"),
  phone: text("phone"),
  stage: crmStageEnum("stage").notNull().default("NEW"),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("crm_contacts_email_lower_uidx").on(sql`lower(${t.email})`),
  index("crm_contacts_stage_idx").on(t.stage),
]);

// The CRM fills itself: every stage change here is written by a system
// event (order created/advanced), not only by a human — Phase 7.
export const crmActivities = pgTable("crm_activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").notNull().references(() => crmContacts.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // 'STAGE_CHANGE' | 'ORDER_CREATED' | 'NOTE' | 'CALL' | ...
  fromStage: crmStageEnum("from_stage"),
  toStage: crmStageEnum("to_stage"),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_activities_contact_id_idx").on(t.contactId)]);

export const crmNotes = pgTable("crm_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").notNull().references(() => crmContacts.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_notes_contact_id_idx").on(t.contactId)]);

export const crmTasks = pgTable("crm_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").notNull().references(() => crmContacts.id, { onDelete: "cascade" }),
  assigneeUserId: uuid("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  status: crmTaskStatusEnum("status").notNull().default("OPEN"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_tasks_contact_id_idx").on(t.contactId)]);
