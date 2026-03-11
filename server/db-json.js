/**
 * db-json.js — JSON File-based Database (drop-in replacement for pg.Pool)
 * เก็บข้อมูลใน db.json แทน PostgreSQL — ไม่ต้องติดตั้ง DB ใดๆ
 */

const fs   = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db.json');

// ── Default seed data ──────────────────────────────────────
const DEFAULT_DATA = {
    projects: [
        { id: 1, name: 'SAP Development',  description: 'โปรเจค ABAP/SAP Development', input_rate: 0.50, output_rate: 1.50, created_at: new Date().toISOString() },
        { id: 2, name: 'SAP Consulting',   description: 'โปรเจค SAP Consulting',        input_rate: 0.60, output_rate: 1.80, created_at: new Date().toISOString() },
        { id: 3, name: 'SAP QA & Testing', description: 'โปรเจค QA และ Testing',        input_rate: 0.40, output_rate: 1.20, created_at: new Date().toISOString() },
    ],
    users: [
        { id: 1, username: 'admin', password: 'admin123', display_name: 'System Admin',           role: 'admin', plan: 'enterprise', balance: 0,   project_id: null, created_at: new Date().toISOString() },
        { id: 2, username: 'user',  password: 'user123',  display_name: 'สมชาย ABAP Developer',  role: 'user',  plan: 'pro',        balance: 100, project_id: 1,    created_at: new Date().toISOString() },
        { id: 3, username: 'user2', password: 'user456',  display_name: 'วิชัย SAP Consultant',   role: 'user',  plan: 'starter',    balance: 250, project_id: 2,    created_at: new Date().toISOString() },
        { id: 4, username: 'user3', password: 'user789',  display_name: 'นิภา QA Engineer',       role: 'user',  plan: 'starter',    balance: 500, project_id: 3,    created_at: new Date().toISOString() },
    ],
    usage_history: [],
    chat_sessions: [],
    _seq: { projects: 3, users: 4, usage_history: 0, chat_sessions: 0 },
};

// ── Load / Save ────────────────────────────────────────────
function load() {
    if (!fs.existsSync(DB_FILE)) {
        const init = JSON.parse(JSON.stringify(DEFAULT_DATA));
        fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
        console.log('✅ JSON DB initialised →', DB_FILE);
        return init;
    }
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    // Migration: add chat_sessions if missing
    let migrated = false;
    if (!db.chat_sessions) { db.chat_sessions = []; migrated = true; }
    if (!db._seq.chat_sessions) { db._seq.chat_sessions = 0; migrated = true; }
    if (migrated) { save(db); console.log('✅ DB migrated: added chat_sessions'); }
    return db;
}

function save(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function nextId(db, table) {
    db._seq[table] = (db._seq[table] || 0) + 1;
    return db._seq[table];
}

// ── Query handler ──────────────────────────────────────────
function query(sql, params = []) {
    const db = load();
    const s  = sql.trim().replace(/\s+/g, ' ');

    // ─── AUTH ──────────────────────────────────────────────

    // Login
    if (s.startsWith('SELECT id, username, display_name, role, plan, balance, project_id FROM users WHERE username=')) {
        const [username, password] = params;
        const rows = db.users.filter(u => u.username === username && u.password === password);
        return { rows };
    }

    // ─── USERS ─────────────────────────────────────────────

    // List all users
    if (s.startsWith('SELECT id, username, display_name, role, plan, balance, project_id, created_at FROM users ORDER BY created_at')) {
        const rows = [...db.users].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        return { rows };
    }

    // Create user
    if (s.startsWith('INSERT INTO users (username, password, display_name, role, plan, balance, project_id)')) {
        const [username, password, display_name, role, plan, balance, project_id] = params;
        if (db.users.find(u => u.username === username)) {
            const err = new Error('Username already exists'); err.code = '23505'; throw err;
        }
        const id = nextId(db, 'users');
        db.users.push({
            id, username, password,
            display_name: display_name || username,
            role: role || 'user',
            plan: plan || 'starter',
            balance: parseFloat(balance) || 0,
            project_id: project_id || null,
            created_at: new Date().toISOString(),
        });
        save(db);
        return { rows: [{ id }] };
    }

    // Update user (full edit)
    if (s.startsWith('UPDATE users SET display_name=')) {
        const [display_name, role, plan, balance, project_id, password, id] = params;
        const idx = db.users.findIndex(u => u.id === parseInt(id));
        if (idx !== -1) {
            db.users[idx].display_name = display_name;
            db.users[idx].role        = role;
            db.users[idx].plan        = plan;
            db.users[idx].balance     = parseFloat(balance);
            db.users[idx].project_id  = project_id || null;
            if (password && password !== '') db.users[idx].password = password;
        }
        save(db);
        return { rows: [] };
    }

    // Update balance (direct set)
    if (s.startsWith('UPDATE users SET balance=$1 WHERE id=')) {
        const [balance, id] = params;
        const idx = db.users.findIndex(u => u.id === parseInt(id));
        if (idx !== -1) db.users[idx].balance = parseFloat(balance);
        save(db);
        return { rows: [] };
    }

    // Deduct balance (after AI usage)
    if (s.startsWith('UPDATE users SET balance = balance - $1 WHERE id=')) {
        const [cost, id] = params;
        const idx = db.users.findIndex(u => u.id === parseInt(id) && u.balance >= parseFloat(cost));
        if (idx !== -1) db.users[idx].balance = parseFloat((db.users[idx].balance - parseFloat(cost)).toFixed(4));
        save(db);
        return { rows: [] };
    }

    // Delete user
    if (s.startsWith('DELETE FROM users WHERE id=')) {
        db.users = db.users.filter(u => u.id !== parseInt(params[0]));
        save(db);
        return { rows: [] };
    }

    // ─── PROJECTS ──────────────────────────────────────────

    // List all projects
    if (s.startsWith('SELECT * FROM projects ORDER BY created_at')) {
        const rows = [...db.projects].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        return { rows };
    }

    // Create project
    if (s.startsWith('INSERT INTO projects (name, description, input_rate, output_rate)')) {
        const [name, description, input_rate, output_rate] = params;
        const id = nextId(db, 'projects');
        db.projects.push({
            id, name,
            description: description || '',
            input_rate:  parseFloat(input_rate)  || 0.50,
            output_rate: parseFloat(output_rate) || 1.50,
            created_at: new Date().toISOString(),
        });
        save(db);
        return { rows: [{ id }] };
    }

    // Update project
    if (s.startsWith('UPDATE projects SET name=')) {
        const [name, description, input_rate, output_rate, id] = params;
        const idx = db.projects.findIndex(p => p.id === parseInt(id));
        if (idx !== -1) {
            db.projects[idx].name        = name;
            db.projects[idx].description = description || '';
            db.projects[idx].input_rate  = parseFloat(input_rate);
            db.projects[idx].output_rate = parseFloat(output_rate);
        }
        save(db);
        return { rows: [] };
    }

    // Delete project
    if (s.startsWith('DELETE FROM projects WHERE id=')) {
        db.projects = db.projects.filter(p => p.id !== parseInt(params[0]));
        // Clear project_id from users that belonged to this project
        db.users.forEach(u => { if (u.project_id === parseInt(params[0])) u.project_id = null; });
        save(db);
        return { rows: [] };
    }

    // ─── USAGE HISTORY ────────────────────────────────────

    // History by user
    if (s.includes('FROM usage_history h JOIN users u ON h.user_id=u.id WHERE h.user_id=')) {
        const userId = parseInt(params[0]);
        const hist = [...db.usage_history]
            .filter(h => h.user_id === userId)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 100);
        const rows = hist.map(h => {
            const u = db.users.find(u => u.id === h.user_id) || {};
            return { ...h, username: u.username, display_name: u.display_name };
        });
        return { rows };
    }

    // All history (admin)
    if (s.includes('FROM usage_history h JOIN users u ON h.user_id=u.id ORDER BY')) {
        const hist = [...db.usage_history]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 200);
        const rows = hist.map(h => {
            const u = db.users.find(u => u.id === h.user_id) || {};
            return { ...h, username: u.username, display_name: u.display_name };
        });
        return { rows };
    }

    // Delete all history (admin clear)
    if (s.startsWith('DELETE FROM usage_history') && params.length === 0) {
        db.usage_history = [];
        db._seq.usage_history = 0;
        save(db);
        return { rows: [] };
    }

    // Insert history record
    if (s.startsWith('INSERT INTO usage_history')) {
        const [user_id, skill_id, skill_name, skill_emoji, prompt, response,
               input_tokens, output_tokens, cost, duration_ms] = params;
        const id = nextId(db, 'usage_history');
        db.usage_history.unshift({
            id,
            user_id:       parseInt(user_id),
            skill_id,
            skill_name,
            skill_emoji,
            prompt,
            response,
            input_tokens:  parseInt(input_tokens)  || 0,
            output_tokens: parseInt(output_tokens) || 0,
            cost:          parseFloat(cost)        || 0,
            duration_ms:   parseInt(duration_ms)   || 0,
            created_at:    new Date().toISOString(),
        });
        save(db);
        return { rows: [] };
    }

    // ─── CHAT SESSIONS ────────────────────────────────────

    // List sessions for user (sidebar - no messages)
    if (s.startsWith('SELECT id, title, skill_id, skill_name, skill_emoji, updated_at FROM chat_sessions WHERE user_id=')) {
        const userId = parseInt(params[0]);
        const rows = [...db.chat_sessions]
            .filter(s => s.user_id === userId)
            .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
            .slice(0, 100)
            .map(s => ({
                id: s.id,
                title: s.title,
                skill_id: s.skill_id,
                skill_name: s.skill_name,
                skill_emoji: s.skill_emoji,
                updated_at: s.updated_at,
            }));
        return { rows };
    }

    // Get full session (with messages)
    if (s.startsWith('SELECT * FROM chat_sessions WHERE id=')) {
        const id = parseInt(params[0]);
        const session = db.chat_sessions.find(s => s.id === id);
        return { rows: session ? [session] : [] };
    }

    // Create new session
    if (s.startsWith('INSERT INTO chat_sessions (user_id, title, skill_id, skill_name, skill_emoji, messages)')) {
        const [user_id, title, skill_id, skill_name, skill_emoji, messages] = params;
        const id = nextId(db, 'chat_sessions');
        const now = new Date().toISOString();
        db.chat_sessions.unshift({
            id,
            user_id:    parseInt(user_id),
            title:      title || 'New Chat',
            skill_id,
            skill_name,
            skill_emoji,
            messages:   Array.isArray(messages) ? messages : [],
            created_at: now,
            updated_at: now,
        });
        save(db);
        return { rows: [{ id }] };
    }

    // Update session messages
    if (s.startsWith('UPDATE chat_sessions SET messages=')) {
        const [messages, updated_at, id] = params;
        const idx = db.chat_sessions.findIndex(s => s.id === parseInt(id));
        if (idx !== -1) {
            db.chat_sessions[idx].messages   = Array.isArray(messages) ? messages : [];
            db.chat_sessions[idx].updated_at = updated_at || new Date().toISOString();
        }
        save(db);
        return { rows: [] };
    }

    // Update session title
    if (s.startsWith('UPDATE chat_sessions SET title=')) {
        const [title, id] = params;
        const idx = db.chat_sessions.findIndex(s => s.id === parseInt(id));
        if (idx !== -1) db.chat_sessions[idx].title = title;
        save(db);
        return { rows: [] };
    }

    // Delete session
    if (s.startsWith('DELETE FROM chat_sessions WHERE id=')) {
        db.chat_sessions = db.chat_sessions.filter(s => s.id !== parseInt(params[0]));
        save(db);
        return { rows: [] };
    }

    // ── Fallback ──
    console.warn('[db-json] ⚠️  Unhandled query:', s.substring(0, 100));
    return { rows: [] };
}

// ── pg-Pool-compatible interface ───────────────────────────
const pool = {
    connect: () => Promise.resolve({ release: () => {} }),
    query:   (sql, params) => {
        try {
            return Promise.resolve(query(sql, params));
        } catch (err) {
            return Promise.reject(err);
        }
    },
};

module.exports = { pool };
