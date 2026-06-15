-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  Phase 21.4 — Read-only VIEWs over tbl_daily_usage                 ║
-- ╚═══════════════════════════════════════════════════════════════════╝
-- Surface friendly column names + JOINs so analysts can write short
-- queries instead of repeating JOINs to tbl_user / tbl_project.
--
-- Why VIEW instead of MATERIALIZED VIEW / TRIGGER:
--   • Source table (tbl_daily_usage) is already pre-aggregated —
--     SELECT from it is fast even without caching.
--   • Always real-time (latest chat shows up immediately).
--   • Zero maintenance: no REFRESH, no trigger debugging.
--   • Safe to drop + recreate any time without losing data.
--
-- Idempotency: CREATE OR REPLACE — re-run anytime to update view defs.

-- ════════════════════════════════════════════════════════════════════
-- 1. v_user_daily_usage — per (date, user)
-- ════════════════════════════════════════════════════════════════════
-- Use case: "ดู usage ของแต่ละ user รายวัน"
--   SELECT * FROM v_user_daily_usage
--   WHERE usage_date = CURRENT_DATE
--   ORDER BY spent_thb DESC;
CREATE OR REPLACE VIEW v_user_daily_usage AS
SELECT
    d.usage_date,
    d.user_id,
    u.username,
    TRIM(u.name || ' ' || u.surname)               AS display_name,
    p.project_id,
    p.project_name,
    d.request_count                                AS requests,
    d.input_tokens,
    d.cached_tokens,
    d.output_tokens,
    d.reasoning_tokens,
    (d.input_tokens + d.output_tokens)             AS total_tokens,
    d.total_cost::numeric(12, 4)                   AS cost_thb,
    d.total_price::numeric(12, 4)                  AS spent_thb,
    d.margin::numeric(12, 4)                       AS profit_thb,
    CASE WHEN d.total_price > 0
         THEN ROUND((d.margin / d.total_price * 100)::numeric, 1)
         ELSE 0
    END                                            AS margin_pct,
    -- Cap status (อ้าง daily_cap ของ user)
    u.daily_cap                                    AS daily_cap_thb,
    CASE
        WHEN u.daily_cap IS NULL                          THEN 'no_limit'
        WHEN d.total_price >= u.daily_cap                 THEN 'exceeded'
        WHEN d.total_price >= u.daily_cap * 0.8           THEN 'warning_80'
        ELSE 'ok'
    END                                            AS cap_status,
    d.first_seen_at,
    d.last_updated_at
FROM tbl_daily_usage d
JOIN tbl_user    u ON u.user_id    = d.user_id
JOIN tbl_project p ON p.project_id = d.project_id
WHERE u.is_deleted = false;

COMMENT ON VIEW v_user_daily_usage IS
    'Per-user-per-day usage rollup with username/project joined and margin% computed. Always real-time.';

-- ════════════════════════════════════════════════════════════════════
-- 2. v_project_daily_usage — per (date, project)
-- ════════════════════════════════════════════════════════════════════
-- Use case: "ดู project ไหนใช้เยอะที่สุดวันนี้"
--   SELECT * FROM v_project_daily_usage
--   WHERE usage_date >= CURRENT_DATE - 30
--   ORDER BY usage_date DESC, spent_thb DESC;
CREATE OR REPLACE VIEW v_project_daily_usage AS
SELECT
    d.usage_date,
    p.project_id,
    p.project_name,
    COUNT(DISTINCT d.user_id)::int                 AS active_users,
    SUM(d.request_count)::int                      AS requests,
    SUM(d.input_tokens)::int                       AS input_tokens,
    SUM(d.output_tokens)::int                      AS output_tokens,
    SUM(d.input_tokens + d.output_tokens)::int     AS total_tokens,
    SUM(d.total_cost)::numeric(12, 4)              AS cost_thb,
    SUM(d.total_price)::numeric(12, 4)             AS spent_thb,
    SUM(d.margin)::numeric(12, 4)                  AS profit_thb,
    CASE WHEN SUM(d.total_price) > 0
         THEN ROUND((SUM(d.margin) / SUM(d.total_price) * 100)::numeric, 1)
         ELSE 0
    END                                            AS margin_pct
FROM tbl_daily_usage d
JOIN tbl_project p ON p.project_id = d.project_id
WHERE p.is_deleted = false
GROUP BY d.usage_date, p.project_id, p.project_name;

COMMENT ON VIEW v_project_daily_usage IS
    'Per-project-per-day usage rollup. Sums across all users in the project.';

-- ════════════════════════════════════════════════════════════════════
-- 3. v_user_lifetime_usage — per user, all-time
-- ════════════════════════════════════════════════════════════════════
-- Use case: "ลูกค้า lifetime value — ใครใช้รวมแล้วเยอะสุด"
--   SELECT * FROM v_user_lifetime_usage
--   ORDER BY lifetime_spent_thb DESC LIMIT 10;
CREATE OR REPLACE VIEW v_user_lifetime_usage AS
SELECT
    u.user_id,
    u.username,
    TRIM(u.name || ' ' || u.surname)               AS display_name,
    p.project_id,
    p.project_name,
    COUNT(DISTINCT d.usage_date)::int              AS days_active,
    COALESCE(MIN(d.usage_date), NULL)              AS first_used,
    COALESCE(MAX(d.usage_date), NULL)              AS last_used,
    COALESCE(SUM(d.request_count), 0)::int         AS lifetime_requests,
    COALESCE(SUM(d.input_tokens + d.output_tokens), 0)::bigint AS lifetime_tokens,
    COALESCE(SUM(d.total_cost), 0)::numeric(12, 4) AS lifetime_cost_thb,
    COALESCE(SUM(d.total_price), 0)::numeric(12, 4) AS lifetime_spent_thb,
    COALESCE(SUM(d.margin), 0)::numeric(12, 4)     AS lifetime_profit_thb
FROM tbl_user u
LEFT JOIN tbl_daily_usage d ON d.user_id = u.user_id
LEFT JOIN tbl_project p ON p.project_id = COALESCE(d.project_id, u.project_id)
WHERE u.is_deleted = false
GROUP BY u.user_id, u.username, u.name, u.surname, p.project_id, p.project_name;

COMMENT ON VIEW v_user_lifetime_usage IS
    'Per-user all-time totals. Includes users who have never used the service (zero stats).';
