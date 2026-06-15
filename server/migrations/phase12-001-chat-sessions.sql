-- ╔═══════════════════════════════════════════════════════════╗
-- ║ Phase 12-001 — Chat sessions (conversation history)       ║
-- ╚═══════════════════════════════════════════════════════════╝
-- Adds two tables that let users keep and revisit past conversations:
--
--   tbl_chat_session  — one row per conversation thread
--   tbl_chat_message  — one row per user/assistant message, FK → session
--
-- Design notes:
--   • Each session is user-scoped (user_id FK). All reads filter by the
--     caller's req.session.userId — that's the IDOR guard.
--   • Soft delete (is_deleted) instead of hard delete so audit can go
--     back and look if needed.
--   • Messages store cost / tokens denormalised so we can show a
--     "this conversation cost ฿X" badge without re-joining tbl_response.
--   • Title auto-generates from first user message on the server side
--     (first 60 chars, whitespace-collapsed). Users can rename.
--   • created_at/updated_at are TIMESTAMPTZ — the rest of the DB uses
--     DATE+TIME pairs, but this is new and we want a single comparable
--     instant, so this table breaks with that pattern deliberately.
--
-- Idempotent: safe to re-run.

DO $$
BEGIN
    -- ── tbl_chat_session ───────────────────────────────────
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='tbl_chat_session') THEN

        CREATE TABLE tbl_chat_session (
            session_id    BIGSERIAL PRIMARY KEY,
            user_id       INTEGER      NOT NULL
                REFERENCES tbl_user(user_id) ON DELETE CASCADE,
            title         VARCHAR(200) NOT NULL DEFAULT 'New chat',
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            is_deleted    BOOLEAN      NOT NULL DEFAULT FALSE,
            message_count INTEGER      NOT NULL DEFAULT 0,
            total_cost    NUMERIC(12,4) NOT NULL DEFAULT 0
        );

        -- list-my-sessions query: "most recently active first, excluding deleted"
        CREATE INDEX idx_chat_session_user_updated
            ON tbl_chat_session (user_id, updated_at DESC)
            WHERE is_deleted = FALSE;

        RAISE NOTICE '  + tbl_chat_session created';
    END IF;

    -- ── tbl_chat_message ───────────────────────────────────
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='tbl_chat_message') THEN

        CREATE TABLE tbl_chat_message (
            message_id    BIGSERIAL PRIMARY KEY,
            session_id    BIGINT  NOT NULL
                REFERENCES tbl_chat_session(session_id) ON DELETE CASCADE,
            role          VARCHAR(16)  NOT NULL
                CHECK (role IN ('user','assistant','system')),
            content       TEXT         NOT NULL,
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            input_tokens  INTEGER,
            output_tokens INTEGER,
            cost          NUMERIC(12,6),
            model         VARCHAR(64),
            skill_id      VARCHAR(64)   -- e.g. "petabyte-ai", "sap-abap" — nullable
        );

        -- get-session-messages: "this session, in order"
        CREATE INDEX idx_chat_message_session_created
            ON tbl_chat_message (session_id, created_at);

        RAISE NOTICE '  + tbl_chat_message created';
    END IF;
END $$;
