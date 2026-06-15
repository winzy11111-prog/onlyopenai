-- ╔═══════════════════════════════════════════════════════════╗
-- ║ Phase 12-002 — Migrate legacy chat_sessions → tbl_chat_*  ║
-- ╚═══════════════════════════════════════════════════════════╝
-- The old `chat_sessions` table (not tbl_ prefixed, never tracked by
-- a migration file) stored each conversation as a single row with a
-- `messages` jsonb blob. It had these problems:
--
--   1. GET/PUT/DELETE /api/sessions/:id did not filter by user_id,
--      i.e. any authenticated user could read or overwrite anyone's
--      conversation just by guessing an id (IDOR).
--   2. No per-message indexing — couldn't search, paginate, or track
--      cost per turn.
--   3. No soft delete — DELETE was irreversible.
--
-- Phase 12-001 created tbl_chat_session + tbl_chat_message with the
-- right shape. This migration expands every existing chat_sessions
-- row into the new tables, then drops the old table.
--
-- Legacy message shape (from jsonb_object_keys inspection):
--   { role, content, timestamp, cost?, inputTokens?, outputTokens?, durationMs? }
--
-- Idempotent: if chat_sessions no longer exists (already migrated),
-- the whole block is a no-op.

DO $$
DECLARE
    sess          RECORD;
    new_sess_id   BIGINT;
    msg           JSONB;
    total         NUMERIC(12,4);
BEGIN
    -- Nothing to do if the old table was already removed
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='chat_sessions') THEN
        RAISE NOTICE '  (chat_sessions already gone — skipping)';
        RETURN;
    END IF;

    FOR sess IN SELECT * FROM chat_sessions ORDER BY id LOOP
        -- Sum cost across messages for total_cost denormalisation
        SELECT COALESCE(SUM((m->>'cost')::NUMERIC), 0)
          INTO total
          FROM jsonb_array_elements(sess.messages) AS m;

        -- Create the new session row
        INSERT INTO tbl_chat_session
            (user_id, title, created_at, updated_at, is_deleted,
             message_count, total_cost)
        VALUES
            (sess.user_id,
             COALESCE(NULLIF(sess.title,''), 'New chat'),
             sess.created_at,
             sess.updated_at,
             FALSE,
             jsonb_array_length(sess.messages),
             total)
        RETURNING session_id INTO new_sess_id;

        -- Expand each message
        FOR msg IN SELECT value FROM jsonb_array_elements(sess.messages) LOOP
            INSERT INTO tbl_chat_message
                (session_id, role, content, created_at,
                 input_tokens, output_tokens, cost, skill_id)
            VALUES
                (new_sess_id,
                 COALESCE(msg->>'role', 'user'),
                 COALESCE(msg->>'content', ''),
                 COALESCE((msg->>'timestamp')::TIMESTAMPTZ, sess.created_at),
                 NULLIF((msg->>'inputTokens')::INTEGER, 0),
                 NULLIF((msg->>'outputTokens')::INTEGER, 0),
                 (msg->>'cost')::NUMERIC(12,6),
                 sess.skill_id);
        END LOOP;

        RAISE NOTICE '  migrated session id=% → tbl_chat_session %, % messages',
            sess.id, new_sess_id, jsonb_array_length(sess.messages);
    END LOOP;

    -- Drop the old table once data is safely across.
    DROP TABLE chat_sessions;
    RAISE NOTICE '  ✔ chat_sessions dropped';
END $$;
