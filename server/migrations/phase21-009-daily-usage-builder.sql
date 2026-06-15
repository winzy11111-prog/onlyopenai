-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  Phase 21.8 — Daily usage builder: fn_build_daily_usage + sp_refresh    ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- Rebuilds tbl_daily_usage (per-day, per-user rollup) from the raw event
-- table tbl_response, pricing each event with its model's rate from
-- tbl_pricing. Idempotent — CREATE OR REPLACE, safe to re-run on every boot.
--
-- fn_build_daily_usage(p_from, p_to)  → RETURNS TABLE  (read-only preview)
-- sp_refresh_daily_usage(p_from, p_to) → PROCEDURE      (UPSERT into table)
--
-- KEY DESIGN NOTES
--   • Cost/price computed PER EVENT then summed (a user-day may mix models
--     with different rates).
--   • Pricing fallback: prefer the rate effective at the event time; if the
--     event predates the earliest pricing row, fall back to that model's
--     nearest-by-effective_from rate (so historical rows still get costed).
--   • Timezone: tbl_response.created_at is already Bangkok-local wall-clock
--     (DB tz = Asia/Bangkok, rows written via now()). So usage_date is just
--     created_at::date — NO timezone conversion (converting would shift
--     evening events to the next day).
--   • fn is LANGUAGE plpgsql (RETURN QUERY) on purpose: a LANGUAGE sql
--     function with GROUP BY + aggregates gets INLINED by the planner, which
--     broke the aggregate/filter when called from the procedure's
--     INSERT...SELECT. plpgsql is never inlined → correct, opaque results.
--   • margin + total_token on tbl_daily_usage are GENERATED columns — never
--     inserted; the DB computes them.

CREATE OR REPLACE FUNCTION fn_build_daily_usage(
    p_from date DEFAULT NULL,
    p_to   date DEFAULT NULL
)
RETURNS TABLE (
    usage_date       date,
    user_id          integer,
    project_id       varchar,
    input_tokens     integer,
    cached_tokens    integer,
    output_tokens    integer,
    reasoning_tokens integer,
    request_count    integer,
    total_cost       numeric(12,4),
    total_price      numeric(12,4),
    margin           numeric(12,4),
    first_seen_at    timestamptz,
    last_updated_at  timestamptz
)
LANGUAGE plpgsql STABLE
AS $fn$
BEGIN
  RETURN QUERY
  WITH priced AS (
      SELECT
          r.created_at::date            AS d_date,
          r.user_id                     AS d_user,
          r.project_id                  AS d_proj,
          r.created_at                  AS d_created,
          r.input_tokens                AS in_tok,
          r.input_cached_tokens         AS cache_tok,
          r.output_tokens               AS out_tok,
          r.output_reasoning_tokens     AS reas_tok,
          ( GREATEST(r.input_tokens - r.input_cached_tokens,0)/1000.0 * pr.input_cost
          + r.input_cached_tokens/1000.0 * COALESCE(pr.cached_cost, pr.input_cost*0.5)
          + r.output_tokens/1000.0 * pr.output_cost )  AS row_cost,
          ( GREATEST(r.input_tokens - r.input_cached_tokens,0)/1000.0 * pr.input_price
          + r.input_cached_tokens/1000.0 * COALESCE(pr.cached_price, pr.input_price*0.5)
          + r.output_tokens/1000.0 * pr.output_price ) AS row_price
      FROM tbl_response r
      LEFT JOIN LATERAL (
          SELECT p.*
          FROM tbl_pricing p
          WHERE p.model = r.model
          ORDER BY
              (CASE WHEN p.effective_from <= (r.created_at AT TIME ZONE 'Asia/Bangkok')
                     AND (p.effective_to IS NULL OR p.effective_to > (r.created_at AT TIME ZONE 'Asia/Bangkok'))
                    THEN 0 ELSE 1 END),
              ABS(EXTRACT(EPOCH FROM (p.effective_from - (r.created_at AT TIME ZONE 'Asia/Bangkok'))))
          LIMIT 1
      ) pr ON TRUE
      WHERE r.user_id IS NOT NULL
        AND (p_from IS NULL OR r.created_at::date >= p_from)
        AND (p_to   IS NULL OR r.created_at::date <= p_to)
  )
  SELECT
      priced.d_date,
      priced.d_user,
      (array_agg(priced.d_proj ORDER BY priced.d_created DESC))[1]::varchar,
      SUM(priced.in_tok)::int,
      SUM(priced.cache_tok)::int,
      SUM(priced.out_tok)::int,
      SUM(priced.reas_tok)::int,
      COUNT(*)::int,
      ROUND(SUM(priced.row_cost), 4),
      ROUND(SUM(priced.row_price), 4),
      ROUND(SUM(priced.row_price - priced.row_cost), 4),
      (MIN(priced.d_created) AT TIME ZONE 'Asia/Bangkok'),
      (MAX(priced.d_created) AT TIME ZONE 'Asia/Bangkok')
  FROM priced
  GROUP BY priced.d_date, priced.d_user;
END;
$fn$;

CREATE OR REPLACE PROCEDURE sp_refresh_daily_usage(
    p_from date DEFAULT NULL,
    p_to   date DEFAULT NULL
)
LANGUAGE plpgsql
AS $sp$
BEGIN
    INSERT INTO tbl_daily_usage (
        usage_date, user_id, project_id,
        input_tokens, cached_tokens, output_tokens, reasoning_tokens,
        request_count, total_cost, total_price,
        first_seen_at, last_updated_at
    )
    SELECT
        f.usage_date, f.user_id, f.project_id,
        f.input_tokens, f.cached_tokens, f.output_tokens, f.reasoning_tokens,
        f.request_count, f.total_cost, f.total_price,
        f.first_seen_at, f.last_updated_at
    FROM fn_build_daily_usage(p_from, p_to) AS f
    ON CONFLICT (usage_date, user_id) DO UPDATE SET
        project_id       = EXCLUDED.project_id,
        input_tokens     = EXCLUDED.input_tokens,
        cached_tokens    = EXCLUDED.cached_tokens,
        output_tokens    = EXCLUDED.output_tokens,
        reasoning_tokens = EXCLUDED.reasoning_tokens,
        request_count    = EXCLUDED.request_count,
        total_cost       = EXCLUDED.total_cost,
        total_price      = EXCLUDED.total_price,
        last_updated_at  = EXCLUDED.last_updated_at;
    -- margin + total_token are GENERATED → auto-computed, never inserted
END;
$sp$;
