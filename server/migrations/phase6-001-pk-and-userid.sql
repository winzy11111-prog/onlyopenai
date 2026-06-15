-- ╔═══════════════════════════════════════════════════════════╗
-- ║ Phase 6 — 001: Primary keys + tbl_response.user_id        ║
-- ╚═══════════════════════════════════════════════════════════╝
-- Idempotent: safe to re-run.
-- Wraps everything in a single transaction so partial failure rolls back.
BEGIN;

-- ─── 1. tbl_audit_log: add surrogate PK ──────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='tbl_audit_log' AND column_name='id'
    ) THEN
        ALTER TABLE tbl_audit_log ADD COLUMN id BIGSERIAL;
        ALTER TABLE tbl_audit_log ADD PRIMARY KEY (id);
        RAISE NOTICE '  ✔ tbl_audit_log.id BIGSERIAL PRIMARY KEY added';
    ELSE
        RAISE NOTICE '  • tbl_audit_log.id already exists';
    END IF;
END $$;

-- ─── 2. tbl_action_admin: add surrogate PK ───────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='tbl_action_admin' AND column_name='id'
    ) THEN
        ALTER TABLE tbl_action_admin ADD COLUMN id BIGSERIAL;
        ALTER TABLE tbl_action_admin ADD PRIMARY KEY (id);
        RAISE NOTICE '  ✔ tbl_action_admin.id BIGSERIAL PRIMARY KEY added';
    ELSE
        RAISE NOTICE '  • tbl_action_admin.id already exists';
    END IF;
END $$;

-- ─── 3. tbl_response: add user_id column + FK ────────────────
-- Currently /api/history joins r.project_id = u.project_id which leaks
-- history across users sharing a project. Add a real user_id column.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='tbl_response' AND column_name='user_id'
    ) THEN
        ALTER TABLE tbl_response ADD COLUMN user_id INTEGER NULL;
        RAISE NOTICE '  ✔ tbl_response.user_id INTEGER (nullable) added';

        -- Best-effort backfill: if exactly one user is on a project,
        -- assign that user_id to all responses for the project.
        -- Multi-user projects stay NULL (we don't know who ran it).
        WITH single_user_projects AS (
            SELECT project_id, MIN(user_id) AS user_id
            FROM tbl_user
            GROUP BY project_id
            HAVING COUNT(*) = 1
        )
        UPDATE tbl_response r
        SET user_id = sup.user_id
        FROM single_user_projects sup
        WHERE r.project_id = sup.project_id;

        RAISE NOTICE '  ✔ Backfilled tbl_response.user_id for single-user projects';
    ELSE
        RAISE NOTICE '  • tbl_response.user_id already exists';
    END IF;
END $$;

-- FK on tbl_response.user_id → tbl_user.user_id (ON DELETE SET NULL keeps history)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='tbl_response' AND constraint_name='tbl_response_user_id_fkey'
    ) THEN
        ALTER TABLE tbl_response
            ADD CONSTRAINT tbl_response_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES tbl_user(user_id) ON DELETE SET NULL;
        RAISE NOTICE '  ✔ tbl_response.user_id → tbl_user FK added (ON DELETE SET NULL)';
    ELSE
        RAISE NOTICE '  • tbl_response_user_id_fkey already exists';
    END IF;
END $$;

-- FK on tbl_response.project_id → tbl_project.project_id (was missing entirely)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='tbl_response' AND constraint_name='tbl_response_project_id_fkey'
    ) THEN
        -- Only add if there are no orphans (project_id pointing nowhere)
        IF NOT EXISTS (
            SELECT 1 FROM tbl_response r
            WHERE r.project_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM tbl_project p WHERE p.project_id = r.project_id)
        ) THEN
            ALTER TABLE tbl_response
                ADD CONSTRAINT tbl_response_project_id_fkey
                FOREIGN KEY (project_id) REFERENCES tbl_project(project_id);
            RAISE NOTICE '  ✔ tbl_response.project_id → tbl_project FK added';
        ELSE
            RAISE NOTICE '  ⚠ tbl_response has orphan project_ids — FK skipped';
        END IF;
    ELSE
        RAISE NOTICE '  • tbl_response_project_id_fkey already exists';
    END IF;
END $$;

COMMIT;
