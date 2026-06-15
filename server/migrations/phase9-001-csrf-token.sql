-- ╔═══════════════════════════════════════════════════════════╗
-- ║ Phase 9 — 001: CSRF token per session                     ║
-- ╚═══════════════════════════════════════════════════════════╝
-- Double-submit pattern. The session token lives in an HttpOnly
-- cookie (browser sends it automatically, JS cannot read it).
-- The CSRF token also belongs to the session but lives in a JSON
-- response on login + must be echoed by client JS in X-CSRF-Token
-- header on every state-changing request. Attacker on another
-- origin can forge the cookie ride but not the header.
-- Idempotent — safe to re-run.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='tbl_session' AND column_name='csrf_token') THEN
        ALTER TABLE tbl_session ADD COLUMN csrf_token VARCHAR(64) NULL;
    END IF;
END $$;

COMMIT;
