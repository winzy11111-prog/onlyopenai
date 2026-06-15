-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  Phase 21 — Pricing master + Daily usage rollup                    ║
-- ╚═══════════════════════════════════════════════════════════════════╝
-- Adds two new tables that work together:
--
--   tbl_pricing      master price/cost per model with effective-date
--                    versioning. cost = ราคา OpenAI charge เรา;
--                    price = ราคา charge ให้ user; margin = price - cost.
--
--   tbl_daily_usage  pre-aggregated รายวันต่อ user+session+model. Updated
--                    via UPSERT on every chat turn so dashboards stay
--                    real-time without scanning tbl_chat_message.
--
-- Why this design (vs the drawSQL export from the designer):
--   • SERIAL PK on tbl_pricing  (designer forgot PK entirely)
--   • Composite PK on tbl_daily_usage  (designer had 2 conflicting PKs)
--   • DECIMAL(10,6) for rates  — OpenAI prices like $0.0025/1K need >2 dp
--   • INTEGER for tokens  — tokens are whole numbers, not DECIMAL(8,2)
--   • Effective-date versioning  — ราคาเปลี่ยน เก็บประวัติได้
--   • GENERATED column for margin  — ไม่ต้อง maintain เอง
--   • FK to existing tbl_*  — referential integrity จาก day one
--
-- This migration is additive only. Existing chat / billing paths keep
-- working until application code (server.js) is updated to also
-- UPSERT into tbl_daily_usage and READ rates from tbl_pricing.

-- ════════════════════════════════════════════════════════════════════
-- 1. tbl_pricing — master rate per model (with history)
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tbl_pricing (
    pricing_id      SERIAL PRIMARY KEY,
    model           VARCHAR(64) NOT NULL,

    -- Cost = OpenAI charges us (THB per 1,000 tokens)
    input_cost      DECIMAL(10, 6) NOT NULL,
    cached_cost     DECIMAL(10, 6),
    output_cost     DECIMAL(10, 6) NOT NULL,

    -- Price = we charge user (THB per 1,000 tokens)
    input_price     DECIMAL(10, 6) NOT NULL,
    cached_price    DECIMAL(10, 6),
    output_price    DECIMAL(10, 6) NOT NULL,

    -- Effective-date versioning: row is "active" when
    --   effective_from <= NOW() AND (effective_to IS NULL OR effective_to > NOW())
    effective_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to    TIMESTAMPTZ,
    note            TEXT,

    -- Each (model, effective_from) must be unique so we don't get
    -- two competing rates active at the same instant.
    UNIQUE (model, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_pricing_model_active
    ON tbl_pricing (model)
    WHERE effective_to IS NULL;

COMMENT ON COLUMN tbl_pricing.input_cost
    IS 'OpenAI cost per 1K input tokens (THB)';
COMMENT ON COLUMN tbl_pricing.input_price
    IS 'Customer charge per 1K input tokens (THB)';
COMMENT ON COLUMN tbl_pricing.effective_to
    IS 'NULL = currently active. Set to NOW() when superseded by new row.';

-- ════════════════════════════════════════════════════════════════════
-- 2. tbl_daily_usage — daily rollup per user+session+model
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tbl_daily_usage (
    usage_date            DATE         NOT NULL,
    user_id               INTEGER      NOT NULL,
    project_id            VARCHAR(100) NOT NULL,
    session_id            BIGINT       NOT NULL,
    model                 VARCHAR(64)  NOT NULL,

    -- Token counts (whole numbers — INTEGER, not DECIMAL)
    input_tokens          INTEGER NOT NULL DEFAULT 0,
    cached_tokens         INTEGER NOT NULL DEFAULT 0,
    output_tokens         INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens      INTEGER NOT NULL DEFAULT 0,
    request_count         INTEGER NOT NULL DEFAULT 0,

    -- Money totals (THB) — aggregated, so DECIMAL(12,4) for headroom
    total_cost            DECIMAL(12, 4) NOT NULL DEFAULT 0,
    total_price           DECIMAL(12, 4) NOT NULL DEFAULT 0,

    -- Margin = price - cost, computed automatically by Postgres on every read
    margin                DECIMAL(12, 4)
                          GENERATED ALWAYS AS (total_price - total_cost) STORED,

    first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (usage_date, user_id, session_id, model),

    -- Referential integrity to existing tables
    CONSTRAINT fk_daily_usage_user
        FOREIGN KEY (user_id)    REFERENCES tbl_user(user_id),
    CONSTRAINT fk_daily_usage_project
        FOREIGN KEY (project_id) REFERENCES tbl_project(project_id)
        ON UPDATE CASCADE,
    CONSTRAINT fk_daily_usage_session
        FOREIGN KEY (session_id) REFERENCES tbl_chat_session(session_id)
        ON DELETE CASCADE
);

-- Hot-path indexes for the dashboard queries we expect:
--   • "this user's usage today"
--   • "this project's usage range"
--   • "top spenders this month"
CREATE INDEX IF NOT EXISTS idx_daily_usage_user_date
    ON tbl_daily_usage (user_id, usage_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_usage_project_date
    ON tbl_daily_usage (project_id, usage_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_usage_date
    ON tbl_daily_usage (usage_date DESC);

COMMENT ON COLUMN tbl_daily_usage.usage_date
    IS 'Local date (Asia/Bangkok) — same chat session can span multiple rows if it crosses midnight';
COMMENT ON COLUMN tbl_daily_usage.margin
    IS 'Computed: total_price - total_cost. STORED for fast read.';
