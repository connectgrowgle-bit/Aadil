import type { Config } from "drizzle-kit";

export default {
  schema: "./src/lib/db/schema/index.ts",
  out: "./drizzle/generated",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/groweazzy_dev",
  },
  // ?schema= is intentionally never appended anywhere — pg_dump rejects it.
} satisfies Config;
