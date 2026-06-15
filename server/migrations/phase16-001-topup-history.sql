-- ╔═══════════════════════════════════════════════════════════╗
-- ║ Phase 16.1 — dedicated tbl_topup_history                  ║
-- ╚═══════════════════════════════════════════════════════════╝
-- Until now, top-up records lived only in tbl_action_admin (mixed with every
-- other admin action) and tbl_balance (only the latest balance, no history).
-- Phase 16 introduces a Balance + Top-up admin page; that needs a clean,
-- queryable history of every credit injection per project.
--
-- Schema design notes
-- ───────────────────
--   id              → BIGSERIAL because top-ups can grow without bound.
--   amount          → NUMERIC(12,2) matches the precision used in tbl_balance
--                     (Phase 5 standard). CHECK > 0 — a "negative top-up" is
--                     a deduction and belongs in a different concept.
--   balance_before/after → snapshot at the moment of the transaction so we
--                     can reconstruct timelines without re-summing every row.
--   note            → optional admin memo ("invoice #1234", "manual refund").
--                     Nullable so the existing UI doesn't have to add a field.
--   created_at      → TIMESTAMPTZ (UTC-aware) — the rest of the schema is
--                     mixed but anything new should be TZ-aware.
--
-- FK behavior
-- ───────────
--   project_id → tbl_project   ON UPDATE CASCADE  (Phase 15.2 standard)
--                              ON DELETE NO ACTION (preserve financial trail)
--   user_id    → tbl_user      ON UPDATE NO ACTION ON DELETE NO ACTION
--                              (admin user can't be deleted while they have
--                              top-up records — protects audit trail)
--
-- Indexes
-- ───────
--   ix_topup_project_time   → covers the "list history for project X newest-first"
--                             query that the UI runs every time the modal opens.
--   ix_topup_user_time      → covers the "what did admin Y top up?" report.
--
-- Backfill
-- ────────
-- Past top-ups are recoverable from tbl_action_admin where action_type='topup_project'.
-- We backfill them so the new history page shows continuity instead of starting empty.
-- The change_json shape used by logAdminAction is:
--   { before:{project_credits}, after:{project_credits}, extra:{amount, project_id} }
-- We extract those values directly. Idempotent guard: skip if the row would
-- duplicate an existing (project_id, user_id, created_at, amount) tuple.
--
-- Idempotency
-- ───────────
-- Wrapped in IF NOT EXISTS / ON CONFLICT so re-running this migration is a no-op.

CREATE TABLE IF NOT EXISTS tbl_topup_history (
    id              BIGSERIAL PRIMARY KEY,
    project_id      VARCHAR(64)  NOT NULL,
    user_id         INTEGER      NOT NULL,
    amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    balance_before  NUMERIC(12,2) NOT NULL,
    balance_after   NUMERIC(12,2) NOT NULL,
    note            TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT tbl_topup_history_project_fk
        FOREIGN KEY (project_id) REFERENCES tbl_project(project_id)
        ON UPDATE CASCADE ON DELETE NO ACTION,
    CONSTRAINT tbl_topup_history_user_fk
        FOREIGN KEY (user_id) REFERENCES tbl_user(user_id)
        ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE INDEX IF NOT EXISTS ix_topup_project_time
    ON tbl_topup_history (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_topup_user_time
    ON tbl_topup_history (user_id, created_at DESC);

-- ── Backfill from tbl_action_admin ──────────────────────────
-- Pull rows where action_type='topup_project' and the change_json has the
-- expected shape. We use a DO block so we can RAISE NOTICE the count.
DO $$
DECLARE
    inserted INT := 0;
BEGIN
    WITH src AS (
        SELECT
            (change_json->'extra'->>'project_id')::VARCHAR(64)         AS project_id,
            user_id                                                    AS user_id,
            (change_json->'extra'->>'amount')::NUMERIC(12,2)           AS amount,
            (change_json->'before'->>'project_credits')::NUMERIC(12,2) AS balance_before,
            (change_json->'after'->>'project_credits')::NUMERIC(12,2)  AS balance_after,
            edit_time AT TIME ZONE 'UTC'                               AS created_at
        FROM tbl_action_admin
        WHERE action_type = 'topup_project'
          AND change_json ? 'extra'
          AND change_json->'extra' ? 'amount'
          AND change_json->'extra' ? 'project_id'
    ),
    -- Only keep rows whose project still exists (orphaned topups for deleted
    -- projects are dropped — FK would reject them anyway).
    valid AS (
        SELECT s.* FROM src s
        JOIN tbl_project p ON p.project_id = s.project_id
        WHERE NOT EXISTS (
            SELECT 1 FROM tbl_topup_history h
             WHERE h.project_id = s.project_id
               AND h.user_id    = s.user_id
               AND h.amount     = s.amount
               AND h.created_at = s.created_at
        )
    )
    INSERT INTO tbl_topup_history
        (project_id, user_id, amount, balance_before, balance_after, created_at)
    SELECT project_id, user_id, amount, balance_before, balance_after, created_at
      FROM valid;

    GET DIAGNOSTICS inserted = ROW_COUNT;
    RAISE NOTICE 'tbl_topup_history: backfilled % rows from tbl_action_admin', inserted;
END $$;
