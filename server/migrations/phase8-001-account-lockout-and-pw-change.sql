-- ╔═══════════════════════════════════════════════════════════╗
-- ║ Phase 8 — 001: Account lockout + first-login pw change   ║
-- ╚═══════════════════════════════════════════════════════════╝
-- 1. failed_attempts / locked_until: brute-force defense beyond rate-limit.
--    rate-limit covers 15-min windows; lockout persists across windows
--    and survives server restart, so attackers cannot just wait it out.
-- 2. must_change_password: set TRUE for any password an admin sets
--    (POST /api/users, PUT /api/users/:id with password field, admin
--    using PUT /api/users/:id/password on someone else). Cleared the
--    moment the user picks their own via PUT /api/users/:id/password.
-- All idempotent — safe to re-run.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tbl_user' AND column_name='failed_attempts') THEN
        ALTER TABLE tbl_user ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tbl_user' AND column_name='locked_until') THEN
        ALTER TABLE tbl_user ADD COLUMN locked_until TIMESTAMPTZ NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tbl_user' AND column_name='must_change_password') THEN
        ALTER TABLE tbl_user ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
END $$;

-- locked-account scan (admin "show locked users") is the read pattern;
-- partial index keeps it tiny — most users are not locked.
CREATE INDEX IF NOT EXISTS idx_user_locked
    ON tbl_user (locked_until) WHERE locked_until IS NOT NULL;

COMMIT;
