// ╔═══════════════════════════════════════════════════════════╗
// ║ Tier 1 — Session search (?q=) smoke                       ║
// ╚═══════════════════════════════════════════════════════════╝
// Assumes a running server on :3001.
//
// Covers:
//   1. Empty q → full list (no filtering)
//   2. Match by session title (ILIKE case-insensitive)
//   3. Match by message content (EXISTS subquery path)
//   4. No match → empty list, ok:true
//   5. ILIKE wildcards in user input (%, _) are escaped literally
//   6. Search still respects ownership (user B doesn't see user A's rows)
//   7. Unauthenticated search → 401
//
// Run:  node smoke-tier1-search.js

'use strict';

require('dotenv').config();
const http = require('http');

const HOST = 'localhost', PORT = 3001;

function req(method, path, { body, token, csrf } = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const opts = {
            host: HOST, port: PORT, method, path,
            headers: {
                'Content-Type': 'application/json',
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
                ...(token ? { Authorization: 'Bearer ' + token } : {}),
                ...(csrf  ? { 'X-CSRF-Token': csrf }              : {}),
            },
        };
        const r = http.request(opts, (res) => {
            let buf = '';
            res.on('data', (c) => buf += c);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(buf); } catch (_) {}
                resolve({ status: res.statusCode, body: json, raw: buf });
            });
        });
        r.on('error', (e) => resolve({ status: 0, error: e.message }));
        if (data) r.write(data);
        r.end();
    });
}

let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else      { fail++; failures.push({ name, detail }); console.log(`  FAIL  ${name}  ${detail || ''}`); }
}

async function loginAs(u, p) {
    const r = await req('POST', '/api/auth/login', { body: { username: u, password: p } });
    return { token: r.body?.token, csrf: r.body?.csrfToken, body: r.body };
}

// Helper: insert a message directly under a session so we can search by content
async function pushMessage(pool, sessionId, role, content) {
    await pool.query(
        `INSERT INTO tbl_chat_message (session_id, role, content) VALUES ($1,$2,$3)`,
        [sessionId, role, content]);
}

(async () => {
    console.log('\n=== Tier 1 search smoke ===\n');

    const admin = await loginAs('admin', 'admin123');
    if (!admin.token) { console.log('FATAL admin login failed'); process.exit(2); }

    // Create unique test user B
    const USER_B    = 'smoke_search_' + Date.now().toString(36);
    const USER_B_PW = 'SmokeSearchB1A!';
    const createRes = await req('POST', '/api/users', {
        token: admin.token, csrf: admin.csrf,
        body: { username: USER_B, password: USER_B_PW, displayName: 'Search B', role: 'user', balance: 50 },
    });
    if (!(createRes.body?.ok)) { console.log('FATAL create userB:', JSON.stringify(createRes.body)); process.exit(2); }
    const bFirst = await loginAs(USER_B, USER_B_PW);
    const FINAL_PW = USER_B_PW + 'X';
    if (bFirst.body?.mustChangePassword) {
        await req('PUT', `/api/users/${bFirst.body.user.id}/password`, {
            token: bFirst.token, csrf: bFirst.csrf, body: { password: FINAL_PW },
        });
    }
    const userB = await loginAs(USER_B, bFirst.body?.mustChangePassword ? FINAL_PW : USER_B_PW);
    if (!userB.token) { console.log('FATAL userB re-login'); process.exit(2); }

    // Create another user A so we can verify ownership isolation
    const USER_A    = 'smoke_search_a_' + Date.now().toString(36);
    const USER_A_PW = 'SmokeSearchA1A!';
    await req('POST', '/api/users', {
        token: admin.token, csrf: admin.csrf,
        body: { username: USER_A, password: USER_A_PW, displayName: 'Search A', role: 'user', balance: 50 },
    });
    const aFirst = await loginAs(USER_A, USER_A_PW);
    const A_FINAL = USER_A_PW + 'X';
    if (aFirst.body?.mustChangePassword) {
        await req('PUT', `/api/users/${aFirst.body.user.id}/password`, {
            token: aFirst.token, csrf: aFirst.csrf, body: { password: A_FINAL },
        });
    }
    const userA = await loginAs(USER_A, aFirst.body?.mustChangePassword ? A_FINAL : USER_A_PW);

    // ── Create sessions under userB with distinguishable titles
    const uniq = Date.now().toString(36).slice(-5);
    const mkSession = async (who, title) => {
        const r = await req('POST', '/api/chat/sessions', {
            token: who.token, csrf: who.csrf, body: { title },
        });
        return r.body?.session?.id;
    };

    const sKeyword = 'INVOICES_' + uniq;
    const s1 = await mkSession(userB, `Project ${sKeyword} notes`);
    const s2 = await mkSession(userB, 'Unrelated chat about the weather');
    const s3 = await mkSession(userB, 'Another chat');
    const sA = await mkSession(userA, `Also has ${sKeyword} — but under user A`);

    // Push a message into s3 that contains the keyword so we can hit the
    // message-content branch (EXISTS subquery) — s3's title does NOT match.
    const { Pool } = require('pg');
    const pool = new Pool({
        host: process.env.DB_HOST, port: +process.env.DB_PORT,
        database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASS,
    });
    await pushMessage(pool, s3, 'user', `Please help with ${sKeyword} reconciliation`);

    // Also test that a wildcard-looking query matches literally
    const literalTitle = 'literal_percent_' + uniq + '_%_abc';
    const sWild = await mkSession(userB, literalTitle);

    // ── [1] Empty / missing q returns full list
    console.log('[1] No filter');
    const full = await req('GET', '/api/chat/sessions', { token: userB.token });
    check('no-q ok',   full.status === 200 && full.body?.ok === true);
    const fullIds = new Set((full.body?.sessions || []).map(s => s.id));
    check('no-q includes all of B', fullIds.has(s1) && fullIds.has(s2) && fullIds.has(s3) && fullIds.has(sWild));

    // ── [2] Match by title
    console.log('\n[2] Title match');
    const byTitle = await req('GET', '/api/chat/sessions?q=' + encodeURIComponent(sKeyword.toLowerCase()), { token: userB.token });
    check('title-match ok',          byTitle.status === 200 && byTitle.body?.ok === true);
    const tIds = new Set((byTitle.body?.sessions || []).map(s => s.id));
    check('title-match hits s1',     tIds.has(s1), JSON.stringify(byTitle.body?.sessions?.map(s=>s.title)));
    check('title-match excludes s2', !tIds.has(s2));
    check('title-match hits s3 via msg body', tIds.has(s3));
    // Ownership: A's matching session must NOT appear
    check('title-match does NOT leak user A', !tIds.has(sA));

    // ── [3] No match
    console.log('\n[3] No match');
    const none = await req('GET', '/api/chat/sessions?q=' + encodeURIComponent('zzznothinghere_' + uniq), { token: userB.token });
    check('no-match ok',           none.status === 200 && none.body?.ok === true);
    check('no-match empty list',   Array.isArray(none.body?.sessions) && none.body.sessions.length === 0);

    // ── [4] ILIKE wildcards escape: searching for "%_" should match the literal title only
    console.log('\n[4] Wildcards escape literally');
    // Pattern containing % and _ — if unescaped, it would match ~everything.
    const litQ = '_%_abc';
    const lit = await req('GET', '/api/chat/sessions?q=' + encodeURIComponent(litQ), { token: userB.token });
    const litIds = new Set((lit.body?.sessions || []).map(s => s.id));
    check('wildcard-escape ok',          lit.status === 200 && lit.body?.ok === true);
    check('wildcard-escape hits sWild',  litIds.has(sWild));
    check('wildcard-escape NOT hit s2',  !litIds.has(s2), '(' + (lit.body?.sessions?.length || 0) + ' rows returned)');

    // ── [5] Case-insensitive
    console.log('\n[5] Case-insensitive');
    const ci = await req('GET', '/api/chat/sessions?q=' + encodeURIComponent(sKeyword.toUpperCase()), { token: userB.token });
    const ciIds = new Set((ci.body?.sessions || []).map(s => s.id));
    check('upper-case query still hits', ciIds.has(s1));

    // ── [6] Unauthenticated
    console.log('\n[6] Unauth');
    const anon = await req('GET', '/api/chat/sessions?q=anything');
    check('no-auth → 401', anon.status === 401);

    await pool.end().catch(() => {});

    console.log('\n=== Result ===');
    console.log(`PASS: ${pass}`);
    console.log(`FAIL: ${fail}`);
    if (fail > 0) for (const f of failures) console.log(` - ${f.name}: ${f.detail || ''}`);
    process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
