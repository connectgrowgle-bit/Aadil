-- An EARNING is always a positive row; a REVERSAL is always a new negative
-- row (Rule 2 — the ledger is append-only, the original is never edited).
-- ADJUSTMENT is intentionally left unconstrained in sign: it exists for
-- manual corrections in either direction, always with a required `reason`.
-- Guarded for idempotent re-runs — Postgres has no ADD CONSTRAINT IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commission_entries_earning_is_positive'
  ) THEN
    ALTER TABLE commission_entries
      ADD CONSTRAINT commission_entries_earning_is_positive
      CHECK (type != 'EARNING' OR paise > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commission_entries_reversal_is_negative'
  ) THEN
    ALTER TABLE commission_entries
      ADD CONSTRAINT commission_entries_reversal_is_negative
      CHECK (type != 'REVERSAL' OR paise < 0);
  END IF;
END $$;
