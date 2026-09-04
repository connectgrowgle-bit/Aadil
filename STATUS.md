# GrowEazzy — Build Status

Last updated: 2026-09-04. This is a partial build against the full
13-phase GrowEazzy spec — Phases 0–2 and Phase 1 (public site), built and
verified in one session against a real PostgreSQL 16 instance. **It is
not production ready.** Whole phases (3, 5–13) do not exist yet. Nothing
below is a simulation described as if it were real — every ✅ item was
actually run against a live database in this environment, not mocked.

## What's built and verified

| Area | Status | How it was verified |
|---|---|---|
| Phase 0 architecture doc | ✅ | `docs/ARCHITECTURE.md` |
| Compliance flags (§8) | ✅ | `docs/COMPLIANCE.md`, no legal conclusions offered |
| Schema (49 tables per spec §4's list) | ✅ | `drizzle-kit generate` + applied to live dev/test databases; `\dt` confirms 49 tables |
| Hand-written manual SQL invariants | ✅ | Applied idempotently (verified via a second run); `ops/migrate.sh` queries `pg_indexes`/`pg_constraint` to confirm they landed, not just that the apply step exited 0 |
| Env validation refusing to boot on mismatch | ✅ | 20 unit tests in `tests/env.test.ts`, all passing |
| Argon2id auth, enumeration-safe login | ✅ | `tests/auth.test.ts` — unknown-email and wrong-password paths asserted byte-identical |
| DB sessions, 3 independent expiry mechanisms | ✅ | `tests/auth.test.ts` — sliding, absolute, and watermark each independently tested |
| 38-permission RBAC catalogue + `can()` | ✅ | `tests/rbac.test.ts` — multi-role union, `service.edit`/`service.pricing` separation, no-role denial |
| Phase 1 repository seam | ✅ | `src/lib/repository.ts`; `tests/repository.test.ts` |
| 15 public pages | ✅ | `next build` succeeds; live server smoke-tested — all 15 return 200, unknown service slug 404s, displayed price matches DB exactly |
| Rich-text sanitization at the read boundary | ✅ | `tests/sanitize.test.ts` — script tags, event handlers, `javascript:` hrefs all stripped |
| Lint / typecheck / build | ✅ | `npm run lint` (`--max-warnings=0`), `npm run typecheck`, `npm run build` all pass clean |
| Test suite | ✅ | 82 tests across 7 files, all passing against a live database (not the 1,044 the full spec calls for — see below) |
| Ops scripts | ✅ | `ops/migrate.sh` and `ops/backup.sh` actually run in this environment; `ops/restore.sh` written but not exercised (nothing to restore yet) |
| CVE remediation | ✅ | Bumped off Next.js 16.0.0 (CVE-2025-66478), drizzle-orm <0.45.2 (SQLi, GHSA-gpj5-g38j-94v9), and vitest's critical arbitrary-file-read chain, discovered while installing dependencies; `npm audit` now reports 0 high/critical |

## What's explicitly NOT built

This is the important half of this report. None of the following exist in
this repository yet:

- **Phase 3 — Affiliate lifecycle & KYC.** Schema exists
  (`affiliate_kyc`, encrypted PAN/bank fields); no state-machine code, no
  `PaymentGateway`/`MockPaymentGateway` interface, no encryption
  implementation for `PII_ENCRYPTION_KEY` (the env var is validated but
  nothing uses it yet).
- **Phase 4 — Attribution & commission writes.** Schema and the money
  invariants exist and are tested at the database level; there is no
  `?ref=` middleware, no click-recording route, no code path that ever
  writes a `commission_entries` row from a real conversion.
- **Phase 5 — Razorpay.** No integration at all. `PAYMENT_PROVIDER=mock`
  is the only path env validation allows outside production, and there is
  no mock gateway implementation either — checkout does not exist.
- **Phase 6 — Client workflow.** No checkout, no onboarding forms, no
  order-stage transitions beyond the schema.
- **Phase 7 — CRM.** Schema exists; nothing writes to it. The `/contact`
  page's form is visibly disabled with a "coming soon" label rather than
  silently pretending to work.
- **Phase 8 — Training portal.** Schema exists; no content, no player, no
  progress tracking code.
- **Phase 9 — Admin dashboard.** No admin UI at all. The service catalogue
  is already DB-backed (this build did that part early, since the schema
  work was shared with Phase 1's seam), but there is no `service.pricing`
  UI, no price-history writes yet, no metrics dashboard.
- **Phase 10 — Security audit suite.** Not built. The 82 tests that exist
  are a "core invariants" suite (task-scoped for this session), not the
  115-attack audit the spec describes.
- **Phase 11 — Production prep.** No `/api/health`, no `/api/ready`, no
  Sentry instrumentation (env validation requires `SENTRY_DSN` in
  production, but nothing reads it yet).
- **Phase 12 — Hardening.** No commission scheduler, no advisory-lock
  logic, no MFA enrollment/verification UI (the `mfaVerifiedAt` /
  `mfaSecretEncrypted` columns and the actor-guard check exist, but there
  is no way for a user to actually enable MFA yet).
- **Phase 13 — Real gateway verification.** Not applicable — no gateway
  integration exists to verify, and this environment has no Razorpay test
  credentials or outbound access to Razorpay to verify against even if it
  did.

## Test count vs. spec

The spec describes 1,044 tests across 11 suites including a 115-attack
security audit. This build has 82 tests across the areas that exist
(auth, RBAC, money invariants, database constraints, env validation,
sanitization, repository). Extending to the full suite requires the
features those tests would exercise (Phases 3–13) to exist first —
writing audit tests against endpoints that don't exist would be tests of
nothing.

## Middleware / MFA / rate limiting — explicitly absent, not silently skipped

Per Rule 11, deleting middleware must not expose anything: there is
currently **no middleware file at all**, and the one authenticated page
that exists (`/account`) re-resolves its actor from the database
independently, so this holds trivially today. It will need active
attention once real authenticated dashboards (Phases 6, 7, 9) are added,
not by assumption. MFA enforcement described in `docs/ARCHITECTURE.md` §5
is not active, because there is no enrollment flow yet — a user cannot
currently set `mfaEnabledAt`, so the actor guard's MFA check is
unreachable in practice, not tested end-to-end. Rate limiting does not
exist in any form yet (not even the in-memory version the spec accepts as
a known gap).

## Known environment limitations

- This session has no Razorpay test credentials and no verified outbound
  network path to Razorpay's API — Phase 13 cannot be attempted here
  regardless of build progress.
- `.env.local` used for local verification in this session contains
  locally-generated dev-only secrets and is gitignored; it was never
  committed.

## Immediate next steps, in priority order

1. Phase 5 (Razorpay `PaymentGateway` interface + mock implementation)
   unblocks Phase 6 (checkout), which unblocks Phase 4's write paths
   (commission actually being earned), which is what most of the money
   invariants tested in Phase 0–2 exist to protect.
2. Phase 3 (affiliate lifecycle/KYC) can proceed in parallel — its schema
   and invariants are already in place and tested.
3. Middleware and MFA enforcement should land together with the first
   real authenticated dashboard, not before, so they're tested against
   something real rather than the placeholder `/account` page.
