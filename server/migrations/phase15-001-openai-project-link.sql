-- ╔═══════════════════════════════════════════════════════════╗
-- ║ Phase 15 — link tbl_project to OpenAI projects             ║
-- ╚═══════════════════════════════════════════════════════════╝
-- Each dashboard project will be paired with one OpenAI project
-- and one service-account API key. This lets us:
--   • route chat traffic per-project (each project pays its own usage)
--   • pull per-project usage / cost data via the Admin API
--   • archive at OpenAI when admin deletes the project here
--
-- New columns on tbl_project:
--   openai_project_id          OpenAI's id (e.g. proj_AbC123…) UNIQUE
--   openai_service_account_id  id of the service-account that owns the key
--   openai_synced_at           when we last touched OpenAI for this row
--
-- Loosened constraints:
--   project_api_key  TEXT (was VARCHAR 255) + NULL allowed
--                    → encrypted form will be longer; legacy rows may be empty
--   admin_api_key    NULL allowed
--                    → no longer required per-project (master admin key in .env)
--
-- Idempotent via IF NOT EXISTS — safe to re-run.

-- ─── new columns ──────────────────────────────────────────
ALTER TABLE tbl_project
    ADD COLUMN IF NOT EXISTS openai_project_id         VARCHAR(64),
    ADD COLUMN IF NOT EXISTS openai_service_account_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS openai_synced_at          TIMESTAMPTZ;

-- One OpenAI project ↔ at most one dashboard project
CREATE UNIQUE INDEX IF NOT EXISTS ux_tbl_project_openai_project_id
    ON tbl_project (openai_project_id)
    WHERE openai_project_id IS NOT NULL;

-- ─── widen + relax key columns ────────────────────────────
-- ALTER … TYPE TEXT is a no-op if already TEXT; ALTER … DROP NOT NULL
-- is idempotent. Wrapping in DO block lets us survive missing tables
-- gracefully even though tbl_project is part of phase0.
DO $$
BEGIN
    -- project_api_key: VARCHAR(255) NOT NULL  →  TEXT NULL
    BEGIN
        ALTER TABLE tbl_project ALTER COLUMN project_api_key TYPE TEXT;
    EXCEPTION WHEN others THEN
        RAISE NOTICE 'project_api_key TYPE change skipped: %', SQLERRM;
    END;
    BEGIN
        ALTER TABLE tbl_project ALTER COLUMN project_api_key DROP NOT NULL;
    EXCEPTION WHEN others THEN
        RAISE NOTICE 'project_api_key DROP NOT NULL skipped: %', SQLERRM;
    END;

    -- admin_api_key: VARCHAR(255) NOT NULL  →  TEXT NULL  (kept for back-compat)
    BEGIN
        ALTER TABLE tbl_project ALTER COLUMN admin_api_key TYPE TEXT;
    EXCEPTION WHEN others THEN
        RAISE NOTICE 'admin_api_key TYPE change skipped: %', SQLERRM;
    END;
    BEGIN
        ALTER TABLE tbl_project ALTER COLUMN admin_api_key DROP NOT NULL;
    EXCEPTION WHEN others THEN
        RAISE NOTICE 'admin_api_key DROP NOT NULL skipped: %', SQLERRM;
    END;
END $$;
