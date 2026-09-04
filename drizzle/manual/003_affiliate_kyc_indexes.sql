-- One active (in-review or approved) KYC submission per affiliate. A
-- rejected or draft row does not block a fresh submission, so a rejected
-- affiliate can resubmit without a stale row blocking them.
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_kyc_one_active_uidx
  ON affiliate_kyc (affiliate_id)
  WHERE status IN ('SUBMITTED', 'APPROVED');
