-- ╔═══════════════════════════════════════════════════════════════╗
-- ║  Phase 19.9 — Add FK: tbl_action_admin.role_id → tbl_user_role  ║
-- ╚═══════════════════════════════════════════════════════════════╝
-- Designer's reference schema (drawSQL) declared this FK; current live
-- DB was missing it. Verified on May 2026 that every existing
-- tbl_action_admin row references a valid tbl_user_role.role_id
-- (139 rows → role_id=1 'admin', 8 rows → role_id=2 'general user'),
-- so adding the constraint is safe with no backfill.
--
-- Behaviour
-- ─────────
--   ON UPDATE: NO ACTION   — role_id is a small fixed lookup table
--                            (admin/general user); we don't renumber roles.
--   ON DELETE: NO ACTION   — refuse to delete a role that's still
--                            referenced in the action history.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_schema   = 'public'
          AND table_name     = 'tbl_action_admin'
          AND constraint_type = 'FOREIGN KEY'
          AND constraint_name = 'tbl_action_admin_role_id_fkey'
    ) THEN
        ALTER TABLE tbl_action_admin
            ADD CONSTRAINT tbl_action_admin_role_id_fkey
            FOREIGN KEY (role_id)
            REFERENCES tbl_user_role (role_id);
    END IF;
END $$;
