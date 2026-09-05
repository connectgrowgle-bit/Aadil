# GrowEazzy — Build Status

Last updated: 2026-09-05 (session 3, continued). This is a partial build
against the full 13-phase GrowEazzy spec — Phases 0–2 and 1 fully, plus
real slices of Phases 4, 5, 6, 7, and 12, built and verified across three
sessions against a real PostgreSQL 16 instance. **It is not production
ready.** Phases 3, 8, 9, 10, 11, and 13 do not exist yet, MFA/rate-limiting
from Phase 12 don't exist either, and the phases that do exist are
narrower than their full spec scope — see below for exactly what's
covered. Nothing marked ✅ is a simulation described as if it were real:
every one was run against a live database, and the payment/webhook/cron/
payout paths were also exercised over real HTTP with a live server.

**As of this update, money moves all the way through the system for the
first time**: a click is attributed → an order is placed and paid →
commission is earned → held → released → claimed into a payout →
approved → marked paid — every step real, tested, and (for the HTTP-facing
steps) verified live with `curl` against a running server, right down to
the final ₹1,900 net payout landing in the database with the correct 5%
TDS deducted.

## What's built and verified

| Area | Status | How it was verified |
|---|---|---|
| Phase 0 architecture doc | ✅ | `docs/ARCHITECTURE.md` |
| Compliance flags (§8) | ✅ | `docs/COMPLIANCE.md`, no legal conclusions offered |
| Schema (49 tables per spec §4's list) | ✅ | Applied to live dev/test databases; `\dt` confirms 49 tables |
| Hand-written manual SQL invariants | ✅ | Idempotent (verified via repeated runs); `ops/migrate.sh` queries `pg_indexes`/`pg_constraint` to confirm they landed |
| Env validation refusing to boot on mismatch | ✅ | 20 unit tests, all passing |
| Argon2id auth, enumeration-safe login | ✅ | Unknown-email and wrong-password paths asserted byte-identical |
| DB sessions, 3 independent expiry mechanisms | ✅ | Sliding, absolute, and watermark each independently tested |
| 38-permission RBAC catalogue + `can()` | ✅ | Multi-role union, `service.edit`/`service.pricing` separation, no-role denial |
| Phase 1 repository seam + 15 public pages | ✅ | `next build` succeeds; live server smoke-tested — all 15 return 200, unknown service slug 404s, displayed price matches DB exactly |
| **Payment gateway interface** (Mock + Razorpay) | ✅ (Mock) / ⚠️ (Razorpay) | Mock: `createOrder` and signature verify/sign fully tested. Razorpay: signature-verification logic unit-tested against a hand-computed HMAC; `createOrder` calling the real API is **not exercised** — no credentials in this environment |
| **Order creation** (server-side pricing, provider order, CRM contact) | ✅ | Price snapshot survives a later plan repricing; inactive plan rejected; CRM contact created/deduped and moved to QUALIFIED — all against a live DB |
| **Attribution** (`?ref=` → click → signed cookie → conversion) | ✅ | Full chain hit over real HTTP with a live server (`curl -L` through the proxy, click route, and back); cookie tamper/forgery rejected; suspended-affiliate clicks resolve to nothing; self-referral blocked |
| **Webhook route** (signature verify, idempotency, commission, CRM) | ✅ | The real exported `POST` handler invoked with real `Request` objects, and separately over live HTTP: bad/missing signature → 400, valid delivery → 200 + real DB side effects, exact replay → "already processed" with **zero** duplicate rows, larger cumulative refund → only the delta reversed |
| **Commission engine write paths** | ✅ | EARNING on capture (row-locked, idempotent), no entry on CANCELLED, proportional REVERSAL on partial refund derived from cumulative `amount_refunded` (never a local counter), full refund reverses exactly the amount earned — no more, no less |
| **CRM self-fill** | ✅ (partial) | Order creation and payment-captured/failed/refunded webhooks all write CRM activity; contact dedup by email verified. Stage transitions beyond QUALIFIED (ONBOARDING → COMPLETED) are **not** wired up — see gaps below |
| **Commission release scheduler** (Phase 12) | ✅ | `releaseMaturedCommissions()`: dedicated-connection advisory lock (verified two concurrent runs never both process the same entries), per-entry row lock + repeated WHERE, re-verifies conversion/affiliate/payout-claim state from source. A held entry now genuinely reaches AVAILABLE — commission is actually payable end to end for the first time |
| **Reversal/release race correctness** | ✅ | A refund landing concurrently with release, a reversal written before release, and a reversal written after release were all tested against real concurrent execution (`Promise.all` + real Postgres row locks, not mocked) — the available balance nets to the exact right amount in every ordering |
| **Authenticated cron endpoint** | ✅ | `/api/cron/release-commissions`: constant-time secret comparison, verified live over HTTP — no auth → 401, wrong secret → 401, correct secret → 200 with a real run |
| **Payout claiming** (`AVAILABLE → PAID`) | ✅ | `requestPayout`/`approvePayout`/`rejectPayout`/`markPayoutPaid`/`markPayoutFailed` — row-locked claiming (verified concurrent double-claim is impossible), correct TDS/net math against the DB's own CHECK constraint, one-open-payout-per-affiliate enforced by the database not application code, reject/fail unclaim entries for a fresh request with a fresh idempotency key (closes spec's own mistake #6). Full loop verified live over HTTP with real permission gating: 401/403/200 |
| Rich-text sanitization at the read boundary | ✅ | Script tags, event handlers, `javascript:` hrefs all stripped |
| Lint / typecheck / build | ✅ | `npm run lint` (`--max-warnings=0`), `npm run typecheck`, `npm run build` all pass clean, including the Next 16 `middleware` → `proxy` rename |
| Test suite | ✅ | **153 tests across 15 files**, all passing against a live database (not the 1,044 the full spec calls for — see below) |
| Ops scripts | ✅ | `ops/migrate.sh` and `ops/backup.sh` actually run in this environment; `ops/restore.sh` written but not exercised (nothing to restore yet) |
| CVE remediation | ✅ | Bumped off Next.js 16.0.0 (CVE-2025-66478), drizzle-orm <0.45.2 (SQLi, GHSA-gpj5-g38j-94v9), and vitest's critical arbitrary-file-read chain; `npm audit` reports 0 high/critical |

## What was actually exercised end-to-end this session (not just unit-tested)

Started a live server and drove the real HTTP paths with `curl`, not just
function calls:

1. `GET /ai-content-avatar?ref=SMOKE01` → 307 to the proxy's click
   handoff → click recorded in `affiliate_clicks` → signed `ge_ref`
   cookie set → 307 to the ref-stripped URL → 200. Confirmed the click
   row landed with the right `landing_url` and `ref_code`.
2. `POST /api/webhooks/payments` with a correctly-signed mock delivery →
   200; wrong signature → 400; missing signature → 400; exact replay of
   the valid delivery → 200 `{"status":"already processed"}`.
3. `POST /api/cron/release-commissions` — no `Authorization` header → 401;
   wrong secret → 401; correct secret → 200 with a real scheduler run.
4. The full payout loop against a real running server with minted session
   cookies for two different demo accounts: an AFFILIATE-role account
   requesting a payout on ₹20,000 of qualifying orders → `{"grossPaise":
   200000,"tdsPaise":10000,"netPaise":190000}`; that same account trying
   to approve its own payout → 403 (lacks `payout.approve`); a
   SUPER_ADMIN-role account approving → 200, then marking it paid with a
   provider reference → 200; a repeat payout request while the first was
   still open → 400 "No available commission to pay out." Verified in
   Postgres afterward: the payout row is `PAID` with the exact TDS/net
   split, and its claimed commission entry moved to `PAID` too.

## What's explicitly NOT built

- **Phase 3 — Affiliate lifecycle & KYC.** Schema exists; no
  registration/KYC-submission UI, no state-machine enforcing
  `REGISTERED → KYC_PENDING → ... → ACTIVE`, no PII encryption
  implementation (`PII_ENCRYPTION_KEY` is validated but nothing uses it),
  no registration-fee payment flow. `createTestAffiliate` in the test
  suite inserts directly with `status: "ACTIVE"` — there's no real
  activation path yet.
- **Phase 4 — Attribution & commission**: the click → cookie → conversion
  → capture → earn → hold → release → refund/reverse chain is now real
  end to end and tested. What's missing: leads (`affiliate_leads` —
  schema only, unused). Note the scheduler auto-approves — it skips the
  spec's separate `APPROVED` step and moves `PENDING` straight to
  `AVAILABLE` once matured and verified; a manual admin-approval gate
  before release is not built (see the scope note below).
- **Phase 5 — Razorpay**: the gateway interface and both implementations
  exist; Razorpay's `createOrder` and the real webhook delivery format
  have never been called against or received from the actual Razorpay
  API — no credentials, no verified outbound network path in this
  environment. Only the Mock gateway has been exercised live.
- **Phase 6 — Client workflow**: order creation → checkout page → mock
  payment simulation → webhook → PAID is real and tested. Missing:
  onboarding forms (draft/submit schemas), requirements lock, team
  assignment, meetings, deliverables, review/delivery — the order stage
  enum supports all of these but nothing transitions an order past PAID.
- **Phase 7 — CRM**: contacts are created/deduped and receive activity
  log entries from order creation and every webhook outcome (captured/
  failed/refunded) — real and tested. Missing: the `/contact` page still
  doesn't persist submissions (still visibly disabled, not silently
  broken); no CRM UI to view the pipeline; no stage transitions past
  QUALIFIED because nothing drives an order past PAID yet (Phase 6 gap
  above).
- **Phase 8 — Training portal.** Schema only.
- **Phase 9 — Admin dashboard.** No admin UI. Service catalogue is
  DB-backed (done early, shared with the Phase 1 seam) but there's no
  `service.pricing` UI, no price-history writes, no metrics dashboard.
- **Phase 10 — Security audit suite.** Not built. 130 tests exist across
  auth, RBAC, money invariants, payments, attribution, commission, CRM,
  env validation, sanitization, and repository — not the 115-attack audit
  the spec describes.
- **Phase 11 — Production prep.** No `/api/health`, no `/api/ready`, no
  Sentry instrumentation.
- **Phase 12 — Hardening.** The commission scheduler AND payout claiming
  are both real now (see ✅ above) — an affiliate can earn, wait out the
  hold, get released, request a payout, get approved, and get marked
  paid, entirely for real. Still missing: no cron *schedule* wired up
  anywhere (the endpoint exists and works, but nothing calls it on a
  timer — that's infrastructure configuration, e.g. Vercel Cron or a
  system crontab, not code, and is listed in
  `PRODUCTION-CHECKLIST.md`'s MANUAL CONFIGURATION section); no real
  RazorpayX/Cashfree disbursement — `markPayoutPaid` is a stand-in an
  admin (or, today, anyone with `payout.approve`) calls manually, not a
  webhook from an actual money-movement provider; no payout UI (an
  affiliate calls the API directly today — there's no button anywhere);
  no MFA enrollment UI.
- **Phase 13 — Real gateway verification.** Not applicable — no live
  Razorpay credentials or verified network path in this environment.

## Scope note: the scheduler auto-approves; there's no UI, and disbursement is manual

The spec's stated commission-entry lifecycle is
`PENDING → APPROVED → AVAILABLE → PAID`. This build's scheduler moves a
matured, verified EARNING entry directly from `PENDING` to `AVAILABLE`,
skipping a manual `APPROVED` gate on the *entry* — there is no admin UI
to approve or hold one specific entry before release. Separately, the
`payouts` row itself does go through its own `REQUESTED → APPROVED → PAID`
states (that part matches spec) — it's the earlier per-entry `APPROVED`
step that's skipped. Building that gate requires the admin dashboard
(Phase 9), which doesn't exist.

`markPayoutPaid` stands in for a real disbursement provider
(RazorpayX/Cashfree Payouts, per `docs/ARCHITECTURE.md` §7) that isn't
integrated — in this build, anyone holding `payout.approve` calls it
directly with a made-up provider reference, rather than it being invoked
by that provider's own webhook once a bank transfer actually clears.
There is also no UI anywhere: every payout action in this session was
driven by calling the API routes directly (`curl` with a session cookie),
not a button an affiliate or admin would click.

## Test count vs. spec

The spec describes 1,044 tests across 11 suites including a 115-attack
security audit. This build has 153 tests across 15 files covering
everything listed as ✅ above. Extending toward the full suite requires
the remaining phases to exist first — an audit test against an admin
endpoint that doesn't exist would be a test of nothing.

## Middleware/Proxy, MFA, rate limiting — explicitly absent, not silently skipped

`src/proxy.ts` (Next 16 renamed the `middleware` file convention — same
runtime, same API) now exists and does exactly one thing: hand off
`?ref=` to the Node attribution route. It makes no authorization
decision, so Rule 11 still holds trivially — deleting it only stops
referral links from being recorded. MFA enforcement in
`docs/ARCHITECTURE.md` §5 is still unreachable in practice: no enrollment
UI exists, so no account can ever have `mfaEnabledAt` set. Rate limiting
still does not exist in any form.

## Known environment limitations

- No Razorpay test credentials and no verified outbound path to
  Razorpay's API — Phase 13 cannot be attempted here regardless of build
  progress.
- `.env.local` used for local verification is gitignored and was never
  committed.

## Immediate next steps, in priority order

1. **Phase 3 (affiliate lifecycle/KYC)** — the biggest remaining gap now
   that the entire money path (earn → hold → release → payout) is real:
   there is still no way for a real person to actually become an
   affiliate. Real registration and activation would also let
   `createTestAffiliate(..., "ACTIVE")` in tests reflect an actual
   reachable state rather than a direct insert.
2. **A minimal payout UI** — the API is real and tested but nobody can
   reach it without calling curl; even a plain HTML button on `/account`
   for "request payout" (affiliate) and an approve/mark-paid list for
   staff would make this session's work actually usable.
3. **Phase 6 order-stage progression past PAID** (onboarding forms,
   requirements lock, team assignment) — unblocks the rest of Phase 7's
   CRM stage mapping, which is already written and tested for the stages
   that exist.
4. **Phase 13**, whenever real Razorpay test credentials and outbound
   network access are available — the signature-verification logic is
   ready to validate against real deliveries; `createOrder` needs a first
   real call.
