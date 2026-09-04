/**
 * Applies drizzle-kit-generated migrations via Drizzle's own migration
 * tracker (idempotent: re-running is a no-op for anything already
 * applied), then hands off to ops/migrate.sh for the manual SQL and its
 * verification pass. Invoked as `npm run db:migrate` / `bash ops/migrate.sh`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  if (/[?&]schema=/i.test(databaseUrl)) {
    console.error("DATABASE_URL must not contain a ?schema= parameter (pg_dump rejects it).");
    process.exit(1);
  }

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  console.log("==> Applying drizzle-kit generated migrations (tracked, idempotent)");
  await migrate(db, { migrationsFolder: "./drizzle/generated" });
  console.log("  - done");

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
