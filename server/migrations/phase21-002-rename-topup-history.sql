-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  Phase 21.2 — Rename tbl_topup_history → tbl_topup_project        ║
-- ╚═══════════════════════════════════════════════════════════════════╝
-- Naming alignment: the table holds project-level top-up events, and
-- `tbl_topup_project` reads better next to `tbl_balance` (project-scoped
-- pool) and `tbl_credits` (user-scoped balance). The old name kept showing
-- up in design reviews as "is this user history or project history?".
--
-- Migration is idempotent — runs safely whether or not the rename has
-- already been applied (the prod DB was renamed manually first; this
-- file makes a fresh deploy follow the same path automatically).
--
-- Renames propagated to:
--   - the table itself
--   - the PRIMARY KEY constraint
--   - the FK constraints
--   - the indexes
--   - the sequence backing `id`
--
-- After applying, server.js, admin.js, validation.js, and docs/ all
-- reference the new name. Old migrations (phase16-001, phase20-001)
-- are left untouched — they captured the prior state truthfully.

DO $$
DECLARE
    has_old BOOLEAN;
    has_new BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='tbl_topup_history'
    ) INTO has_old;
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='tbl_topup_project'
    ) INTO has_new;

    IF has_old AND NOT has_new THEN
        RAISE NOTICE 'phase21-002: renaming tbl_topup_history → tbl_topup_project';
        ALTER TABLE tbl_topup_history RENAME TO tbl_topup_project;
    ELSIF NOT has_old AND has_new THEN
        RAISE NOTICE 'phase21-002: already renamed — no-op';
    ELSIF has_old AND has_new THEN
        RAISE EXCEPTION 'phase21-002: both old and new tables exist — please reconcile manually';
    ELSE
        RAISE EXCEPTION 'phase21-002: neither old nor new table exists — schema corrupt?';
    END IF;
END $$;

-- Rename the sequence backing the id column (cosmetic but tidy)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_sequences
               WHERE schemaname='public' AND sequencename='tbl_topup_history_id_seq') THEN
        ALTER SEQUENCE tbl_topup_history_id_seq RENAME TO tbl_topup_project_id_seq;
    END IF;
END $$;
