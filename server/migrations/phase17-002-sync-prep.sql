-- ╔═══════════════════════════════════════════════════════════╗
-- ║ Phase 17.2 — prepare for OpenAI Usage API background sync  ║
-- ╚═══════════════════════════════════════════════════════════╝
--
-- Two changes needed before the sync job can run:
--
-- 1) Fix tbl_daily_token PK
--    OpenAI returns usage buckets grouped by (date × project × model).
--    The original PK (usage_date_th) only allows 1 row per day total —
--    that's wrong for multi-project, multi-model storage. Change to
--    composite PK (usage_date_th, project_id, model). Safe because the
--    table is currently empty (verified row_count=0).
--
-- 2) Add tbl_sync_state
--    Tiny singleton table tracking the background sync job's health:
--      - last_run_at         when the job last completed (or attempted)
--      - last_status         'ok' | 'error' | 'partial'
--      - last_error          error message if it failed
--      - last_duration_ms    how long the job took
--      - rows_synced_total   running total since boot
--    Used by the new "Sync Status" admin tab + manual "Sync Now" button.
--
-- Idempotent: re-running this migration is a no-op.

DO $$
BEGIN
    -- 1) tbl_daily_token PK fix
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'tbl_daily_token_pkey'
           AND pg_get_constraintdef(oid) = 'PRIMARY KEY (usage_date_th)'
    ) THEN
        ALTER TABLE tbl_daily_token DROP CONSTRAINT tbl_daily_token_pkey;
        ALTER TABLE tbl_daily_token
            ADD CONSTRAINT tbl_daily_token_pkey
            PRIMARY KEY (usage_date_th, project_id, model);
        RAISE NOTICE 'tbl_daily_token PK upgraded → (usage_date_th, project_id, model)';
    ELSE
        RAISE NOTICE 'tbl_daily_token PK already composite — skip';
    END IF;
END $$;

-- 2) Sync state singleton (one row, id=1)
CREATE TABLE IF NOT EXISTS tbl_sync_state (
    id                 INTEGER PRIMARY KEY CHECK (id = 1),
    last_run_at        TIMESTAMPTZ,
    last_status        VARCHAR(20),                 -- 'ok' | 'error' | 'partial' | 'running'
    last_error         TEXT,
    last_duration_ms   INTEGER,
    last_rows_inserted INTEGER     DEFAULT 0,
    rows_synced_total  BIGINT      DEFAULT 0,       -- running total since first run
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Seed the single row so subsequent UPDATEs just work.
INSERT INTO tbl_sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Helpful index on tbl_daily_token for per-project queries
CREATE INDEX IF NOT EXISTS ix_daily_token_project_date
    ON tbl_daily_token (project_id, usage_date_th DESC);
