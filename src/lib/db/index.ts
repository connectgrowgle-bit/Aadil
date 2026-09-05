import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | undefined;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined;

/** Lazily-created singleton so importing this module never opens a
 * connection (and never validates env) until a query actually runs. */
export function getDb() {
  if (!dbInstance) {
    const env = getEnv();
    client = postgres(env.databaseUrl, {
      ssl: env.databaseSsl ? "require" : false,
      max: env.appEnv === "production" ? 10 : 5,
    });
    dbInstance = drizzle(client, { schema });
  }
  return dbInstance;
}

export type Db = ReturnType<typeof getDb>;
export { schema };
