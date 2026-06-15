-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  Phase 21.5 — tbl_user_credit_transaction                          ║
-- ║                                                                    ║
-- ║  Per-user financial transaction journal: every credit movement     ║
-- ║  (topup from admin, usage from chat) gets one row.                 ║
-- ╚═══════════════════════════════════════════════════════════════════╝
--
-- Why this table exists
-- ─────────────────────
-- The dashboard mockup needs to show, per user, "what credit was added
-- when, and what was spent when" — both as day-by-day list and as
-- monthly rollup. Existing tables answer parts of this:
--   • tbl_credits           — current balance snapshot, no history
--   • tbl_topup_project     — admin tops up the project pool (not user)
--   • tbl_response          — chat usage events (we have these)
--   • tbl_action_admin      — audit log, but balance changes are buried in JSONB
-- → No single source captures "admin distributes pool → user" as a
--   first-class event. This table fixes that, and unifies the usage
--   side too so dashboards can query one place.
--
-- Design choices (see proposal PDF section 02 for details)
-- ─────────────────────
--   amount         signed: + = credit in, − = credit out
--   transaction_type CHECK enum keeps the small set explicit
--   balance_before / balance_after for at-rest audit (NULL on backfill OK)
--   ref_type / ref_id  point back to the originating event
--   created_by     admin user_id who did it; NULL when the event is auto
--   created_at     drives both Day view (date) and Month view (group by month)
--
-- Idempotency: IF NOT EXISTS on the table + a count check before backfill.

-- ════════════════════════════════════════════════════════════════════
-- 1) TABLE
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tbl_user_credit_transaction (
    transaction_id   BIGSERIAL PRIMARY KEY,
    user_id          INT          NOT NULL REFERENCES tbl_user(user_id),
    project_id       VARCHAR(100)          REFERENCES tbl_project(project_id),

    transaction_type VARCHAR(20)  NOT NULL
        CHECK (transaction_type IN ('topup', 'usage', 'adjustment', 'refund')),

    amount           DECIMAL(12, 4) NOT NULL,    -- signed: + in, − out
    balance_before   DECIMAL(12, 4),
    balance_after    DECIMAL(12, 4),

    ref_type         VARCHAR(20),                -- 'chat' | 'admin_edit' | 'admin_topup' | 'auto'
    ref_id           BIGINT,                     -- chat_session_id / action_admin.id

    note             TEXT,
    created_by       INT REFERENCES tbl_user(user_id),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tbl_user_credit_transaction IS
    'Per-user financial transaction journal — every credit movement (Phase 21.5).';
COMMENT ON COLUMN tbl_user_credit_transaction.amount IS
    'Signed: positive = inflow (topup/refund); negative = outflow (usage).';
COMMENT ON COLUMN tbl_user_credit_transaction.created_by IS
    'Admin user_id when the change was made by an admin; NULL when auto (e.g. chat usage).';

-- ════════════════════════════════════════════════════════════════════
-- 2) INDEXES
-- ════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_uct_user_date
    ON tbl_user_credit_transaction (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uct_project_date
    ON tbl_user_credit_transaction (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uct_date
    ON tbl_user_credit_transaction (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_uct_type_date
    ON tbl_user_credit_transaction (transaction_type, created_at DESC);

-- ════════════════════════════════════════════════════════════════════
-- 3) BACKFILL (one-shot — skipped if rows already exist)
-- ════════════════════════════════════════════════════════════════════
-- Why skip-if-non-empty: this migration may run again on a server that
-- has already been live. Re-backfilling would create duplicate rows.
-- Production deploy on a fresh DB has zero rows → backfill runs once.
DO $$
DECLARE
    v_existing INT;
    v_usage    INT;
    v_topup    INT;
BEGIN
    SELECT COUNT(*) INTO v_existing FROM tbl_user_credit_transaction;
    IF v_existing > 0 THEN
        RAISE NOTICE 'phase21-005: backfill skipped (% rows already present)', v_existing;
        RETURN;
    END IF;

    -- ── 3a) USAGE events ──
    -- Source: tbl_chat_message (assistant turns where cost was stored).
    -- We join through tbl_chat_session to pick up the user_id, and through
    -- tbl_user to pick up the project_id at that moment.
    WITH ins AS (
        INSERT INTO tbl_user_credit_transaction (
            user_id, project_id, transaction_type, amount,
            ref_type, ref_id, created_at, note
        )
        SELECT
            s.user_id,
            u.project_id,
            'usage',
            -m.cost,                              -- minus = outflow
            'chat',
            m.session_id,
            m.created_at,
            'backfill from tbl_chat_message'
        FROM tbl_chat_message m
        JOIN tbl_chat_session s ON s.session_id = m.session_id
        JOIN tbl_user u         ON u.user_id    = s.user_id
        WHERE m.role = 'assistant'
          AND m.cost IS NOT NULL
          AND m.cost > 0
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_usage FROM ins;
    RAISE NOTICE 'phase21-005: backfilled % usage rows', v_usage;

    -- ── 3b) TOPUP / ADJUSTMENT events ──
    -- Source: tbl_action_admin rows where admin changed a user's balance.
    -- The diff comes from change_json.before.balance / .after.balance.
    -- We classify: delta > 0 → 'topup', delta < 0 → 'adjustment'.
    -- balance_before / _after are recoverable from the JSON.
    WITH ins AS (
        INSERT INTO tbl_user_credit_transaction (
            user_id, project_id, transaction_type, amount,
            balance_before, balance_after,
            ref_type, ref_id, created_at, created_by, note
        )
        SELECT
            a.target_id::int                                      AS user_id,
            u.project_id,
            CASE
                WHEN ((a.change_json->'after'->>'balance')::numeric
                    > (a.change_json->'before'->>'balance')::numeric) THEN 'topup'
                ELSE 'adjustment'
            END                                                   AS transaction_type,
            ((a.change_json->'after'->>'balance')::numeric
              - (a.change_json->'before'->>'balance')::numeric)   AS amount,
            (a.change_json->'before'->>'balance')::numeric        AS balance_before,
            (a.change_json->'after'->>'balance')::numeric         AS balance_after,
            'admin_edit',
            a.id,
            a.edit_time,
            a.user_id,                                            -- admin who did it
            'backfill from tbl_action_admin'
        FROM tbl_action_admin a
        LEFT JOIN tbl_user u ON u.user_id = a.target_id::int
        WHERE a.target_type = 'user'
          AND a.change_json IS NOT NULL
          AND a.change_json->'before'->>'balance' IS NOT NULL
          AND a.change_json->'after'->>'balance'  IS NOT NULL
          AND (a.change_json->'after'->>'balance')::numeric
              != (a.change_json->'before'->>'balance')::numeric
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_topup FROM ins;
    RAISE NOTICE 'phase21-005: backfilled % topup/adjustment rows', v_topup;

    RAISE NOTICE 'phase21-005: total backfilled = %', (v_usage + v_topup);
END $$;
