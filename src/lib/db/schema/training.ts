import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { publishStatusEnum } from "./enums";

// Draft content is invisible, not greyed out — the repository/query layer
// filters status = 'PUBLISHED' for any non-staff reader; there is no
// "preview as draft" affordance for ordinary users.
export const trainingCourses = pgTable("training_courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: publishStatusEnum("status").notNull().default("DRAFT"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("training_courses_slug_uidx").on(t.slug)]);

export const trainingModules = pgTable("training_modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id").notNull().references(() => trainingCourses.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  // A module cannot be published before its course — enforced in
  // application code at the single write path (Phase 8), not just here.
  status: publishStatusEnum("status").notNull().default("DRAFT"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("training_modules_course_id_idx").on(t.courseId)]);

export const trainingVideos = pgTable("training_videos", {
  id: uuid("id").primaryKey().defaultRandom(),
  moduleId: uuid("module_id").notNull().references(() => trainingModules.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  // A lesson cannot be published before its module.
  status: publishStatusEnum("status").notNull().default("DRAFT"),
  videoUrl: text("video_url").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("training_videos_module_id_idx").on(t.moduleId)]);

// Progress is monotonic (GREATEST — never decreases), sticky once complete,
// and clamped to the lesson's real duration at the single write path.
// 90% watched marks completedAt (players rarely report the final second).
export const trainingProgress = pgTable("training_progress", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  videoId: uuid("video_id").notNull().references(() => trainingVideos.id, { onDelete: "cascade" }),
  maxWatchedSeconds: integer("max_watched_seconds").notNull().default(0),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("training_progress_user_video_uidx").on(t.userId, t.videoId)]);
