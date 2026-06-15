-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  Phase 21.3 — Collapse tbl_daily_usage to user-day rollup         ║
-- ╚═══════════════════════════════════════════════════════════════════╝
-- Original (Phase 21.1) granularity: (usage_date, user_id, session_id, model)
-- → 1 row per chat session per model per day → table grows with conversations.
--
-- New granularity: (usage_date, user_id)
-- → 1 row per user per day, all sessions + all models summed together.
--
-- Why
-- ───
--   • Dashboards ที่ใช้บ่อยที่สุดคือ "user นี้ใช้เท่าไรวันนี้" — ไม่ใช่
--     "session นี้ใช้เท่าไร" (ที่ดูได้จาก tbl_chat_session.total_cost แล้ว)
--   • หลาย session ของ user เดียวกัน = หลาย row โดยไม่จำเป็น (กิน space)
--   • Per-model breakdown ยังหาได้จาก tbl_chat_message ตามต้องการ
--
-- Implementation
-- ──────────────
-- Idempotent guard: ดู column session_id ก่อน — ถ้าหายไปแล้ว = migrated.
-- Else: aggregate to temp → drop → recreate → restore.

DO $$
DECLARE
    has_session_col BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='tbl_daily_usage'
          AND column_name='session_id'
    ) INTO has_session_col;

    IF NOT has_session_col THEN
        RAISE NOTICE 'phase21-003: already migrated — no-op';
        RETURN;
    END IF;

    RAISE NOTICE 'phase21-003: aggregating tbl_daily_usage to (date, user_id) granularity...';

    -- 1. Snapshot aggregated data to a temp table.
    --    array_agg(... ORDER BY ...)[1] picks the project_id with the latest
    --    activity in case the user moved projects mid-day (rare).
    CREATE TEMP TABLE _tmp_daily_usage_agg AS
    SELECT
        usage_date,
        user_id,
        (array_agg(project_id ORDER BY last_updated_at DESC))[1] AS project_id,
        SUM(input_tokens)::int      AS input_tokens,
        SUM(cached_tokens)::int     AS cached_tokens,
        SUM(output_tokens)::int     AS output_tokens,
        SUM(reasoning_tokens)::int  AS reasoning_tokens,
        SUM(request_count)::int     AS request_count,
        SUM(total_cost)             AS total_cost,
        SUM(total_price)            AS total_price,
        MIN(first_seen_at)          AS first_seen_at,
        MAX(last_updated_at)        AS last_updated_at
    FROM tbl_daily_usage
    GROUP BY usage_date, user_id;

    -- 2. Drop the old table (CASCADE removes its FKs + indexes).
    --    Generated column `margin` goes with it.
    DROP TABLE tbl_daily_usage CASCADE;

    -- 3. Recreate with new schema. session_id + model are GONE; everything
    --    else preserved. PK now (usage_date, user_id) only.
    CREATE TABLE tbl_daily_usage (
        usage_date            DATE         NOT NULL,
        user_id               INTEGER      NOT NULL,
        project_id            VARCHAR(100) NOT NULL,

        input_tokens          INTEGER NOT NULL DEFAULT 0,
        cached_tokens         INTEGER NOT NULL DEFAULT 0,
        output_tokens         INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens      INTEGER NOT NULL DEFAULT 0,
        request_count         INTEGER NOT NULL DEFAULT 0,

        total_cost            DECIMAL(12, 4) NOT NULL DEFAULT 0,
        total_price           DECIMAL(12, 4) NOT NULL DEFAULT 0,
        margin                DECIMAL(12, 4)
                              GENERATED ALWAYS AS (total_price - total_cost) STORED,

        first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        PRIMARY KEY (usage_date, user_id),

        CONSTRAINT fk_daily_usage_user
            FOREIGN KEY (user_id)    REFERENCES tbl_user(user_id),
        CONSTRAINT fk_daily_usage_project
            FOREIGN KEY (project_id) REFERENCES tbl_project(project_id)
            ON UPDATE CASCADE
    );

    -- Hot-path indexes (no longer need session_id-keyed index)
    CREATE INDEX idx_daily_usage_user_date
        ON tbl_daily_usage (user_id, usage_date DESC);
    CREATE INDEX idx_daily_usage_project_date
        ON tbl_daily_usage (project_id, usage_date DESC);
    CREATE INDEX idx_daily_usage_date
        ON tbl_daily_usage (usage_date DESC);

    COMMENT ON COLUMN tbl_daily_usage.usage_date
        IS 'Local date (Asia/Bangkok). One row per user per day, all sessions + models summed.';
    COMMENT ON COLUMN tbl_daily_usage.margin
        IS 'Computed: total_price - total_cost. STORED for fast read.';

    -- 4. Restore aggregated data.
    INSERT INTO tbl_daily_usage (
        usage_date, user_id, project_id,
        input_tokens, cached_tokens, output_tokens, reasoning_tokens,
        request_count, total_cost, total_price,
        first_seen_at, last_updated_at
    )
    SELECT
        usage_date, user_id, project_id,
        input_tokens, cached_tokens, output_tokens, reasoning_tokens,
        request_count, total_cost, total_price,
        first_seen_at, last_updated_at
    FROM _tmp_daily_usage_agg;

    DROP TABLE _tmp_daily_usage_agg;

    RAISE NOTICE 'phase21-003: complete';
END $$;
