-- ╔═══════════════════════════════════════════════════════════╗
-- ║ Phase 15.2 — ON UPDATE CASCADE for project_id              ║
-- ╚═══════════════════════════════════════════════════════════╝
-- We're about to rename tbl_project.project_id values so they MATCH the
-- OpenAI project id (so DB and OpenAI dashboard speak the same identifier).
-- Rather than UPDATE every dependent table by hand, we let PostgreSQL
-- cascade the rename through the foreign keys.
--
-- 4 FK constraints get rebuilt with ON UPDATE CASCADE:
--    tbl_balance_project_id_fkey   → tbl_project (project_id)
--    tbl_response_project_id_fkey  → tbl_project (project_id)
--    tbl_user_project_id_fkey      → tbl_project (project_id)
--    tbl_credits_project_id_fkey   → tbl_balance (project_id)   ← second-level cascade
--
-- DELETE behavior is unchanged (NO ACTION) — we still want explicit cleanup
-- of dependent rows before a project can be removed; cascading deletes would
-- silently drop chat history.
--
-- Idempotent: drops constraint IF EXISTS, recreates with the cascade rule.

DO $$
DECLARE
    rec RECORD;
BEGIN
    -- Helper: rebuild one FK with ON UPDATE CASCADE
    -- (no plpgsql function for this — easier to inline 4 times)

    -- 1) tbl_balance.project_id → tbl_project(project_id)
    BEGIN
        ALTER TABLE tbl_balance DROP CONSTRAINT IF EXISTS tbl_balance_project_id_fkey;
        ALTER TABLE tbl_balance
            ADD CONSTRAINT tbl_balance_project_id_fkey
            FOREIGN KEY (project_id) REFERENCES tbl_project(project_id)
            ON UPDATE CASCADE ON DELETE NO ACTION;
        RAISE NOTICE 'tbl_balance: ON UPDATE CASCADE applied';
    EXCEPTION WHEN others THEN
        RAISE NOTICE 'tbl_balance FK skipped: %', SQLERRM;
    END;

    -- 2) tbl_response.project_id → tbl_project(project_id)
    BEGIN
        ALTER TABLE tbl_response DROP CONSTRAINT IF EXISTS tbl_response_project_id_fkey;
        ALTER TABLE tbl_response
            ADD CONSTRAINT tbl_response_project_id_fkey
            FOREIGN KEY (project_id) REFERENCES tbl_project(project_id)
            ON UPDATE CASCADE ON DELETE NO ACTION;
        RAISE NOTICE 'tbl_response: ON UPDATE CASCADE applied';
    EXCEPTION WHEN others THEN
        RAISE NOTICE 'tbl_response FK skipped: %', SQLERRM;
    END;

    -- 3) tbl_user.project_id → tbl_project(project_id)
    BEGIN
        ALTER TABLE tbl_user DROP CONSTRAINT IF EXISTS tbl_user_project_id_fkey;
        ALTER TABLE tbl_user
            ADD CONSTRAINT tbl_user_project_id_fkey
            FOREIGN KEY (project_id) REFERENCES tbl_project(project_id)
            ON UPDATE CASCADE ON DELETE NO ACTION;
        RAISE NOTICE 'tbl_user: ON UPDATE CASCADE applied';
    EXCEPTION WHEN others THEN
        RAISE NOTICE 'tbl_user FK skipped: %', SQLERRM;
    END;

    -- 4) tbl_credits.project_id → tbl_balance(project_id)
    --    (2nd-level: tbl_balance cascades from tbl_project, so credits cascades too)
    BEGIN
        ALTER TABLE tbl_credits DROP CONSTRAINT IF EXISTS tbl_credits_project_id_fkey;
        ALTER TABLE tbl_credits
            ADD CONSTRAINT tbl_credits_project_id_fkey
            FOREIGN KEY (project_id) REFERENCES tbl_balance(project_id)
            ON UPDATE CASCADE ON DELETE NO ACTION;
        RAISE NOTICE 'tbl_credits: ON UPDATE CASCADE applied';
    EXCEPTION WHEN others THEN
        RAISE NOTICE 'tbl_credits FK skipped: %', SQLERRM;
    END;
END $$;
