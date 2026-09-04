/**
 * CLI entrypoint for `npm run seed:catalogue`. Safe to re-run in
 * production (upserts by natural key) — see catalogue.logic.ts for the
 * actual seeding functions, which the test suite also imports directly.
 */
import { seedPermissionsAndRoles, seedCommissionPolicy, seedServiceCatalogue } from "./catalogue.logic";

async function main() {
  console.log("==> Seeding permissions & roles");
  await seedPermissionsAndRoles();
  console.log("==> Seeding commission policy");
  await seedCommissionPolicy();
  console.log("==> Seeding service catalogue");
  await seedServiceCatalogue();
  console.log("==> Done");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
