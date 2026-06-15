-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  Phase 21.11 — Consolidate per-user wallets into project pools          ║
-- ║  (Concept B switchover, one-time)                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- Under Concept A the per-user `tbl_credits.user_credits` held real money
-- (a personal wallet). Under Concept B the single source of truth is the
-- project pool `tbl_balance.project_credits`; per-user balances become
-- daily-cap limits instead of wallets.
--
-- This one-shot data migration:
--   1. For every user with user_credits > 0: add that amount to its project
--      pool (tbl_balance.project_credits).
--   2. Write a 'adjustment' row in tbl_user_credit_transaction with
--      ref_type='wallet_consolidation' so the move is auditable.
--   3. Zero out the user's wallet.
--
-- Idempotent: re-running finds 0 wallets > 0 → no-op.
-- project_credits_amount (lifetime top-up) is intentionally NOT touched —
-- this is a re-categorisation of existing money, not a new top-up.

DO $mig$
DECLARE
    rec          RECORD;
    pool_before  NUMERIC;
    pool_after   NUMERIC;
BEGIN
    FOR rec IN
        SELECT user_id, project_id, user_credits
        FROM   tbl_credits
        WHERE  user_credits > 0
        ORDER  BY user_id
    LOOP
        -- Upsert the project pool (some projects have no balance row yet).
        IF EXISTS (SELECT 1 FROM tbl_balance WHERE project_id = rec.project_id) THEN
            SELECT project_credits INTO pool_before
              FROM tbl_balance WHERE project_id = rec.project_id;
            UPDATE tbl_balance
               SET project_credits = project_credits + rec.user_credits
             WHERE project_id = rec.project_id
            RETURNING project_credits INTO pool_after;
        ELSE
            pool_before := 0;
            INSERT INTO tbl_balance
                 (project_id, project_credits, project_credits_amount,
                  user_id, top_up_date, top_up_time)
            VALUES (rec.project_id, rec.user_credits, 0,
                  1, CURRENT_DATE, NOW())
            RETURNING project_credits INTO pool_after;
        END IF;

        -- Audit trail in the per-user journal.
        --   amount        = negative (money leaving the user's wallet)
        --   balance_before / balance_after = the user wallet snapshot
        --                                    (interpretation: per-user wallet)
        --   note records the new project pool snapshot for traceability.
        INSERT INTO tbl_user_credit_transaction
            (user_id, project_id, transaction_type, amount,
             balance_before, balance_after,
             ref_type, note, created_by)
        VALUES
            (rec.user_id, rec.project_id, 'adjustment',
             -rec.user_credits,
             rec.user_credits, 0,
             'wallet_consolidation',
             FORMAT('Concept B migration: wallet %s folded into project pool (pool %s → %s)',
                    rec.user_credits, pool_before, pool_after),
             NULL);

        -- Zero the wallet (preserves the row so existing FKs / queries don't blow up).
        UPDATE tbl_credits
           SET user_credits = 0
         WHERE user_id = rec.user_id AND project_id = rec.project_id;
    END LOOP;
END
$mig$;
