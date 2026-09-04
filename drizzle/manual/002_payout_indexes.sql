-- One open payout per affiliate at a time — prevents a second payout
-- request from claiming commission entries an in-flight payout already
-- claims (docs/MISTAKES.md item 5: "availablePaise counted money already
-- claimed by an open payout").
CREATE UNIQUE INDEX IF NOT EXISTS payouts_one_open_per_affiliate_uidx
  ON payouts (affiliate_id)
  WHERE status IN ('REQUESTED', 'APPROVED', 'PROCESSING');

-- net = gross - tds, enforced at the database, not just at the write path.
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so guard it explicitly —
-- this file must be safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payouts_net_is_gross_minus_tds'
  ) THEN
    ALTER TABLE payouts
      ADD CONSTRAINT payouts_net_is_gross_minus_tds
      CHECK (net_paise = gross_paise - tds_paise);
  END IF;
END $$;
