import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { ticketStatusEnum, ticketPriorityEnum } from "./enums";

export const supportTickets = pgTable("support_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  requesterUserId: uuid("requester_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  assigneeUserId: uuid("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
  subject: text("subject").notNull(),
  status: ticketStatusEnum("status").notNull().default("OPEN"),
  priority: ticketPriorityEnum("priority").notNull().default("NORMAL"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("support_tickets_requester_idx").on(t.requesterUserId),
  index("support_tickets_status_idx").on(t.status),
]);

// English UI, Hinglish support conversations — messages are free text, no
// language constraint at the schema level.
export const supportMessages = pgTable("support_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull().references(() => supportTickets.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  isInternalNote: boolean("is_internal_note").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("support_messages_ticket_id_idx").on(t.ticketId)]);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("notifications_user_id_idx").on(t.userId, t.readAt)]);
