-- ╔═══════════════════════════════════════════════════════════╗
-- ║ Phase 0 — Initial schema (baseline for cold installs)     ║
-- ╚═══════════════════════════════════════════════════════════╝
-- Creates every tbl_* table + FKs + indexes + baseline seed
-- rows (roles, account statuses, admin user).
-- Idempotent — every statement uses IF NOT EXISTS / ON CONFLICT.
-- Safe to run against an existing populated DB (no-op).
--
-- To regenerate structure from a reference DB:
--   node dump-schema.js > /tmp/fresh.sql   # then merge by hand

BEGIN;
-- ── tbl_acc_status ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_acc_status (
    acc_status_id            INTEGER NOT NULL,
    acc_status               VARCHAR(100) NOT NULL,
    PRIMARY KEY (acc_status_id)
);

-- ── tbl_daily_token ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_daily_token (
    usage_date_th            DATE NOT NULL,
    project_id               VARCHAR(100) NOT NULL,
    start_time_th            BIGINT NOT NULL,
    end_time_th              BIGINT NOT NULL,
    start_time_utc           BIGINT NOT NULL,
    end_time_utc             BIGINT NOT NULL,
    model                    VARCHAR(20) NOT NULL,
    input_tokens             INTEGER DEFAULT 0 NOT NULL,
    output_tokens            INTEGER DEFAULT 0 NOT NULL,
    input_cached_tokens      INTEGER DEFAULT 0 NOT NULL,
    input_uncached_tokens    INTEGER DEFAULT 0 NOT NULL,
    input_text_tokens        INTEGER DEFAULT 0 NOT NULL,
    output_text_tokens       INTEGER DEFAULT 0 NOT NULL,
    input_cached_text_tokens INTEGER DEFAULT 0 NOT NULL,
    input_audio_tokens       INTEGER DEFAULT 0 NOT NULL,
    input_cached_audio_tokens INTEGER DEFAULT 0 NOT NULL,
    output_audio_tokens      INTEGER DEFAULT 0 NOT NULL,
    input_image_tokens       INTEGER DEFAULT 0 NOT NULL,
    output_image_tokens      INTEGER DEFAULT 0 NOT NULL,
    PRIMARY KEY (usage_date_th)
);

-- ── tbl_project ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_project (
    project_id               VARCHAR(100) NOT NULL,
    project_name             VARCHAR(100) NOT NULL,
    project_api_key          VARCHAR(255) NOT NULL,
    admin_api_key            VARCHAR(255) NOT NULL,
    created_date             DATE DEFAULT CURRENT_DATE NOT NULL,
    description              TEXT DEFAULT ''::text,
    input_rate               NUMERIC(10,4) DEFAULT 0.50,
    output_rate              NUMERIC(10,4) DEFAULT 1.50,
    credit_limit             NUMERIC(12,2) DEFAULT 0,
    is_deleted               BOOLEAN DEFAULT false NOT NULL,
    deleted_at               TIMESTAMPTZ,
    PRIMARY KEY (project_id)
);

-- ── tbl_user_role ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_user_role (
    role_id                  INTEGER NOT NULL,
    role_des                 VARCHAR(100) NOT NULL,
    PRIMARY KEY (role_id)
);

-- ── tbl_balance ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_balance (
    project_id               VARCHAR(100) NOT NULL,
    project_credits          NUMERIC(12,2) DEFAULT 0 NOT NULL,
    top_up_date              DATE DEFAULT CURRENT_DATE NOT NULL,
    top_up_time              TIMESTAMP DEFAULT now() NOT NULL,
    user_id                  INTEGER NOT NULL,
    PRIMARY KEY (project_id)
);

-- ── tbl_user ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_user (
    user_id                  SERIAL NOT NULL,
    project_id               VARCHAR(100),
    role_id                  INTEGER NOT NULL,
    username                 VARCHAR(100) NOT NULL,
    password                 VARCHAR(255) NOT NULL,
    name                     VARCHAR(50) NOT NULL,
    surname                  VARCHAR(50) DEFAULT ''::character varying NOT NULL,
    created_date             DATE DEFAULT CURRENT_DATE NOT NULL,
    acc_status_id            INTEGER NOT NULL,
    is_deleted               BOOLEAN DEFAULT false NOT NULL,
    deleted_at               TIMESTAMPTZ,
    failed_attempts          INTEGER DEFAULT 0 NOT NULL,
    locked_until             TIMESTAMPTZ,
    must_change_password     BOOLEAN DEFAULT false NOT NULL,
    PRIMARY KEY (user_id)
);

-- ── tbl_action_admin ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_action_admin (
    user_id                  INTEGER NOT NULL,
    project_id               VARCHAR(100) NOT NULL,
    role_id                  INTEGER NOT NULL,
    edit_date                DATE DEFAULT CURRENT_DATE NOT NULL,
    edit_time                TIMESTAMP DEFAULT now() NOT NULL,
    id                       BIGSERIAL NOT NULL,
    PRIMARY KEY (id)
);

-- ── tbl_audit_log ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_audit_log (
    user_id                  INTEGER NOT NULL,
    log_in_date              DATE DEFAULT CURRENT_DATE NOT NULL,
    log_in_time              TIMESTAMP DEFAULT now() NOT NULL,
    log_out_date             DATE,
    log_out_time             TIMESTAMP,
    id                       BIGSERIAL NOT NULL,
    PRIMARY KEY (id)
);

-- ── tbl_credits ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_credits (
    user_id                  INTEGER NOT NULL,
    project_id               VARCHAR(100) NOT NULL,
    user_credits             NUMERIC(12,2) DEFAULT 0 NOT NULL,
    PRIMARY KEY (user_id)
);

-- ── tbl_response ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_response (
    response_id              VARCHAR(255) NOT NULL,
    project_id               VARCHAR(100) NOT NULL,
    model                    VARCHAR(20) NOT NULL,
    created_at               TIMESTAMP DEFAULT now() NOT NULL,
    input_param              TEXT DEFAULT ''::text NOT NULL,
    output_param             TEXT DEFAULT ''::text NOT NULL,
    input_tokens             INTEGER DEFAULT 0 NOT NULL,
    input_cached_tokens      INTEGER DEFAULT 0 NOT NULL,
    output_tokens            INTEGER DEFAULT 0 NOT NULL,
    output_reasoning_tokens  INTEGER DEFAULT 0 NOT NULL,
    total_tokens             INTEGER DEFAULT 0 NOT NULL,
    user_id                  INTEGER,
    PRIMARY KEY (response_id)
);

-- ── tbl_session ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tbl_session (
    token                    VARCHAR(128) NOT NULL,
    user_id                  INTEGER NOT NULL,
    role                     VARCHAR(32) NOT NULL,
    expires_at               TIMESTAMPTZ NOT NULL,
    created_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
    last_seen_at             TIMESTAMPTZ DEFAULT now() NOT NULL,
    csrf_token               VARCHAR(64),
    PRIMARY KEY (token)
);

-- ── Foreign keys ───────────────────────────────────────────
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='tbl_balance' AND constraint_name='tbl_balance_project_id_fkey'
    ) THEN
        ALTER TABLE tbl_balance
            ADD CONSTRAINT tbl_balance_project_id_fkey
            FOREIGN KEY (project_id)
            REFERENCES tbl_project(project_id)
        ;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='tbl_user' AND constraint_name='tbl_user_acc_status_id_fkey'
    ) THEN
        ALTER TABLE tbl_user
            ADD CONSTRAINT tbl_user_acc_status_id_fkey
            FOREIGN KEY (acc_status_id)
            REFERENCES tbl_acc_status(acc_status_id)
        ;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='tbl_user' AND constraint_name='tbl_user_project_id_fkey'
    ) THEN
        ALTER TABLE tbl_user
            ADD CONSTRAINT tbl_user_project_id_fkey
            FOREIGN KEY (project_id)
            REFERENCES tbl_project(project_id)
        ;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='tbl_user' AND constraint_name='tbl_user_role_id_fkey'
    ) THEN
        ALTER TABLE tbl_user
            ADD CONSTRAINT tbl_user_role_id_fkey
            FOREIGN KEY (role_id)
            REFERENCES tbl_user_role(role_id)
        ;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='tbl_action_admin' AND constraint_name='tbl_action_admin_user_id_fkey'
    ) THEN
        ALTER TABLE tbl_action_admin
            ADD CONSTRAINT tbl_action_admin_user_id_fkey
            FOREIGN KEY (user_id)
            REFERENCES tbl_user(user_id)
        ;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='tbl_audit_log' AND constraint_name='tbl_audit_log_user_id_fkey'
    ) THEN
        ALTER TABLE tbl_audit_log
            ADD CONSTRAINT tbl_audit_log_user_id_fkey
            FOREIGN KEY (user_id)
            REFERENCES tbl_user(user_id)
        ;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='tbl_credits' AND constraint_name='tbl_credits_project_id_fkey'
    ) THEN
        ALTER TABLE tbl_credits
            ADD CONSTRAINT tbl_credits_project_id_fkey
            FOREIGN KEY (project_id)
            REFERENCES tbl_balance(project_id)
        ;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='tbl_credits' AND constraint_name='tbl_credits_user_id_fkey'
    ) THEN
        ALTER TABLE tbl_credits
            ADD CONSTRAINT tbl_credits_user_id_fkey
            FOREIGN KEY (user_id)
            REFERENCES tbl_user(user_id)
        ;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='tbl_response' AND constraint_name='tbl_response_project_id_fkey'
    ) THEN
        ALTER TABLE tbl_response
            ADD CONSTRAINT tbl_response_project_id_fkey
            FOREIGN KEY (project_id)
            REFERENCES tbl_project(project_id)
        ;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='tbl_response' AND constraint_name='tbl_response_user_id_fkey'
    ) THEN
        ALTER TABLE tbl_response
            ADD CONSTRAINT tbl_response_user_id_fkey
            FOREIGN KEY (user_id)
            REFERENCES tbl_user(user_id)
            ON DELETE SET NULL
        ;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='tbl_session' AND constraint_name='tbl_session_user_id_fkey'
    ) THEN
        ALTER TABLE tbl_session
            ADD CONSTRAINT tbl_session_user_id_fkey
            FOREIGN KEY (user_id)
            REFERENCES tbl_user(user_id)
            ON DELETE CASCADE
        ;
    END IF;
END $$;

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_project_active ON public.tbl_project USING btree (project_id) WHERE (is_deleted = false);
CREATE INDEX IF NOT EXISTS idx_user_active ON public.tbl_user USING btree (user_id) WHERE (is_deleted = false);
CREATE INDEX IF NOT EXISTS idx_user_locked ON public.tbl_user USING btree (locked_until) WHERE (locked_until IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_user_project ON public.tbl_user USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_action_admin_user_time ON public.tbl_action_admin USING btree (user_id, edit_time DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON public.tbl_audit_log USING btree (user_id, log_in_time DESC);
CREATE INDEX IF NOT EXISTS idx_credits_project ON public.tbl_credits USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_response_project_created ON public.tbl_response USING btree (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_response_user_created ON public.tbl_response USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_expires ON public.tbl_session USING btree (expires_at);
CREATE INDEX IF NOT EXISTS idx_session_user ON public.tbl_session USING btree (user_id);


-- ── Seed: lookup tables ─────────────────────────────────────
INSERT INTO tbl_user_role (role_id, role_des) VALUES
    (1, 'admin'),
    (2, 'general user')
ON CONFLICT (role_id) DO NOTHING;

INSERT INTO tbl_acc_status (acc_status_id, acc_status) VALUES
    (1, 'active'),
    (2, 'inactive'),
    (3, 'locked')
ON CONFLICT (acc_status_id) DO NOTHING;

-- ── Seed: bootstrap admin user ──────────────────────────────
-- Default credentials: admin / admin123
-- bcrypt hash below matches 'admin123' (cost 10).
-- must_change_password = TRUE forces reset on first login.
-- Note: tbl_user has no UNIQUE constraint on username in legacy
-- schema, so we guard with WHERE NOT EXISTS (ON CONFLICT would
-- require the constraint to exist).
INSERT INTO tbl_user
    (username, password, name, surname, role_id, acc_status_id, must_change_password)
SELECT 'admin',
       '$2b$10$K9KYIqxL58W0sX6wf5Rq/eQROdFg5mfxnuWD2surPnDXEgaDjpWGS',
       'System', 'Admin', 1, 1, TRUE
WHERE NOT EXISTS (SELECT 1 FROM tbl_user WHERE username = 'admin');

COMMIT;
