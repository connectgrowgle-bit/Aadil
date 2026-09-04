#!/usr/bin/env bash
# Applies drizzle-kit-generated migrations, then the hand-written manual
# SQL (partial unique indexes, CHECK constraints — see drizzle/manual/),
# then VERIFIES the manual migrations actually landed. A database missing
# them looks fine right up until the first race condition or bad refund —
# see docs/ARCHITECTURE.md §9 and spec §4.
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set." >&2
  exit 1
fi

if [[ "$DATABASE_URL" == *"?schema="* || "$DATABASE_URL" == *"&schema="* ]]; then
  echo "DATABASE_URL must not contain a ?schema= parameter (pg_dump rejects it)." >&2
  exit 1
fi

cd "$(dirname "$0")/.."

npx tsx ops/migrate.ts

echo "==> Applying hand-written manual migrations"
for f in drizzle/manual/*.sql; do
  [[ -e "$f" ]] || continue
  echo "  - $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo "==> Verifying money invariants landed"
verify() {
  local desc="$1" sql="$2"
  local result
  result=$(psql "$DATABASE_URL" -tAc "$sql")
  if [[ "$result" != "t" ]]; then
    echo "MISSING INVARIANT: $desc" >&2
    exit 1
  fi
  echo "  - OK: $desc"
}

verify "commission_one_earning_per_conversion_uidx exists" \
  "SELECT count(*)::int > 0 FROM pg_indexes WHERE indexname = 'commission_one_earning_per_conversion_uidx'"
verify "payouts_one_open_per_affiliate_uidx exists" \
  "SELECT count(*)::int > 0 FROM pg_indexes WHERE indexname = 'payouts_one_open_per_affiliate_uidx'"
verify "payouts_net_is_gross_minus_tds CHECK exists" \
  "SELECT count(*)::int > 0 FROM pg_constraint WHERE conname = 'payouts_net_is_gross_minus_tds'"
verify "affiliate_kyc_one_active_uidx exists" \
  "SELECT count(*)::int > 0 FROM pg_indexes WHERE indexname = 'affiliate_kyc_one_active_uidx'"
verify "commission_entries_earning_is_positive CHECK exists" \
  "SELECT count(*)::int > 0 FROM pg_constraint WHERE conname = 'commission_entries_earning_is_positive'"
verify "commission_entries_reversal_is_negative CHECK exists" \
  "SELECT count(*)::int > 0 FROM pg_constraint WHERE conname = 'commission_entries_reversal_is_negative'"

echo "==> Migration complete and verified."
