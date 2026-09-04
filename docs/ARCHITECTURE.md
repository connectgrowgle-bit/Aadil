# GrowEazzy — Architecture

Status: Phase 0 baseline. This document is written before most of the code and
is updated as decisions are made, not left to drift from the implementation.

## 1. What GrowEazzy is

A single-seller Indian performance marketing platform, **not** a marketplace.
GrowEazzy sells three of its own services and runs a single-level affiliate
programme on top of them.

Services: Real Estate Qualified Buyers, AI Content Avatar, Unlimited Video
Editing. Market: India. Currency: INR (integer paise everywhere in the
database). Timezone: IST for display; timestamps stored UTC. Language:
English UI, Hinglish support conversations.

## 2. Decisions the business must make

These are open questions this document does not answer. Engineering has
picked defaults (noted) so the build is not blocked, but each needs a sign-off
before launch:

| Decision | Default taken | Owner |
|---|---|---|
| Registration fee amount/on-off | ₹2,000, admin-configurable, switchable off | Business + Legal |
| Commission rate | 10%, admin-configurable | Business |
| Payout cadence & minimum | Fortnightly, ₹1,000 minimum | Business + Finance |
| TDS rate applied to payouts | Deferred to `commission_policies.tdsRateBasisPoints`, must be confirmed against current IT rules | Finance/Legal |
| Refund window that reverses commission | Deferred to `commission_policies.refundWindowDays` | Business |
| Payout rail | RazorpayX or Cashfree Payouts (see §7) | Engineering + Finance |
| Grievance officer / cooling-off period | Not yet named | Legal (see `COMPLIANCE.md`) |

## 3. High-level architecture

```
                       ┌─────────────────────────┐
                       │   Next.js 16 App Router  │
                       │  (single deployable)     │
                       ├─────────────┬────────────┤
                       │  Public site │ Authed app │
                       │ (repository  │ (dashboard,│
                       │  seam, SSR)  │ admin, CRM)│
                       └──────┬───────┴─────┬──────┘
                              │              │
                     src/lib/repository.ts   │  server actions / route handlers
                              │              │  re-check `can()` per request
                              ▼              ▼
                       ┌───────────────────────────┐
                       │      src/lib/db (Drizzle)  │
                       └──────────────┬─────────────┘
                                      │
                              ┌───────▼────────┐
                              │ PostgreSQL 16   │
                              │ + drizzle/manual│
                              │   (unique idx,  │
                              │    CHECK cons.) │
                              └───────┬─────────┘
                                      │
                     ┌────────────────┼─────────────────┐
                     ▼                ▼                  ▼
             Razorpay (collect)  RazorpayX/Cashfree   Cron (Vercel/host
             webhook (raw body,  Payouts (disburse,   cron or external)
             signature-verified)  separate from        → /api/cron/*
                                   collection)          (CRON_SECRET,
                                                         advisory lock on
                                                         dedicated conn)
```

Everything runs as one Next.js deployable: public marketing pages, the
authenticated client/affiliate/staff/admin dashboards, and the API route
handlers that back them (webhooks, cron, server actions). Middleware only
does cheap, reversible things (referral-cookie handoff, redirect-to-login for
obviously-unauthenticated requests); it is never the source of truth for
authorization — see §5.

## 4. Repository seam (Phase 1)

No component in the public site imports content or data directly. Every read
goes through `src/lib/repository.ts`, whose functions are `async` from day
one even when Phase 1's implementation is an in-memory/static array:

```ts
export async function listServices(): Promise<ServiceSummary[]>
export async function getServiceBySlug(slug: string): Promise<ServiceDetail | null>
export async function listPlansForService(serviceId: string): Promise<ServicePlan[]>
```

Phase 9 swaps the function bodies for Drizzle queries against the
`services` / `service_plans` tables. Because the signatures are already
async and already return the shape the database will produce, no page
changes. This is the single highest-leverage decision in the build: it is
cheap now and expensive to retrofit later, because retrofitting means
touching every page that ever rendered a price.

## 5. Auth & authorization model (Phase 2)

- **Passwords**: Argon2id, `m=19456 KiB, t=2, p=1` (OWASP current baseline).
- **Sessions are rows in `sessions`, not JWTs.** Only `sha256(token)` is
  stored; the raw token lives in an `HttpOnly`, `Secure` (see the
  `NODE_ENV` trap in `docs/MISTAKES.md`), `SameSite=Lax` cookie. A session is
  valid only if **all three** hold:
  1. `expiresAt` (sliding — refreshed on activity) is in the future,
  2. `absoluteExpiresAt` (fixed at creation, never refreshed) is in the future,
  3. `createdAt >= user.sessionsValidFrom` (bumped on password reset or
     suspension, instantly invalidating every other session).
- **Permissions, not role strings.** `can(actorId, permission)` resolves
  `user → user_roles → roles → role_permissions → permissions` on every call.
  No code branches on `role === "ADMIN"`. This is what makes access
  configurable (e.g. carving out `service.pricing` from `service.edit`)
  without a deploy.
- **Middleware is not the security boundary** (Rule 11). Middleware may
  redirect an obviously-anonymous request to `/login` as a UX nicety and
  handle the `?ref=` attribution handoff (§8), but every server component,
  route handler, and server action re-derives the actor from the session
  and re-checks `can()`. Deleting middleware must not expose anything.
- **Enumeration is closed** (Rule 14): unknown email and wrong password
  produce byte-identical timing and response bodies; a resource scoped to
  another user 404s, never 403s.
- **MFA (Phase 12)** is enforced inside the actor-resolution guard itself —
  the one function every page and API route already calls — not the login
  route, so it applies to anything added later without extra wiring.

## 6. Commission engine (Phase 4)

Ledger is `commission_entries`: **append-only**, no mutable balance column.
An earning is a positive `paise` row; a refund/clawback is a **new negative
row**, never an edit of the original. Balance for any affiliate is always
`SUM(paise) ... WHERE status = 'AVAILABLE'` computed at read time — there is
no cached balance to drift.

States: `PENDING → APPROVED → AVAILABLE → PAID`, with `REVERSED` and
`CANCELLED` as distinct terminal outcomes:

- **CANCELLED**: the order never completed (payment failed/abandoned).
  Nothing was ever earned, so no negative row is written — the PENDING
  entry itself transitions to CANCELLED.
- **REVERSED**: money was earned (order completed, commission accrued) and
  is being clawed back (a refund after the fact). Both the original
  earning and the clawback stay in the ledger; nothing is deleted.

Invariant "one earning per conversion" is enforced by a **partial unique
index** (`drizzle/manual/001_commission_indexes.sql`), not application code,
because concurrent request handling is exactly the condition under which
"the code checks first" fails.

Partial refunds reverse a **proportional share** of commission, computed
from the provider's cumulative `amount_refunded` on the payment (never a
locally-incremented counter — a missed webhook makes a local counter drift
forever and never self-corrects).

## 7. Payment flow (Phase 5)

Razorpay Orders API to collect (browser Standard Checkout), **not**
Razorpay Route / split settlement — Route splits at capture time and is
incompatible with hold periods, refund reversals, manual payout approval,
and batched TDS-net payouts. Collection and disbursement are two separate
systems:

1. **Collect**: create a Razorpay Order server-side (amount read from the
   database, never the client) → Standard Checkout → payment lands against
   that order.
2. **Confirm**: a payment is marked successful **only** by (a) a
   signature-verified webhook, verified over the **raw** request body before
   any JSON parsing, using `RAZORPAY_WEBHOOK_SECRET` (a separate value from
   `RAZORPAY_KEY_SECRET` — they come from different dashboard pages), or (b)
   a server-to-server status fetch. Never the frontend's word (Rule 6).
3. **Idempotency**: every webhook delivery is recorded in `webhook_events`
   keyed uniquely on the provider's event id; replays are no-ops.
4. **Disburse**: RazorpayX or Cashfree Payouts, separate from collection,
   after hold period + manual approval + TDS calculation, via the
   `PayoutGateway` interface (mirrors the `PaymentGateway` seam from Phase 3).
5. **PAYMENT_MODE has no default** and is cross-checked at boot against the
   key prefix (`rzp_test_` vs `rzp_live_`) — a mismatch refuses to boot
   rather than silently taking money in the wrong mode.

## 8. Attribution (Phase 4)

Per-service referral links (`/ai-content-avatar?ref=GEA10245`) must work on
any public URL. Middleware detects `?ref=`, hands off to a Node route that
(a) records the click server-side, (b) sets a signed, HttpOnly cookie, then
(c) redirects to the same URL with `ref` stripped — so a page refresh is not
a second click, and a URL shared onward (now without `?ref=`) does not
silently re-attribute to whoever re-shares it.

## 9. Schema

47 tables across five domains (Auth, Affiliate, Client, Training, Support) —
full DDL lives in `src/lib/db/schema/*.ts`; the list matches spec §4
verbatim. ERD (textual, grouped by domain):

```
Auth        users ─┬─ profiles
                    ├─ user_roles ─── roles ─── role_permissions ─── permissions
                    ├─ sessions
                    ├─ auth_tokens
                    ├─ files
                    ├─ mfa_recovery_codes / mfa_used_codes
                    └─ audit_logs, job_runs (system-wide)

Affiliate   affiliates ─┬─ affiliate_kyc
                        ├─ affiliate_links ─── affiliate_clicks ─── affiliate_leads
                        ├─ affiliate_conversions ─── commission_entries (append-only)
                        ├─ payouts ─── payout_batches
                        └─ payments ─── payment_transactions
            webhook_events, commission_policies, settings, settings_history
                        (platform-wide, not affiliate-scoped)

Client      orders ─┬─ order_events, order_assignments, order_files
                    ├─ onboarding_submissions
                    ├─ meetings, deliverables
                    └─ crm_contacts ─── crm_activities, crm_notes, crm_tasks
            services ─── service_plans ─── service_plan_price_history

Training    training_courses ─── training_modules ─── training_videos
                        └─ training_progress (per user × video)

Support     support_tickets ─── support_messages
            notifications (cross-cutting)
```

Hand-written SQL (`drizzle/manual/*.sql`) carries what Drizzle's schema DSL
cannot express: partial unique indexes and CHECK constraints (§4 of the
spec, reproduced in that directory). `ops/migrate.sh` applies
`drizzle-kit`-generated migrations then these manual files via `psql`, and
**verifies they landed** by querying `pg_indexes`/`pg_constraint` — a
database missing them looks identical to one that has them until the first
race condition.

## 10. Known gaps (carried forward from spec §13, not accidental)

Rate limiting is in-memory (needs Redis across instances); CSP allows
`'unsafe-inline'` for scripts pending Next bootstrap nonces; no virus
scanning (`files.scanStatus = 'PENDING'` forever until wired up); no CSRF
tokens beyond `SameSite=Lax` + JSON content-type; `PII_ENCRYPTION_KEY` is
not rotatable; Tailwind 4 requires Safari 16.4+.

## 11. Build status

See `STATUS.md` at the repo root for what is implemented, tested, and what
remains — kept current, not a snapshot of this document's writing date.
