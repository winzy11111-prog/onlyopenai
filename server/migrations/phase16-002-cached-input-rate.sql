-- ╔═══════════════════════════════════════════════════════════╗
-- ║ Phase 16 — Cached-input billing rate per project           ║
-- ╚═══════════════════════════════════════════════════════════╝
-- OpenAI bills cached prompt tokens at a discount (typically 50 % of the
-- regular input rate for gpt-4o family). tbl_response already has
-- `input_cached_tokens` (Phase 0 schema was prescient), but every cost
-- computation in the app currently treats all input tokens as full-price.
--
-- This migration adds a per-project knob — `cached_input_rate` — so admin
-- can set the discount. Default is HALF the existing input_rate, which is
-- the published rate for gpt-4o / gpt-4o-mini at the time of writing
-- (Nov 2024 pricing announcement).
--
-- Idempotent: uses ADD COLUMN IF NOT EXISTS so re-running is safe.

ALTER TABLE tbl_project
    ADD COLUMN IF NOT EXISTS cached_input_rate NUMERIC(10, 4);

-- Backfill: half of the current input_rate. Round to 4 decimals because
-- the existing rate columns are stored at NUMERIC default precision and
-- 4 decimals is more than enough for prices like 0.0625 ฿/1K.
UPDATE tbl_project
   SET cached_input_rate = ROUND((input_rate * 0.5)::numeric, 4)
 WHERE cached_input_rate IS NULL;

-- Going forward, NEW projects also get the half-of-input default.
-- (Server-side INSERT will fill this in too, but having a sane DB default
-- means SQL clients and migrations don't accidentally write NULL.)
ALTER TABLE tbl_project
    ALTER COLUMN cached_input_rate SET DEFAULT 0.25;
