-- One EARNING commission entry per conversion, enforced by the database
-- because concurrent request handling is exactly the condition under
-- which "the code checked first" fails. Reversals/adjustments are not
-- constrained here — a conversion can have multiple REVERSAL rows against
-- its single EARNING (partial refunds) — see docs/ARCHITECTURE.md §6.
CREATE UNIQUE INDEX IF NOT EXISTS commission_one_earning_per_conversion_uidx
  ON commission_entries (conversion_id)
  WHERE type = 'EARNING';
