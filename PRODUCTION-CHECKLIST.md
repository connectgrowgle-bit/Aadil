# GrowEazzy — Production Checklist

**Do not deploy to production against this checklist yet.** Whole phases
of the spec are unbuilt (see `STATUS.md`) — this checklist exists so the
gap is visible, not to imply the platform is close to ready. Every
unchecked CRITICAL or HIGH item below means "not production ready,"
full stop, per the reporting rule this build follows.

Legend: ✅ done and verified · ⛔ not built · ⚠️ built but not verified in
this environment (e.g. needs real credentials this session doesn't have).

## CRITICAL

- ✅ Money stored as integer paise (BIGINT) everywhere in the schema.
- ✅ Commission ledger is append-only with a partial unique index
  preventing a double EARNING per conversion, verified against a live
  database.
- ✅ Prices are read server-side from the database; the client only says
  which plan, never what it costs — verified: the displayed price on
  `/ai-content-avatar` matches `service_plans.price_paise` exactly.
- ⛔ Payment success is never trusted from the frontend — **no Razorpay
  integration exists yet**, so this rule has nothing to violate yet, but
  also nothing enforcing it in a real payment flow.
- ⛔ Webhook signature verification over the raw body — not built (no
  webhook endpoint exists).
- ⛔ Webhook idempotency inbox — table exists (`webhook_events`), nothing
  writes to it yet.
- ✅ `PAYMENT_MODE` has no default and is cross-checked against the
  Razorpay key prefix at boot — verified with unit tests.
- ✅ Middleware is not the security boundary — no middleware exists yet
  that makes any authorization decision; every authenticated page
  (`/account`) re-resolves the actor from the database. Revisit this item
  when middleware is added.
- ✅ Sessions are database rows storing only `sha256(token)`, not JWTs —
  verified.
- ✅ Account enumeration closed on login (byte-identical failure shape for
  unknown email vs. wrong password) — verified with tests.
- ⛔ MFA enforcement in the actor guard — not built (Phase 12).
- ⛔ Commission release scheduler with a dedicated-connection advisory
  lock — not built (Phase 12).

## HIGH

- ✅ Partial unique indexes for one-open-payout-per-affiliate and
  one-active-KYC-per-affiliate, verified against a live database.
- ✅ `net_paise = gross_paise - tds_paise` CHECK constraint, verified.
- ✅ Permissions resolved from the database per request (`can()`), not
  role-string branching — verified with tests covering multiple roles.
- ⛔ File upload magic-byte detection — `files.detectedMimeType` column
  exists; no upload endpoint exists yet to populate it correctly.
- ⛔ Audit log writes on denial, not just success — `audit_logs` table
  exists; nothing writes to it yet.
- ⛔ Razorpay Route/split settlement avoided — moot until Razorpay exists,
  but the architecture decision is recorded in `docs/ARCHITECTURE.md` §7
  before any payment code is written, specifically to avoid this trap.
- ⛔ `/api/ready` checking database, config, and the money-invariant
  indexes — not built (Phase 11).
- ⚠️ `npm audit`: 0 critical/high vulnerabilities as of this build (fixed
  Next.js CVE-2025-66478, drizzle-orm's SQLi GHSA-gpj5-g38j-94v9, and
  vitest's arbitrary-file-read chain during setup) — re-run before every
  deploy, this drifts.

## MEDIUM

- ✅ Rich text sanitized at the repository read boundary before
  `dangerouslySetInnerHTML` (`sanitize-html`), pre-empting the exact bug
  the spec's own history names as mistake #10.
- ✅ Cookie `Secure` flag keyed off `APP_URL` scheme, not `NODE_ENV` —
  pre-empts mistake #3.
- ⛔ Rate limiting — not built at all yet (spec's own gap: in-memory only
  even when built, needs Redis across instances).
- ⛔ CSP headers — not configured.

## MANUAL CONFIGURATION (required before go-live, not code)

- Real `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET`
  from the live Razorpay dashboard, once the integration exists.
- `SENTRY_DSN` and a Sentry project, once instrumentation exists.
- A named grievance officer and a published cooling-off period for the
  affiliate programme — see `docs/COMPLIANCE.md`.
- Production database credentials with `DATABASE_SSL=true` and a
  connection string with **no** `?schema=` parameter.
- Backup schedule using `ops/backup.sh`, with `ops/restore.sh` tested
  against a real restore target at least once before go-live, not just
  read.

## LEGAL-COMPLIANCE REVIEW REQUIRED

See `docs/COMPLIANCE.md` in full. Not resolved by any code in this
build: the ₹2,000 registration fee's standing under the Consumer
Protection (Direct Selling) Rules 2021 and the Prize Chits and Money
Circulation Schemes (Banning) Act 1978, GST treatment, DPDP Act privacy
obligations, and the terms/refund/affiliate policy text (currently
placeholder copy, explicitly marked as such in the repository content).
