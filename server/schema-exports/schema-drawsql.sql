-- ════════════════════════════════════════════════════════════════════
-- PetabyteAi DB — drawsql.app import format
-- Generated: 2026-05-11T10:35:38.569Z
--
-- How to use:
--   1) Open https://drawsql.app/teams/<you>/diagrams/new
--   2) Choose "Import from SQL"  →  Database: PostgreSQL
--   3) Paste this entire file and import.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE tbl_acc_status (
    acc_status_id INTEGER NOT NULL PRIMARY KEY,
    acc_status VARCHAR(100) NOT NULL
);

CREATE TABLE tbl_action_admin (
    user_id INTEGER NOT NULL,
    project_id VARCHAR(100),
    role_id INTEGER NOT NULL,
    edit_date DATE DEFAULT CURRENT_DATE NOT NULL,
    edit_time TIMESTAMP WITHOUT TIME ZONE DEFAULT now() NOT NULL,
    id BIGINT NOT NULL PRIMARY KEY,
    action_type VARCHAR(40),
    target_type VARCHAR(20),
    target_id INTEGER,
    change_json JSONB,
    FOREIGN KEY (user_id) REFERENCES tbl_user(user_id)
);

CREATE TABLE tbl_audit_log (
    user_id INTEGER,
    log_in_date DATE DEFAULT CURRENT_DATE NOT NULL,
    log_in_time TIMESTAMP WITHOUT TIME ZONE DEFAULT now() NOT NULL,
    log_out_date DATE,
    log_out_time TIMESTAMP WITHOUT TIME ZONE,
    id BIGINT NOT NULL PRIMARY KEY,
    event_type VARCHAR(20),
    detail JSONB,
    ip VARCHAR(45),
    FOREIGN KEY (user_id) REFERENCES tbl_user(user_id)
);

CREATE TABLE tbl_balance (
    project_id VARCHAR(100) NOT NULL PRIMARY KEY,
    project_credits NUMERIC DEFAULT 0 NOT NULL,
    top_up_date DATE DEFAULT CURRENT_DATE NOT NULL,
    top_up_time TIMESTAMP WITHOUT TIME ZONE DEFAULT now() NOT NULL,
    user_id INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES tbl_project(project_id) ON UPDATE CASCADE
);

CREATE TABLE tbl_chat_message (
    message_id BIGINT NOT NULL PRIMARY KEY,
    session_id BIGINT NOT NULL,
    role VARCHAR(16) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost NUMERIC,
    model VARCHAR(64),
    skill_id VARCHAR(64),
    FOREIGN KEY (session_id) REFERENCES tbl_chat_session(session_id) ON DELETE CASCADE
);

CREATE TABLE tbl_chat_session (
    session_id BIGINT NOT NULL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title VARCHAR(200) DEFAULT 'New chat'::character varying NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    is_deleted BOOLEAN DEFAULT false NOT NULL,
    message_count INTEGER DEFAULT 0 NOT NULL,
    total_cost NUMERIC DEFAULT 0 NOT NULL,
    FOREIGN KEY (user_id) REFERENCES tbl_user(user_id) ON DELETE CASCADE
);

CREATE TABLE tbl_credits (
    user_id INTEGER NOT NULL PRIMARY KEY,
    project_id VARCHAR(100) NOT NULL,
    user_credits NUMERIC DEFAULT 0 NOT NULL,
    FOREIGN KEY (user_id) REFERENCES tbl_user(user_id),
    FOREIGN KEY (project_id) REFERENCES tbl_balance(project_id) ON UPDATE CASCADE
);

CREATE TABLE tbl_daily_token (
    usage_date_th DATE NOT NULL PRIMARY KEY,
    project_id VARCHAR(100) NOT NULL,
    start_time_th BIGINT NOT NULL,
    end_time_th BIGINT NOT NULL,
    start_time_utc BIGINT NOT NULL,
    end_time_utc BIGINT NOT NULL,
    model VARCHAR(20) NOT NULL,
    input_tokens INTEGER DEFAULT 0 NOT NULL,
    output_tokens INTEGER DEFAULT 0 NOT NULL,
    input_cached_tokens INTEGER DEFAULT 0 NOT NULL,
    input_uncached_tokens INTEGER DEFAULT 0 NOT NULL,
    input_text_tokens INTEGER DEFAULT 0 NOT NULL,
    output_text_tokens INTEGER DEFAULT 0 NOT NULL,
    input_cached_text_tokens INTEGER DEFAULT 0 NOT NULL,
    input_audio_tokens INTEGER DEFAULT 0 NOT NULL,
    input_cached_audio_tokens INTEGER DEFAULT 0 NOT NULL,
    output_audio_tokens INTEGER DEFAULT 0 NOT NULL,
    input_image_tokens INTEGER DEFAULT 0 NOT NULL,
    output_image_tokens INTEGER DEFAULT 0 NOT NULL
);

CREATE TABLE tbl_project (
    project_id VARCHAR(100) NOT NULL PRIMARY KEY,
    project_name VARCHAR(100) NOT NULL,
    project_api_key TEXT,
    admin_api_key TEXT,
    created_date DATE DEFAULT CURRENT_DATE NOT NULL,
    description TEXT DEFAULT ''::text,
    input_rate NUMERIC DEFAULT 0.50,
    output_rate NUMERIC DEFAULT 1.50,
    credit_limit NUMERIC DEFAULT 0,
    is_deleted BOOLEAN DEFAULT false NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    openai_project_id VARCHAR(64),
    openai_service_account_id VARCHAR(64),
    openai_synced_at TIMESTAMP WITH TIME ZONE,
    cached_input_rate NUMERIC DEFAULT 0.25
);

CREATE TABLE tbl_response (
    response_id VARCHAR(255) NOT NULL PRIMARY KEY,
    project_id VARCHAR(100) NOT NULL,
    model VARCHAR(20) NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now() NOT NULL,
    input_param TEXT DEFAULT ''::text NOT NULL,
    output_param TEXT DEFAULT ''::text NOT NULL,
    input_tokens INTEGER DEFAULT 0 NOT NULL,
    input_cached_tokens INTEGER DEFAULT 0 NOT NULL,
    output_tokens INTEGER DEFAULT 0 NOT NULL,
    output_reasoning_tokens INTEGER DEFAULT 0 NOT NULL,
    total_tokens INTEGER DEFAULT 0 NOT NULL,
    user_id INTEGER,
    FOREIGN KEY (user_id) REFERENCES tbl_user(user_id) ON DELETE SET NULL,
    FOREIGN KEY (project_id) REFERENCES tbl_project(project_id) ON UPDATE CASCADE
);

CREATE TABLE tbl_session (
    token VARCHAR(128) NOT NULL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    role VARCHAR(32) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    csrf_token VARCHAR(64),
    FOREIGN KEY (user_id) REFERENCES tbl_user(user_id) ON DELETE CASCADE
);

CREATE TABLE tbl_topup_history (
    id BIGINT NOT NULL PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL,
    user_id INTEGER NOT NULL,
    amount NUMERIC NOT NULL,
    balance_before NUMERIC NOT NULL,
    balance_after NUMERIC NOT NULL,
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    FOREIGN KEY (project_id) REFERENCES tbl_project(project_id) ON UPDATE CASCADE,
    FOREIGN KEY (user_id) REFERENCES tbl_user(user_id)
);

CREATE TABLE tbl_user (
    user_id INTEGER NOT NULL PRIMARY KEY,
    project_id VARCHAR(100),
    role_id INTEGER NOT NULL,
    username VARCHAR(100) NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(50) NOT NULL,
    surname VARCHAR(50) DEFAULT ''::character varying NOT NULL,
    created_date DATE DEFAULT CURRENT_DATE NOT NULL,
    acc_status_id INTEGER NOT NULL,
    is_deleted BOOLEAN DEFAULT false NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    failed_attempts INTEGER DEFAULT 0 NOT NULL,
    locked_until TIMESTAMP WITH TIME ZONE,
    must_change_password BOOLEAN DEFAULT false NOT NULL,
    daily_cap NUMERIC,
    FOREIGN KEY (role_id) REFERENCES tbl_user_role(role_id),
    FOREIGN KEY (acc_status_id) REFERENCES tbl_acc_status(acc_status_id),
    FOREIGN KEY (project_id) REFERENCES tbl_project(project_id) ON UPDATE CASCADE
);

CREATE TABLE tbl_user_role (
    role_id INTEGER NOT NULL PRIMARY KEY,
    role_des VARCHAR(100) NOT NULL
);

