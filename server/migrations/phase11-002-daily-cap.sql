-- ╔═══════════════════════════════════════════════════════════╗
-- ║ Phase 11 — 002: per-user daily spending cap               ║
-- ╚═══════════════════════════════════════════════════════════╝
-- Adds tbl_user.daily_cap (NUMERIC, nullable).
--   NULL      = no cap (default; existing users keep current behavior)
--   > 0       = hard ceiling in same unit as tbl_credits (฿)
--   0         = effectively blocks all AI usage for the day
--
-- Enforcement lives in server.js /api/chat: we sum today's cost from
-- tbl_response × tbl_project rates and 402 the request if the next
-- call would cross the cap.
-- Idempotent.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='tbl_user' AND column_name='daily_cap'
    ) THEN
        ALTER TABLE tbl_user ADD COLUMN daily_cap NUMERIC(12,2) NULL;
        RAISE NOTICE '  ✔ tbl_user.daily_cap NUMERIC(12,2) added (NULL = no cap)';
    ELSE
        RAISE NOTICE '  • tbl_user.daily_cap already exists';
    END IF;
END $$;

-- Range check: non-negative
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='tbl_user' AND constraint_name='tbl_user_daily_cap_nonneg'
    ) THEN
        ALTER TABLE tbl_user
            ADD CONSTRAINT tbl_user_daily_cap_nonneg
            CHECK (daily_cap IS NULL OR daily_cap >= 0);
        RAISE NOTICE '  ✔ CHECK(daily_cap >= 0) added';
    ELSE
        RAISE NOTICE '  • daily_cap CHECK already exists';
    END IF;
END $$;

COMMIT;
