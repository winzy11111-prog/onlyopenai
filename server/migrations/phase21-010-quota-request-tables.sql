-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  Phase 21.10 — Quota request workflow (Concept B)                       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- Tables that back the "user hit daily cap → request a temporary increase"
-- flow described in docs/credit-balance-concept.md.
--
--   tbl_quota_request   — user-initiated request, admin-resolved
--   tbl_daily_cap_bonus — today-only cap bump granted on approval
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS tbl_quota_request (
    request_id      BIGSERIAL    PRIMARY KEY,
    user_id         INTEGER      NOT NULL REFERENCES tbl_user(user_id),
    project_id      VARCHAR      NOT NULL REFERENCES tbl_project(project_id) ON UPDATE CASCADE,
    requested_extra NUMERIC(12,2) NOT NULL CHECK (requested_extra > 0),
    reason          TEXT,
    status          VARCHAR(16)  NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','denied','cancelled')),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    resolved_by     INTEGER      REFERENCES tbl_user(user_id),
    resolved_at     TIMESTAMPTZ,
    resolved_note   TEXT
);

CREATE INDEX IF NOT EXISTS idx_quota_req_status ON tbl_quota_request(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quota_req_user   ON tbl_quota_request(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tbl_daily_cap_bonus (
    bonus_id     BIGSERIAL    PRIMARY KEY,
    user_id      INTEGER      NOT NULL REFERENCES tbl_user(user_id),
    bonus_date   DATE         NOT NULL,
    extra_amount NUMERIC(12,2) NOT NULL CHECK (extra_amount > 0),
    granted_by   INTEGER      REFERENCES tbl_user(user_id),
    granted_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    request_id   BIGINT       REFERENCES tbl_quota_request(request_id),
    note         TEXT,
    -- One grant per (user, day, request) — prevents double-approval of the
    -- same request from doubling the bonus. Multiple distinct requests on
    -- the same day still stack.
    UNIQUE (user_id, bonus_date, request_id)
);
CREATE INDEX IF NOT EXISTS idx_cap_bonus_user_date ON tbl_daily_cap_bonus(user_id, bonus_date);
