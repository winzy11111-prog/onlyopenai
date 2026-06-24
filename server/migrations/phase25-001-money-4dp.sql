-- Phase 25: store money balances at 4 decimal places instead of 2.
-- The pool/credit columns were NUMERIC(12,2), but per-chat costs are computed
-- at 4-6 decimals and the credit ledger (tbl_user_credit_transaction) is
-- NUMERIC(12,4). Deducting a 4-decimal cost from a 2-decimal pool rounded the
-- pool each time → the pool drifted from the ledger by ~0.001-0.005 per chat
-- ("money disappearing"). Widening these balances to NUMERIC(12,4) makes the
-- pool reconcile exactly with the ledger — no rounding loss.
--
-- Only accumulating balances / topup records are changed (no view depends on
-- them; verified). Threshold/config columns (daily_cap, credit_limit, etc.)
-- stay NUMERIC(12,2) — they are limits, not deducted balances, so they don't
-- drift. Widening scale (12,2 → 12,4) is lossless: 994.00 → 994.0000.
-- ALTER COLUMN TYPE to the same type is a no-op, so this is safe to re-run.

ALTER TABLE tbl_balance       ALTER COLUMN project_credits        TYPE NUMERIC(12,4);
ALTER TABLE tbl_balance       ALTER COLUMN project_credits_amount TYPE NUMERIC(12,4);
ALTER TABLE tbl_credits       ALTER COLUMN user_credits           TYPE NUMERIC(12,4);
ALTER TABLE tbl_user          ALTER COLUMN bonus_balance          TYPE NUMERIC(12,4);
ALTER TABLE tbl_topup_project ALTER COLUMN amount                 TYPE NUMERIC(12,4);
ALTER TABLE tbl_topup_project ALTER COLUMN balance_before         TYPE NUMERIC(12,4);
ALTER TABLE tbl_topup_project ALTER COLUMN balance_after          TYPE NUMERIC(12,4);
