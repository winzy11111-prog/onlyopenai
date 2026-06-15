-- ╔═══════════════════════════════════════════════════════════╗
-- ║ Phase 7 — 001: Persistent sessions + soft-delete          ║
-- ╚═══════════════════════════════════════════════════════════╝
-- 1. tbl_session: server-side sessions in Postgres so they survive
--    restarts and can be shared across multiple server instances.
-- 2. is_deleted / deleted_at columns on tbl_user and tbl_project so
--    "delete" preserves the row (audit + recoverable).
-- All idempotent — safe to re-run.

BEGIN;

-- ── Sessions table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_session (
    token        VARCHAR(128) PRIMARY KEY,
    user_id      INTEGER      NOT NULL REFERENCES tbl_user(user_id) ON DELETE CASCADE,
    role         VARCHAR(32)  NOT NULL,
    expires_at   TIMESTAMPTZ  NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Janitor uses (expires_at) — fast prune
CREATE INDEX IF NOT EXISTS idx_session_expires ON tbl_session (expires_at);
-- Admin "who's online" / per-user logout-all uses (user_id)
CREATE INDEX IF NOT EXISTS idx_session_user    ON tbl_session (user_id);

-- ── Soft-delete on tbl_user ────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tbl_user' AND column_name='is_deleted') THEN
        ALTER TABLE tbl_user ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tbl_user' AND column_name='deleted_at') THEN
        ALTER TABLE tbl_user ADD COLUMN deleted_at TIMESTAMPTZ NULL;
    END IF;
END $$;

-- Filtering "active users" is the hot path — partial index keeps it tiny
CREATE INDEX IF NOT EXISTS idx_user_active
    ON tbl_user (user_id) WHERE is_deleted = FALSE;

-- ── Soft-delete on tbl_project ─────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tbl_project' AND column_name='is_deleted') THEN
        ALTER TABLE tbl_project ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tbl_project' AND column_name='deleted_at') THEN
        ALTER TABLE tbl_project ADD COLUMN deleted_at TIMESTAMPTZ NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_project_active
    ON tbl_project (project_id) WHERE is_deleted = FALSE;

COMMIT;
