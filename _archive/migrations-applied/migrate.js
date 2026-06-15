/**
 * migrate.js — Migrate data from db.json → PostgreSQL
 *
 * Run AFTER:
 *   1. PostgreSQL is installed and running
 *   2. CREATE DATABASE petabyte_ai;
 *   3. psql -U postgres -d petabyte_ai -f schema.sql
 *
 * Usage:
 *   node migrate.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

const pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME     || 'petabyte_ai',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASS     || '',
});

async function migrate() {
    const client = await pool.connect();
    console.log('✅ Connected to PostgreSQL:', process.env.DB_NAME || 'petabyte_ai');

    // Read db.json
    const dbPath = path.join(__dirname, 'db.json');
    if (!fs.existsSync(dbPath)) {
        console.error('❌ db.json not found at', dbPath);
        process.exit(1);
    }
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    console.log(`📂 Loaded db.json — projects:${db.projects?.length||0} users:${db.users?.length||0} history:${db.usage_history?.length||0} sessions:${db.chat_sessions?.length||0}`);

    try {
        await client.query('BEGIN');

        // ── 1. Projects ────────────────────────────────────────
        console.log('\n📁 Migrating projects...');
        for (const p of (db.projects || [])) {
            await client.query(`
                INSERT INTO projects (id, name, description, input_rate, output_rate, created_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (id) DO UPDATE
                    SET name=EXCLUDED.name, description=EXCLUDED.description,
                        input_rate=EXCLUDED.input_rate, output_rate=EXCLUDED.output_rate
            `, [p.id, p.name, p.description||'', p.input_rate||0.50, p.output_rate||1.50, p.created_at||new Date()]);
            console.log(`  ✔ Project [${p.id}] ${p.name}`);
        }
        // Reset sequence
        await client.query(`SELECT setval('projects_id_seq', COALESCE((SELECT MAX(id) FROM projects), 1))`);

        // ── 2. Users ───────────────────────────────────────────
        console.log('\n👤 Migrating users...');
        for (const u of (db.users || [])) {
            await client.query(`
                INSERT INTO users (id, username, password, display_name, role, plan, balance, project_id, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (id) DO UPDATE
                    SET username=EXCLUDED.username, password=EXCLUDED.password,
                        display_name=EXCLUDED.display_name, role=EXCLUDED.role,
                        plan=EXCLUDED.plan, balance=EXCLUDED.balance,
                        project_id=EXCLUDED.project_id
            `, [
                u.id, u.username, u.password, u.display_name||'',
                u.role||'user', u.plan||'starter', u.balance||0,
                u.project_id||null, u.created_at||new Date()
            ]);
            console.log(`  ✔ User [${u.id}] ${u.username} (${u.role})`);
        }
        await client.query(`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1))`);

        // ── 3. Usage History ───────────────────────────────────
        console.log('\n📊 Migrating usage history...');
        const history = db.usage_history || [];
        for (const h of history) {
            await client.query(`
                INSERT INTO usage_history
                    (id, user_id, skill_id, skill_name, skill_emoji, prompt, response,
                     input_tokens, output_tokens, cost, duration_ms, created_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                ON CONFLICT (id) DO NOTHING
            `, [
                h.id, h.user_id, h.skill_id||null, h.skill_name||null, h.skill_emoji||null,
                h.prompt||null, h.response||null,
                h.input_tokens||0, h.output_tokens||0, h.cost||0, h.duration_ms||0,
                h.created_at||new Date()
            ]);
        }
        console.log(`  ✔ ${history.length} usage records migrated`);
        if (history.length > 0) {
            await client.query(`SELECT setval('usage_history_id_seq', COALESCE((SELECT MAX(id) FROM usage_history), 1))`);
        }

        // ── 4. Chat Sessions ───────────────────────────────────
        console.log('\n💬 Migrating chat sessions...');
        const chatSessions = db.chat_sessions || [];
        for (const s of chatSessions) {
            const messages = typeof s.messages === 'string'
                ? s.messages
                : JSON.stringify(s.messages || []);
            await client.query(`
                INSERT INTO chat_sessions
                    (id, user_id, title, skill_id, skill_name, skill_emoji, messages, thread_id, created_at, updated_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
                ON CONFLICT (id) DO NOTHING
            `, [
                s.id, s.user_id, s.title||'New Chat',
                s.skill_id||null, s.skill_name||null, s.skill_emoji||null,
                messages, s.thread_id||null,
                s.created_at||new Date(), s.updated_at||s.created_at||new Date()
            ]);
        }
        console.log(`  ✔ ${chatSessions.length} chat sessions migrated`);
        if (chatSessions.length > 0) {
            await client.query(`SELECT setval('chat_sessions_id_seq', COALESCE((SELECT MAX(id) FROM chat_sessions), 1))`);
        }

        await client.query('COMMIT');
        console.log('\n🎉 Migration complete! All data copied to PostgreSQL.');

        // Summary
        const counts = await client.query(`
            SELECT
                (SELECT COUNT(*) FROM projects)      AS projects,
                (SELECT COUNT(*) FROM users)         AS users,
                (SELECT COUNT(*) FROM usage_history) AS history,
                (SELECT COUNT(*) FROM chat_sessions) AS sessions
        `);
        const c = counts.rows[0];
        console.log('\n📈 PostgreSQL now has:');
        console.log(`   Projects:      ${c.projects}`);
        console.log(`   Users:         ${c.users}`);
        console.log(`   Usage History: ${c.history}`);
        console.log(`   Chat Sessions: ${c.sessions}`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('\n❌ Migration failed, rolled back:', err.message);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch(err => {
    console.error(err);
    process.exit(1);
});
