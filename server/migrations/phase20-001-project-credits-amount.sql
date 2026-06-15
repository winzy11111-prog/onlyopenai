-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  Phase 20 — Lifetime accumulated top-up per project              ║
-- ╚══════════════════════════════════════════════════════════════════╝
-- Adds tbl_balance.project_credits_amount: NEVER-DECREASING running total
-- of every baht ever topped up into a project. Powers:
--   • the "ยอดเงินสะสมทั้งหมด" column on the admin dashboard
--   • future customer-tier evaluation (Bronze/Silver/Gold/...) based on
--     lifetime spend, possibly with rate overrides
--
-- Why a cached column instead of SELECT SUM(amount) FROM tbl_topup_history
-- ─────────────────────────────────────────────────────────────────────
--   1. tbl_topup_history was added in Phase 16.1 — older projects'
--      initial seed balance is NOT in there, so SUM alone is incomplete.
--      Backfill = current balance + history (best-effort baseline).
--   2. tier checks fire on every dashboard hit + every chat send —
--      avoiding a SUM over history per request is cheaper.
--   3. project_credits_amount is monotonically non-decreasing (it never
--      goes down on spend); easier mental model than "this is balance
--      plus what we know about history".
--
-- Maintenance contract
-- ────────────────────
-- The application code is the ONLY writer. Server-side top-up handler
-- must do BOTH updates inside the same transaction:
--   UPDATE tbl_balance
--     SET project_credits        = project_credits        + $amount,
--         project_credits_amount = project_credits_amount + $amount
--   WHERE project_id = $1;
-- (Spending leaves project_credits_amount untouched.)

ALTER TABLE tbl_balance
    ADD COLUMN IF NOT EXISTS project_credits_amount NUMERIC(12, 2)
        NOT NULL DEFAULT 0;

-- Backfill: baseline = current balance + total recorded top-ups
-- For projects with no history rows, fall back to just the current
-- balance so the dashboard shows a sensible "starting point" instead
-- of an alarming zero.
UPDATE tbl_balance b
SET project_credits_amount = COALESCE(b.project_credits, 0)
                           + COALESCE(h.total, 0)
FROM (
    SELECT project_id, SUM(amount) AS total
    FROM tbl_topup_history
    GROUP BY project_id
) h
WHERE b.project_id = h.project_id;

-- Projects that have no entries in tbl_topup_history at all → set
-- amount = current balance (best we can know about lifetime).
UPDATE tbl_balance
SET project_credits_amount = COALESCE(project_credits, 0)
WHERE project_credits_amount = 0
  AND COALESCE(project_credits, 0) > 0;
