/**
 * Creates demo accounts (admin, client, affiliate) for local development
 * and staging demos. Refuses to run when APP_ENV=production — this is the
 * seed that must never touch a real deployment (Deliverables §10).
 */
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { getDb } from "@/lib/db";
import { users, profiles, userRoles, roles } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";

const DEMO_PASSWORD = "DemoPassword123!";

const DEMO_USERS = [
  { email: "admin@demo.groweazzy.test", fullName: "Demo Admin", roleKey: "SUPER_ADMIN" },
  { email: "client@demo.groweazzy.test", fullName: "Demo Client", roleKey: "CLIENT" },
  { email: "affiliate@demo.groweazzy.test", fullName: "Demo Affiliate", roleKey: "AFFILIATE" },
] as const;

async function main() {
  const env = getEnv();
  if (env.appEnv === "production") {
    console.error("Refusing to run the demo seed against APP_ENV=production.");
    process.exit(1);
  }

  const db = getDb();
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  for (const demo of DEMO_USERS) {
    const [roleRow] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, demo.roleKey)).limit(1);
    if (!roleRow) {
      throw new Error(`Role ${demo.roleKey} not found — run npm run seed:catalogue first.`);
    }

    let [userRow] = await db.select({ id: users.id }).from(users).where(eq(users.email, demo.email)).limit(1);
    if (!userRow) {
      const [inserted] = await db
        .insert(users)
        .values({ email: demo.email, passwordHash, emailVerifiedAt: new Date() })
        .returning({ id: users.id });
      userRow = inserted;
      if (userRow) {
        await db.insert(profiles).values({ userId: userRow.id, fullName: demo.fullName });
      }
    }
    if (!userRow) continue;

    await db
      .insert(userRoles)
      .values({ userId: userRow.id, roleId: roleRow.id })
      .onConflictDoNothing();

    console.log(`  ${demo.email} (${demo.roleKey}) — password: ${DEMO_PASSWORD}`);
  }

  console.log("==> Demo seed complete. These accounts must never exist in production.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
