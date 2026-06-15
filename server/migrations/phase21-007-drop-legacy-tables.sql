-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  Phase 21.7 — Drop legacy pre-`tbl_*` tables                       ║
-- ╚═══════════════════════════════════════════════════════════════════╝
-- Removes three orphan tables left over from the original schema (before
-- the `tbl_*` naming convention). They are no longer referenced by any
-- server.js query, view, or foreign key from active tables.
--
--   public.projects        (3 rows)  → replaced by tbl_project
--   public.users           (4 rows)  → replaced by tbl_user
--   public.usage_history   (19 rows) → replaced by tbl_response + tbl_chat_message
--
-- These three form a closed FK graph among themselves:
--   users.project_id     → projects.id
--   usage_history.user_id → users.id
-- No external table depends on them, so CASCADE is only used as a
-- safety net (it will drop the internal FKs cleanly).
--
-- Idempotent — re-running this migration is a no-op.

DROP TABLE IF EXISTS public.usage_history CASCADE;
DROP TABLE IF EXISTS public.users         CASCADE;
DROP TABLE IF EXISTS public.projects      CASCADE;
