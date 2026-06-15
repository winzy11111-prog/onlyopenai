-- ╔═══════════════════════════════════════════════════════════╗
-- ║ Phase 6 — 002: Hot-path indexes                           ║
-- ╚═══════════════════════════════════════════════════════════╝
-- All CREATE INDEX IF NOT EXISTS — idempotent, safe to re-run.
-- Wrapped in BEGIN/COMMIT for atomicity but no DDL inside DO blocks
-- so we can use IF NOT EXISTS (CREATE INDEX supports it natively).

BEGIN;

-- /api/audit-log filters by user_id and orders by log_in_time DESC
CREATE INDEX IF NOT EXISTS idx_audit_log_user_time
    ON tbl_audit_log (user_id, log_in_time DESC);

-- /api/action-log filters by user_id and orders by edit_time DESC
CREATE INDEX IF NOT EXISTS idx_action_admin_user_time
    ON tbl_action_admin (user_id, edit_time DESC);

-- /api/history?userId= filters by user_id and orders by created_at DESC
CREATE INDEX IF NOT EXISTS idx_response_user_created
    ON tbl_response (user_id, created_at DESC);

-- /api/history (admin view) filters by project_id and orders by created_at DESC
CREATE INDEX IF NOT EXISTS idx_response_project_created
    ON tbl_response (project_id, created_at DESC);

-- /api/users JOINs tbl_credits on user_id (already PK so already indexed) —
-- but tbl_credits.project_id has FK with no index → slow when filtering by project.
CREATE INDEX IF NOT EXISTS idx_credits_project
    ON tbl_credits (project_id);

-- tbl_user.project_id — used in many JOINs
CREATE INDEX IF NOT EXISTS idx_user_project
    ON tbl_user (project_id);

COMMIT;
