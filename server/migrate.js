/**
 * migrate.js — สร้างตาราง PostgreSQL สำหรับ PetabyteAi
 * รัน: node migrate.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'petabyte_ai',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || '',
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('🔄 Running migrations...');

        await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id           SERIAL PRIMARY KEY,
        name         VARCHAR(100) NOT NULL,
        description  TEXT DEFAULT '',
        input_rate   DECIMAL(10,4) DEFAULT 0.50,
        output_rate  DECIMAL(10,4) DEFAULT 1.50,
        created_at   TIMESTAMP DEFAULT NOW()
      )
    `);
        console.log('✅ Table: projects');

        await client.query(`
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
      )
    `);
        console.log('✅ Table: users');

        await client.query(`
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
      )
    `);
        console.log('✅ Table: usage_history');

        // Seed projects
        await client.query(`
      INSERT INTO projects (name, description, input_rate, output_rate) VALUES
        ('SAP Development', 'โปรเจค ABAP/SAP Development', 0.50, 1.50),
        ('SAP Consulting', 'โปรเจค SAP Consulting', 0.60, 1.80),
        ('SAP QA & Testing', 'โปรเจค QA และ Testing', 0.40, 1.20)
      ON CONFLICT DO NOTHING
    `);
        console.log('✅ Seeded: projects');

        // Seed users
        const projectIds = await client.query('SELECT id FROM projects ORDER BY id ASC LIMIT 3');
        const [p1, p2, p3] = projectIds.rows.map(r => r.id);

        await client.query(`
      INSERT INTO users (username, password, display_name, role, plan, balance, project_id) VALUES
        ('admin',  'admin123',  'System Admin',         'admin', 'enterprise', 0,   NULL),
        ('user',   'user123',   'สมชาย ABAP Developer', 'user',  'pro',        100, $1),
        ('user2',  'user456',   'วิชัย SAP Consultant',  'user',  'starter',    250, $2),
        ('user3',  'user789',   'นิภา QA Engineer',      'user',  'starter',    500, $3)
      ON CONFLICT (username) DO NOTHING
    `, [p1, p2, p3]);
        console.log('✅ Seeded: users');

        console.log('');
        console.log('🎉 Migration complete! Tables ready in petabyte_ai database.');
    } catch (e) {
        console.error('❌ Migration failed:', e.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
