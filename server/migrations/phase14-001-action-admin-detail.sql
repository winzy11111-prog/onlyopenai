-- ╔═══════════════════════════════════════════════════════════╗
-- ║ Phase 14 — extend tbl_action_admin with action detail     ║
-- ╚═══════════════════════════════════════════════════════════╝
-- Today the audit row only records "who, when" (user_id + timestamp).
-- That's not enough to answer "what did admin X change for user Y on
-- Tuesday?" — which is the whole point of an audit trail.
--
-- We add 4 columns:
--   action_type  e.g. 'create_user', 'update_balance', 'delete_project'
--   target_type  e.g. 'user', 'project'
--   target_id    primary-key of the affected row (may be NULL for bulk)
--   change_json  JSONB { "before": {...}, "after": {...} } — only the
--                fields that actually changed, no secrets (passwords
--                must never be written here).
--
-- Also mirror the new schema into tbl_audit_log so we can record
-- failed-login / session attempts with a stable shape:
--   event_type   'login_ok' | 'login_fail' | 'logout' | 'lock'
--   detail       JSONB (e.g. { reason: 'wrong_password', ip: '...' })
--
-- Idempotent via IF NOT EXISTS — safe to re-run.

-- ─── tbl_action_admin ─────────────────────────────────────
ALTER TABLE tbl_action_admin
    ADD COLUMN IF NOT EXISTS action_type VARCHAR(40),
    ADD COLUMN IF NOT EXISTS target_type VARCHAR(20),
    ADD COLUMN IF NOT EXISTS target_id   INT,
    ADD COLUMN IF NOT EXISTS change_json JSONB;

-- Indexes for common ops queries: "what did admin X do?" and
-- "who touched user 42?". Partial indexes keep them cheap because
-- most historical rows have NULL action_type.
CREATE INDEX IF NOT EXISTS idx_action_admin_user_date
    ON tbl_action_admin (user_id, edit_date DESC);

CREATE INDEX IF NOT EXISTS idx_action_admin_target
    ON tbl_action_admin (target_type, target_id)
    WHERE target_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_action_admin_type
    ON tbl_action_admin (action_type)
    WHERE action_type IS NOT NULL;

-- ─── tbl_audit_log ────────────────────────────────────────
-- user_id can be NULL (login attempt with unknown username).
ALTER TABLE tbl_audit_log
    ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE tbl_audit_log
    ADD COLUMN IF NOT EXISTS event_type VARCHAR(20),
    ADD COLUMN IF NOT EXISTS detail     JSONB,
    ADD COLUMN IF NOT EXISTS ip         VARCHAR(45);  -- IPv6-safe width

CREATE INDEX IF NOT EXISTS idx_audit_log_event
    ON tbl_audit_log (event_type, log_in_date DESC)
    WHERE event_type IS NOT NULL;

-- ─── confirm ──────────────────────────────────────────────
DO $$ BEGIN
    RAISE NOTICE '  ✔ phase14-001 — tbl_action_admin + tbl_audit_log extended';
END $$;
