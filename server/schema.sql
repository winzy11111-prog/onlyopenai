-- =========================================
-- PetabyteAi — PostgreSQL Schema
-- รัน: psql -U postgres -d petabyte_ai -f schema.sql
-- =========================================

-- ── Projects ──────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    description  TEXT DEFAULT '',
    input_rate   DECIMAL(10,4) DEFAULT 0.50,
    output_rate  DECIMAL(10,4) DEFAULT 1.50,
    created_at   TIMESTAMP DEFAULT NOW()
);

-- ── Users ─────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(50) UNIQUE NOT NULL,
    password      VARCHAR(255) NOT NULL,
    display_name  VARCHAR(100) DEFAULT '',
    role          VARCHAR(20) DEFAULT 'user',
    plan          VARCHAR(20) DEFAULT 'starter',
    balance       DECIMAL(10,2) DEFAULT 0,
    project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    created_at    TIMESTAMP DEFAULT NOW()
);

-- ── Usage History ─────────────────────────
CREATE TABLE IF NOT EXISTS usage_history (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
    skill_id      VARCHAR(50),
    skill_name    VARCHAR(100),
    skill_emoji   VARCHAR(10),
    prompt        TEXT,
    response      TEXT,
    input_tokens  INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost          DECIMAL(10,4) DEFAULT 0,
    duration_ms   INTEGER DEFAULT 0,
    created_at    TIMESTAMP DEFAULT NOW()
);

-- ── Seed: Default Projects ─────────────────
INSERT INTO projects (name, description, input_rate, output_rate) VALUES
    ('SAP Development', 'โปรเจค ABAP/SAP Development', 0.50, 1.50),
    ('SAP Consulting', 'โปรเจค SAP Consulting', 0.60, 1.80),
    ('SAP QA & Testing', 'โปรเจค QA และ Testing', 0.40, 1.20)
ON CONFLICT DO NOTHING;

-- ── Seed: Default Users ────────────────────
-- password ถูก hash ด้วย bcrypt หรือเก็บ plain (สำหรับ dev)
INSERT INTO users (username, password, display_name, role, plan, balance, project_id) VALUES
    ('admin',  'admin123',  'System Admin',        'admin', 'enterprise', 0,   NULL),
    ('user',   'user123',   'สมชาย ABAP Developer', 'user',  'pro',        100, 1),
    ('user2',  'user456',   'วิชัย SAP Consultant',  'user',  'starter',    250, 2),
    ('user3',  'user789',   'นิภา QA Engineer',      'user',  'starter',    500, 3)
ON CONFLICT (username) DO NOTHING;
