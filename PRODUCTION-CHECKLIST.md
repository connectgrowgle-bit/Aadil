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
- ✅ Payment success is never trusted from the frontend — a payment is
  marked CAPTURED only inside the webhook route after signature
  verification; the checkout page's "simulate payment" action POSTs a
  signed delivery to the real webhook endpoint over HTTP rather than
  calling an internal function directly, so this rule is actually
  enforced along the only path that exists. ⚠️ Only exercised against the
  Mock gateway — Razorpay's real webhook format has never been received
  (no credentials, see STATUS.md).
- ✅ Webhook signature verification over the raw body — verified live:
  `request.text()` (never `.json()`) is what's signed/verified; a
  tampered body or wrong signature is rejected with 400, over real HTTP.
- ✅ Webhook idempotency inbox — verified: a byte-identical replay returns
  `{"status":"already processed"}` and writes zero duplicate rows, both
  via direct handler invocation and live HTTP.
- ✅ `PAYMENT_MODE` has no default and is cross-checked against the
  Razorpay key prefix at boot — verified with unit tests.
- ✅ Middleware (`src/proxy.ts` — Next 16 renamed the file convention) is
  not the security boundary: it only hands off `?ref=` to a Node route
  and makes no authorization decision; every authenticated page
  (`/account`, `/checkout/[orderId]`) re-resolves the actor from the
  database independently. Revisit this item once more authenticated
  surfaces exist (Phases 6/7/9 beyond what's built).
- ✅ Sessions are database rows storing only `sha256(token)`, not JWTs —
  verified.
- ✅ Account enumeration closed on login (byte-identical failure shape for
  unknown email vs. wrong password) — verified with tests.
- ⛔ MFA enforcement in the actor guard — not built (Phase 12). No
  enrollment UI exists, so no account can ever set `mfaEnabledAt`.
- ⛔ Commission release scheduler with a dedicated-connection advisory
  lock — not built (Phase 12). Every EARNING entry is written PENDING and
  never advances to AVAILABLE, so nothing is currently payable to any
  affiliate regardless of how much they've earned — see STATUS.md's
  scope note. The earned/reversed *amounts* are correct and tested; only
  the release mechanism is missing.
- ✅ Partial refunds reverse a *proportional* share of commission, derived
  from the provider's cumulative `amount_refunded` (never a locally
  incremented counter) — verified: a second refund webhook with a larger
  cumulative amount reverses only the additional delta; a same-amount
  replay reverses nothing further; a full refund reverses exactly the
  amount earned, no more.
- ✅ A payment without a provider `order_id` cannot be captured — order
  creation always creates the provider order before a payment can exist
  against it; verified in the order-creation tests.

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
- ✅ Razorpay Route/split settlement avoided by design — the
  `PaymentGateway` interface only ever collects (`createOrder` +
  webhook); there is no split-settlement code path to accidentally reach
  for. `docs/ARCHITECTURE.md` §7 records the decision. ⚠️ Disbursement
  (RazorpayX/Cashfree Payouts) itself is not built — moot until the
  Phase 12 scheduler makes anything payable.
- ⛔ `/api/ready` checking database, config, and the money-invariant
  indexes — not built (Phase 11).
- ⚠️ Self-referral (an affiliate buying through their own link) is
  blocked in `createOrder` — verified with a test — but there is no
  equivalent check yet for an affiliate referring a second account they
  also control (would require identity/fraud signals not built).
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
