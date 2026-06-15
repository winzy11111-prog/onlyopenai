-- ╔═══════════════════════════════════════════════════════════════╗
-- ║  Phase 19.7 — Favorite (star/pin) chat sessions                ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- Adds an `is_favorite` flag on tbl_chat_session so users can star
-- important chats and surface them at the top of the sidebar
-- ("Favorites" group above the date-bucketed history).
--
-- Design notes
-- ────────────
--   - BOOLEAN NOT NULL DEFAULT false → no NULL handling in SQL/JS.
--   - Indexed partial: only the small set of starred rows ends up in
--     the index. Saves space; queries that filter `is_favorite=true`
--     hit it cheaply.
--   - No backfill needed — DEFAULT covers every existing row.

ALTER TABLE tbl_chat_session
    ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_chat_session_favorite
    ON tbl_chat_session (user_id, updated_at DESC)
    WHERE is_favorite = true AND is_deleted = false;
