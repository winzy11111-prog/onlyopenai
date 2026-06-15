-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  Phase 21.8 — tbl_daily_usage.total_token (GENERATED column)            ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- Adds a stored generated column total_token = input_tokens + output_tokens.
-- (cached_tokens ⊆ input_tokens and reasoning_tokens ⊆ output_tokens, so they
-- are NOT added again — this matches tbl_response.total_tokens = in + out.)
--
-- GENERATED ALWAYS … STORED → always consistent, never inserted/updated by
-- hand; the daily-usage builder (phase21-009) leaves it for the DB to compute.
-- Idempotent via IF NOT EXISTS.

ALTER TABLE tbl_daily_usage
    ADD COLUMN IF NOT EXISTS total_token integer
    GENERATED ALWAYS AS (input_tokens + output_tokens) STORED;
