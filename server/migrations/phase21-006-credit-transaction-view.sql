-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  Phase 21.6 — VIEW v_user_credit_transaction                       ║
-- ╚═══════════════════════════════════════════════════════════════════╝
-- Read-only view that joins tbl_user_credit_transaction with tbl_user
-- and tbl_project so dashboard queries don't have to repeat the joins.
--
-- Bonus columns computed at query time:
--   tx_date         — date (Asia/Bangkok) — drives Day view filter
--   tx_month        — first-of-month date — drives Month view group-by
--   display_name    — "First Last" trimmed
--   amount_signed   — original signed amount
--   amount_display  — ABS(amount) for UI rendering (no minus sign)
--
-- CREATE OR REPLACE — safe to re-run any time.
CREATE OR REPLACE VIEW v_user_credit_transaction AS
SELECT
    t.transaction_id,
    t.created_at,
    (t.created_at AT TIME ZONE 'Asia/Bangkok')::date              AS tx_date,
    DATE_TRUNC('month', t.created_at AT TIME ZONE 'Asia/Bangkok')::date AS tx_month,

    u.user_id,
    u.username,
    TRIM(COALESCE(u.name, '') || ' ' || COALESCE(u.surname, ''))  AS display_name,

    p.project_id,
    p.project_name,

    t.transaction_type                                            AS type,
    t.amount                                                      AS amount_signed,
    ABS(t.amount)::numeric(12, 2)                                 AS amount_display,

    t.balance_before,
    t.balance_after,
    t.ref_type,
    t.ref_id,
    t.note,

    t.created_by,
    cb.username                                                   AS created_by_username
FROM tbl_user_credit_transaction t
JOIN      tbl_user u    ON u.user_id    = t.user_id
LEFT JOIN tbl_project p ON p.project_id = t.project_id
LEFT JOIN tbl_user   cb ON cb.user_id   = t.created_by;

COMMENT ON VIEW v_user_credit_transaction IS
    'Dashboard-friendly view of credit movements (Phase 21.6). Always real-time.';
