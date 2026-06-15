-- ════════════════════════════════════════════════════════════
-- Phase 5 — Money columns: FLOAT(53) → DECIMAL(12,2)
-- ════════════════════════════════════════════════════════════
-- WHY: FLOAT/DOUBLE PRECISION cannot represent 0.10, 0.20, etc. exactly.
--      Adding 0.10 ten times yields 0.9999999999999999 instead of 1.00.
--      For money, this is unacceptable. DECIMAL(12,2) gives exact 2-dp.
--
-- BEFORE running:
--   • take a backup:  pg_dump -h 192.168.69.125 -U postgres OpenAI_DB > backup.sql
--   • Stop the server (or set a maintenance flag)
--
-- SAFE TO RUN MULTIPLE TIMES (idempotent — checks current type first).
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ── tbl_balance.project_credits ──────────────────────────────
DO $$
DECLARE current_type TEXT;
BEGIN
    SELECT data_type INTO current_type FROM information_schema.columns
    WHERE table_name='tbl_balance' AND column_name='project_credits';
    IF current_type = 'double precision' THEN
        ALTER TABLE tbl_balance
            ALTER COLUMN project_credits TYPE DECIMAL(12,2)
            USING ROUND(project_credits::numeric, 2);
        RAISE NOTICE '  ✔ tbl_balance.project_credits → DECIMAL(12,2)';
    ELSE
        RAISE NOTICE '  ⊙ tbl_balance.project_credits already %', current_type;
    END IF;
END $$;

-- ── tbl_credits.user_credits ─────────────────────────────────
DO $$
DECLARE current_type TEXT;
BEGIN
    SELECT data_type INTO current_type FROM information_schema.columns
    WHERE table_name='tbl_credits' AND column_name='user_credits';
    IF current_type = 'double precision' THEN
        ALTER TABLE tbl_credits
            ALTER COLUMN user_credits TYPE DECIMAL(12,2)
            USING ROUND(user_credits::numeric, 2);
        RAISE NOTICE '  ✔ tbl_credits.user_credits → DECIMAL(12,2)';
    ELSE
        RAISE NOTICE '  ⊙ tbl_credits.user_credits already %', current_type;
    END IF;
END $$;

-- ── Verify ───────────────────────────────────────────────────
SELECT
    table_name, column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE (table_name='tbl_balance' AND column_name='project_credits')
   OR (table_name='tbl_credits'  AND column_name='user_credits');

COMMIT;
