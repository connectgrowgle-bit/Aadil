# Deploying GrowEazzy

This describes deploying what is actually built today (see `STATUS.md` for
scope). There is no Razorpay integration, admin dashboard, or CRM yet — do
not follow this as a production go-live guide until those exist and
`PRODUCTION-CHECKLIST.md` is fully checked off.

## Prerequisites

- Node.js 20+
- PostgreSQL 16, reachable from the app, with a database created for each
  environment (`groweazzy_dev`, `groweazzy_staging`, `groweazzy_production`
  — or whatever names your infrastructure uses; nothing in the code
  assumes these exact names).
- `psql` and `pg_dump`/`pg_restore` available on the machine running
  `ops/*.sh`.

## 1. Configure environment variables

Copy the example file for the target environment and fill it in:

```bash
cp .env.production.example .env.production   # or staging/development
```

See `docs/ARCHITECTURE.md` §2 and spec §12 for what each variable means.
`src/lib/env.ts` validates all of it at import time and **refuses to
boot** on a mismatch (wrong `PAYMENT_MODE` for the Razorpay key prefix,
`DATABASE_URL` carrying `?schema=`, missing `SENTRY_DSN` in production,
etc.) — treat a boot failure here as the validation working, not a bug to
route around.

## 2. Install dependencies

```bash
npm install
```

## 3. Run migrations

```bash
DATABASE_URL=... npm run db:migrate
```

This applies the drizzle-kit-generated migrations (tracked, idempotent —
safe to re-run) and then the hand-written manual SQL in `drizzle/manual/`
(also idempotent), and **verifies** the manual invariants actually landed
by querying `pg_indexes`/`pg_constraint` before declaring success. If this
script exits non-zero, do not proceed to seeding or serving traffic.

## 4. Seed the system catalogue (safe in every environment, including production)

```bash
DATABASE_URL=... npm run seed:catalogue
```

Seeds the permission catalogue, default roles, the default commission
policy, and the three services with their plans. Upserts by natural key —
safe to re-run.

**Never** run `npm run seed:demo` against production — it creates fake
accounts with a known password and refuses to run itself when
`APP_ENV=production`, but do not rely on that alone; it should not be in
any production deploy pipeline at all.

## 5. Build and start

```bash
npm run build
npm run start
```

## 6. Back up before any migration against a database with real data

```bash
DATABASE_URL=... ops/backup.sh
```

Writes a custom-format, compressed `pg_dump` to `./backups` (or
`$BACKUP_DIR`) and verifies the dump is readable with `pg_restore --list`
before declaring success.

## What is not yet wired into this flow

- No `/api/health` or `/api/ready` endpoints yet (Phase 11) — a
  load balancer health check needs to be added before this goes behind
  one.
- No Sentry initialization code yet, even though `SENTRY_DSN` is
  validated as present in production — the validation is ahead of the
  instrumentation.
- No CI pipeline in this repository yet; `npm run lint`, `npm run
  typecheck`, and `npm test` should all be run manually (or wired into
  one) before every deploy until that exists.
