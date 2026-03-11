/**
 * server.js — PetabyteAi Backend Server
 * OpenAI Streaming proxy + PostgreSQL database
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3001;

// ── JSON File Database (drop-in for pg.Pool) ───────────────
const { pool } = require('./db-json');
pool.connect().then(c => { console.log('✅ JSON DB ready (db.json)'); c.release(); });

// ── OpenAI ─────────────────────────────────────────────────
const HAS_API_KEY = !!(
    process.env.OPENAI_API_KEY &&
    !process.env.OPENAI_API_KEY.startsWith('sk-xxx')
);
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
let openai = null;
if (HAS_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log(`✅ OpenAI ready — model: ${MODEL}`);
} else {
    console.log('⚠️  No OpenAI API Key — MOCK mode');
}

// ── Middleware ─────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// ══════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ ok: false, error: 'username/password required' });
    try {
        const r = await pool.query(
            'SELECT id, username, display_name, role, plan, balance, project_id FROM users WHERE username=$1 AND password=$2',
            [username, password]
        );
        if (r.rows.length === 0) return res.json({ ok: false, error: 'Invalid credentials' });
        const u = r.rows[0];
        res.json({ ok: true, user: { id: u.id, username: u.username, displayName: u.display_name, role: u.role, plan: u.plan, balance: parseFloat(u.balance), projectId: u.project_id } });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ══════════════════════════════════════════════════════════
//  USERS
// ══════════════════════════════════════════════════════════

// GET /api/users
app.get('/api/users', async (req, res) => {
    try {
        const r = await pool.query('SELECT id, username, display_name, role, plan, balance, project_id, created_at FROM users ORDER BY created_at ASC');
        res.json({ ok: true, users: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /api/users  — create user
app.post('/api/users', async (req, res) => {
    const { username, password, displayName, role, plan, balance, projectId } = req.body;
    try {
        const r = await pool.query(
            'INSERT INTO users (username, password, display_name, role, plan, balance, project_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
            [username, password, displayName || username, role || 'user', plan || 'starter', balance || 0, projectId || null]
        );
        res.json({ ok: true, id: r.rows[0].id });
    } catch (e) {
        if (e.code === '23505') return res.json({ ok: false, error: 'Username already exists' });
        res.status(500).json({ ok: false, error: e.message });
    }
});

// PUT /api/users/:id  — edit user
app.put('/api/users/:id', async (req, res) => {
    const { displayName, role, plan, balance, projectId, password } = req.body;
    try {
        await pool.query(
            'UPDATE users SET display_name=$1, role=$2, plan=$3, balance=$4, project_id=$5, password=COALESCE(NULLIF($6,\'\'), password) WHERE id=$7',
            [displayName, role, plan, balance, projectId || null, password || '', req.params.id]
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// PUT /api/users/:id/balance  — update balance
app.put('/api/users/:id/balance', async (req, res) => {
    const { balance } = req.body;
    try {
        await pool.query('UPDATE users SET balance=$1 WHERE id=$2', [balance, req.params.id]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// DELETE /api/users/:id
app.delete('/api/users/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ══════════════════════════════════════════════════════════
//  PROJECTS
// ══════════════════════════════════════════════════════════

// GET /api/projects
app.get('/api/projects', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM projects ORDER BY created_at ASC');
        res.json({ ok: true, projects: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /api/projects
app.post('/api/projects', async (req, res) => {
    const { name, description, inputRate, outputRate } = req.body;
    try {
        const r = await pool.query(
            'INSERT INTO projects (name, description, input_rate, output_rate) VALUES ($1,$2,$3,$4) RETURNING id',
            [name, description || '', inputRate || 0.50, outputRate || 1.50]
        );
        res.json({ ok: true, id: r.rows[0].id });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// PUT /api/projects/:id
app.put('/api/projects/:id', async (req, res) => {
    const { name, description, inputRate, outputRate } = req.body;
    try {
        await pool.query(
            'UPDATE projects SET name=$1, description=$2, input_rate=$3, output_rate=$4 WHERE id=$5',
            [name, description || '', inputRate, outputRate, req.params.id]
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// DELETE /api/projects/:id
app.delete('/api/projects/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM projects WHERE id=$1', [req.params.id]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ══════════════════════════════════════════════════════════
//  USAGE HISTORY
// ══════════════════════════════════════════════════════════

// GET /api/history?userId=1  (admin ดูทั้งหมด ถ้าไม่ส่ง userId)
app.get('/api/history', async (req, res) => {
    try {
        const { userId } = req.query;
        let r;
        if (userId) {
            r = await pool.query(
                'SELECT h.*, u.username, u.display_name FROM usage_history h JOIN users u ON h.user_id=u.id WHERE h.user_id=$1 ORDER BY h.created_at DESC LIMIT 100',
                [userId]
            );
        } else {
            r = await pool.query(
                'SELECT h.*, u.username, u.display_name FROM usage_history h JOIN users u ON h.user_id=u.id ORDER BY h.created_at DESC LIMIT 200'
            );
        }
        res.json({ ok: true, history: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// DELETE /api/history  — ล้าง log ทั้งหมด (admin)
app.delete('/api/history', async (req, res) => {
    try {
        await pool.query('DELETE FROM usage_history');
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /api/history  — บันทึกหลังรัน skill
app.post('/api/history', async (req, res) => {
    const { userId, skillId, skillName, skillEmoji, prompt, response, inputTokens, outputTokens, cost, durationMs } = req.body;
    try {
        await pool.query(
            `INSERT INTO usage_history
         (user_id, skill_id, skill_name, skill_emoji, prompt, response, input_tokens, output_tokens, cost, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [userId, skillId, skillName, skillEmoji, prompt, response, inputTokens || 0, outputTokens || 0, cost || 0, durationMs || 0]
        );
        // หัก balance
        await pool.query('UPDATE users SET balance = balance - $1 WHERE id=$2 AND balance >= $1', [cost || 0, userId]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ══════════════════════════════════════════════════════════
//  CHAT SESSIONS
// ══════════════════════════════════════════════════════════

// GET /api/sessions?userId=X
app.get('/api/sessions', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.json({ ok: false, error: 'userId required' });
    try {
        const r = await pool.query(
            'SELECT id, title, skill_id, skill_name, skill_emoji, updated_at FROM chat_sessions WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100',
            [userId]
        );
        res.json({ ok: true, sessions: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET /api/sessions/:id  — ดึง session พร้อม messages
app.get('/api/sessions/:id', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM chat_sessions WHERE id=$1', [req.params.id]);
        if (r.rows.length === 0) return res.json({ ok: false, error: 'Session not found' });
        res.json({ ok: true, session: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /api/sessions  — สร้าง session ใหม่
app.post('/api/sessions', async (req, res) => {
    const { userId, title, skillId, skillName, skillEmoji, messages } = req.body;
    if (!userId) return res.json({ ok: false, error: 'userId required' });
    try {
        const r = await pool.query(
            'INSERT INTO chat_sessions (user_id, title, skill_id, skill_name, skill_emoji, messages) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
            [userId, title || 'New Chat', skillId, skillName, skillEmoji, messages || []]
        );
        res.json({ ok: true, id: r.rows[0].id });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// PUT /api/sessions/:id  — อัพเดต messages หรือ title
app.put('/api/sessions/:id', async (req, res) => {
    const { messages, title } = req.body;
    try {
        if (messages !== undefined) {
            const now = new Date().toISOString();
            await pool.query(
                'UPDATE chat_sessions SET messages=$1, updated_at=$2 WHERE id=$3',
                [messages, now, req.params.id]
            );
        }
        if (title !== undefined) {
            await pool.query('UPDATE chat_sessions SET title=$1 WHERE id=$2', [title, req.params.id]);
        }
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// DELETE /api/sessions/:id
app.delete('/api/sessions/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM chat_sessions WHERE id=$1', [req.params.id]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ══════════════════════════════════════════════════════════
//  OPENAI CHAT (Streaming SSE)
// ══════════════════════════════════════════════════════════

app.get('/api/health', (req, res) => {
    res.json({ ok: true, mode: HAS_API_KEY ? 'openai' : 'mock', model: HAS_API_KEY ? MODEL : null });
});

app.post('/api/chat', async (req, res) => {
    if (!HAS_API_KEY) { res.json({ ok: false, useMock: true, reason: 'no_api_key' }); return; }

    const { prompt, systemPrompt, inputRate = 0.50, outputRate = 1.50 } = req.body;
    if (!prompt) { res.status(400).json({ ok: false, error: 'prompt required' }); return; }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    const startTime = Date.now();
    let inputTokens = 0, outputTokens = 0, fullText = '';

    try {
        // ── {code} placeholder — inject user's ABAP code into system prompt ──
        let finalSystemPrompt = systemPrompt || 'คุณเป็น AI assistant ที่ช่วยงาน SAP ABAP';
        let finalUserPrompt = prompt;
        if (finalSystemPrompt.includes('{code}')) {
            // The user's input IS the code — embed it into the system prompt
            finalSystemPrompt = finalSystemPrompt.replace('{code}', prompt);
            finalUserPrompt = 'Please analyze the ABAP code provided above and apply the corrections.';
        }

        const stream = await openai.chat.completions.create({
            model, stream: true, max_tokens: 2000, temperature: 0.4,
            messages: [
                { role: 'system', content: finalSystemPrompt },
                { role: 'user', content: finalUserPrompt }
            ],
        });

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || '';
            if (delta) { fullText += delta; sendEvent({ type: 'chunk', text: delta }); }
            if (chunk.usage) { inputTokens = chunk.usage.prompt_tokens || 0; outputTokens = chunk.usage.completion_tokens || 0; }
        }

        if (inputTokens === 0) {
            inputTokens = Math.ceil((prompt.length + (systemPrompt || '').length) / 3.5);
            outputTokens = Math.ceil(fullText.length / 3.5);
        }

        const durationMs = Date.now() - startTime;
        const cost = (inputTokens / 1000) * inputRate + (outputTokens / 1000) * outputRate;
        console.log(`[chat] ${inputTokens}in/${outputTokens}out | ฿${cost.toFixed(4)} | ${durationMs}ms`);
        sendEvent({ type: 'done', inputTokens, outputTokens, cost, durationMs });
        res.end();

    } catch (err) {
        console.error('[chat] Error:', err.message);
        if (err.status === 401 || err.status === 429) {
            sendEvent({ type: 'use_mock', reason: err.status === 429 ? 'quota_exceeded' : 'invalid_key' });
        } else { sendEvent({ type: 'error', error: err.message }); }
        res.end();
    }
});

// ── Start ──────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║   PetabyteAi Backend Server          ║');
    console.log(`║   http://localhost:${PORT}              ║`);
    console.log(`║   OpenAI: ${HAS_API_KEY ? '🟢 Live           ' : '🟡 Mock          '}   ║`);
    console.log('║   DB:     🟢 PostgreSQL              ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('');
});
