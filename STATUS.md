# GrowEazzy — Build Status

Last updated: 2026-09-04 (session 2). This is a partial build against the
full 13-phase GrowEazzy spec — Phases 0–2 and 1 fully, plus real slices of
Phases 4, 5, 6, and 7, built and verified across two sessions against a
real PostgreSQL 16 instance. **It is not production ready.** Phases 3, 8,
9, 10, 11, 12, and 13 do not exist yet, and the Phase 4/5/6/7 slices that
do exist are narrower than their full spec scope — see below for exactly
what's covered. Nothing marked ✅ is a simulation described as if it were
real: every one was run against a live database, and the payment/webhook
path was also exercised over real HTTP with a live server.

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
| Rich-text sanitization at the read boundary | ✅ | Script tags, event handlers, `javascript:` hrefs all stripped |
| Lint / typecheck / build | ✅ | `npm run lint` (`--max-warnings=0`), `npm run typecheck`, `npm run build` all pass clean, including the Next 16 `middleware` → `proxy` rename |
| Test suite | ✅ | **130 tests across 12 files**, all passing against a live database (not the 1,044 the full spec calls for — see below) |
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

## What's explicitly NOT built

- **Phase 3 — Affiliate lifecycle & KYC.** Schema exists; no
  registration/KYC-submission UI, no state-machine enforcing
  `REGISTERED → KYC_PENDING → ... → ACTIVE`, no PII encryption
  implementation (`PII_ENCRYPTION_KEY` is validated but nothing uses it),
  no registration-fee payment flow. `createTestAffiliate` in the test
  suite inserts directly with `status: "ACTIVE"` — there's no real
  activation path yet.
- **Phase 4 — Attribution & commission**: the click → cookie → conversion
  → capture → earn → refund → reverse chain is real and tested (see
  above). What's missing: leads (`affiliate_leads` — schema only, unused),
  and the Phase 12 scheduler that would move an EARNING entry from
  PENDING through APPROVED/AVAILABLE to PAID — see the commission-engine
  scope note below.
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
- **Phase 12 — Hardening.** No commission scheduler (see the PENDING-only
  scope note below), no advisory-lock logic, no MFA enrollment UI.
- **Phase 13 — Real gateway verification.** Not applicable — no live
  Razorpay credentials or verified network path in this environment.

## Scope note: commission entry status is frozen at PENDING

`confirmConversionAndEarn` writes every EARNING entry with
`status: "PENDING"` and it never advances, because the Phase 12 scheduler
that would move it through `APPROVED → AVAILABLE → PAID` after the hold
period doesn't exist yet. This is a deliberate, documented scope
boundary, not a bug: `docs/ARCHITECTURE.md` §6 says balance is always
`SUM(paise) WHERE status = 'AVAILABLE'`, and under this build that sum is
always zero for every affiliate — money is correctly and safely tracked
in the ledger (the tests prove the *amounts* are exactly right, including
under partial and repeated refunds), but nothing is ever payable yet.
Building the scheduler is the very next piece of work this unblocks.

## Test count vs. spec

The spec describes 1,044 tests across 11 suites including a 115-attack
security audit. This build has 130 tests across 12 files covering
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

1. **Phase 12's commission scheduler** — the highest-leverage next step
   given what exists: the earning/reversal amounts are already correct
   and tested, but nothing ever becomes payable without it.
2. **Phase 3 (affiliate lifecycle/KYC)** — real registration and
   activation, so `createTestAffiliate(..., "ACTIVE")` in tests reflects
   an actual reachable state rather than a direct insert.
3. **Phase 6 order-stage progression past PAID** (onboarding forms,
   requirements lock, team assignment) — unblocks the rest of Phase 7's
   CRM stage mapping, which is already written and tested for the stages
   that exist.
4. **Phase 13**, whenever real Razorpay test credentials and outbound
   network access are available — the signature-verification logic is
   ready to validate against real deliveries; `createOrder` needs a first
   real call.
