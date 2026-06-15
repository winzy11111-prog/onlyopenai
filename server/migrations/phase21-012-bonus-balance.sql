-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  Phase 21.12 — Persistent bonus balance (Concept B, Phase 2)            ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- Changes the quota-bonus model from "today-only" to a PERSISTENT BALANCE,
-- like a prepaid top-up: an approved quota request adds to the user's
-- bonus_balance, which carries over indefinitely and is only drawn down by
-- the portion of a day's spend that exceeds the base daily_cap.
--
--   effective_cap(today) = daily_cap + bonus_balance
--   bonus consumed/day   = max(0, spent_today - daily_cap)   (drawn at spend time)
--   leftover bonus_balance persists to the next day (no reset, no cron needed)
--
-- tbl_daily_cap_bonus stays as the historical grant log; bonus_balance is the
-- live spendable figure. Idempotent (ADD COLUMN IF NOT EXISTS).

ALTER TABLE tbl_user
    ADD COLUMN IF NOT EXISTS bonus_balance NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Backfill: seed bonus_balance from any bonus granted TODAY that hasn't been
-- consumed yet (best-effort one-time migration of the old today-only model).
-- Safe to re-run: it only sets rows still at the default 0.
UPDATE tbl_user u
   SET bonus_balance = COALESCE(t.s, 0)
  FROM (SELECT user_id, SUM(extra_amount) AS s
          FROM tbl_daily_cap_bonus
         WHERE bonus_date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date
         GROUP BY user_id) t
 WHERE u.user_id = t.user_id
   AND u.bonus_balance = 0;
