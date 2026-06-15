-- ╔═══════════════════════════════════════════════════════════╗
-- ║ Phase 11 — 001: UNIQUE (username) on tbl_user             ║
-- ╚═══════════════════════════════════════════════════════════╝
-- Production tbl_user has never had a UNIQUE constraint on
-- username. Auth code assumes usernames are unique (SELECT ...
-- WHERE username=$1 → row), so this has worked by convention
-- but a bug in the create-user path could happily insert a
-- duplicate. Add the constraint.
--
-- Guards against existing duplicates: if any exist we warn and
-- skip (so the migration never hard-fails); the constraint can
-- be added by hand after the dup is resolved.
-- Idempotent.

BEGIN;

DO $$
DECLARE
    dup_count INTEGER;
BEGIN
    -- already have a UNIQUE index/constraint on username?
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND tablename='tbl_user'
          AND indexdef ILIKE '%UNIQUE%(username%'
    ) THEN
        RAISE NOTICE '  • UNIQUE(username) already exists — skipping';
        RETURN;
    END IF;

    SELECT COUNT(*) INTO dup_count FROM (
        SELECT username FROM tbl_user GROUP BY username HAVING COUNT(*) > 1
    ) d;

    IF dup_count > 0 THEN
        RAISE WARNING '  ⚠ % duplicate username(s) found — UNIQUE constraint skipped. Resolve duplicates then add manually:', dup_count;
        RAISE WARNING '     CREATE UNIQUE INDEX tbl_user_username_uniq ON tbl_user(username);';
        RETURN;
    END IF;

    CREATE UNIQUE INDEX tbl_user_username_uniq ON tbl_user(username);
    RAISE NOTICE '  ✔ UNIQUE(username) added to tbl_user';
END $$;

COMMIT;
