-- ╔═══════════════════════════════════════════════════════════╗
-- ║ Phase 11 — tbl_action_admin.project_id → NULLABLE         ║
-- ╚═══════════════════════════════════════════════════════════╝
-- Admin actions are not always bound to a project. The admin
-- account in particular has no project_id, so every call to
-- logAdminAction() was failing the NOT NULL constraint and
-- emitting "[action-log] null value in column project_id"
-- warnings during boot / admin operations.
--
-- Fix: drop NOT NULL. The INSERT in server.js is updated in the
-- same commit to pass the admin's project_id (which may be NULL)
-- so entries with a project still record it.
--
-- Idempotent: only alters if column is currently NOT NULL.

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='tbl_action_admin'
          AND column_name='project_id'
          AND is_nullable='NO'
    ) THEN
        ALTER TABLE tbl_action_admin ALTER COLUMN project_id DROP NOT NULL;
        RAISE NOTICE '  ✔ tbl_action_admin.project_id → NULLABLE';
    ELSE
        RAISE NOTICE '  • tbl_action_admin.project_id already nullable';
    END IF;
END $$;
