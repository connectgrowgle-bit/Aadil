#!/usr/bin/env node
/**
 * Copies .env.development.example to .env.local and fills in the secret
 * fields with real generated values — pure Node, so it works identically
 * in bash, Git Bash, WSL, PowerShell, or cmd. Exists because the
 * shell-specific version of this step (`sed` + `openssl` in a bash
 * one-liner) silently does nothing on a non-bash terminal, which is
 * exactly what happened the first time this was handed to a user on
 * Windows: the secrets stayed blank and env validation failed with three
 * "must be at least N characters" errors.
 *
 * Usage: node ops/setup-env.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const examplePath = join(repoRoot, ".env.development.example");
const targetPath = join(repoRoot, ".env.local");

if (existsSync(targetPath)) {
  console.log(".env.local already exists — leaving it alone.");
  console.log("Delete it first if you want this script to regenerate it.");
  process.exit(0);
}

if (!existsSync(examplePath)) {
  console.error(`Could not find ${examplePath} — run this from the repo root.`);
  process.exit(1);
}

let content = readFileSync(examplePath, "utf8");

const secrets = {
  SESSION_SECRET: randomBytes(48).toString("base64"),
  PII_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  CRON_SECRET: randomBytes(32).toString("hex"),
};

for (const [key, value] of Object.entries(secrets)) {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (!pattern.test(content)) {
    throw new Error(`${key} not found in .env.development.example — file may have changed shape.`);
  }
  content = content.replace(pattern, `${key}=${value}`);
}

writeFileSync(targetPath, content);

console.log(`Wrote ${targetPath} with generated secrets for:`);
for (const key of Object.keys(secrets)) console.log(`  - ${key}`);
console.log("\nNext: npm run db:migrate && npm run seed:catalogue && npm run seed:demo && npm run dev");
