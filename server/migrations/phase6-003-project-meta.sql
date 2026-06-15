-- ╔═══════════════════════════════════════════════════════════╗
-- ║ Phase 6 — 003: tbl_project metadata columns               ║
-- ╚═══════════════════════════════════════════════════════════╝
-- Adds description / pricing rates / per-user credit limit so
-- admin Project CRUD is fully DB-backed (was localStorage-only).
-- All idempotent — safe to re-run.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tbl_project' AND column_name='description') THEN
        ALTER TABLE tbl_project ADD COLUMN description TEXT DEFAULT '';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tbl_project' AND column_name='input_rate') THEN
        ALTER TABLE tbl_project ADD COLUMN input_rate NUMERIC(10,4) DEFAULT 0.50;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tbl_project' AND column_name='output_rate') THEN
        ALTER TABLE tbl_project ADD COLUMN output_rate NUMERIC(10,4) DEFAULT 1.50;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tbl_project' AND column_name='credit_limit') THEN
        ALTER TABLE tbl_project ADD COLUMN credit_limit NUMERIC(12,2) DEFAULT 0;
    END IF;
END $$;

COMMIT;
