// ╔═══════════════════════════════════════════════════════════╗
// ║ Phase 12 — Chat sessions smoke                            ║
// ╚═══════════════════════════════════════════════════════════╝
// Assumes a running server on :3001.
//
// Covers:
//   1. Create / list / get / rename / export / soft-delete — happy path
//   2. IDOR guard: user B cannot read/rename/delete user A's session
//   3. Soft-deleted session becomes 404 and drops off the list
//   4. Invalid id / other user's id return 404 (don't leak existence)
//   5. CSRF required for state-changing endpoints (POST/PATCH/DELETE)
//   6. Legacy /api/sessions routes are gone (404)
//   7. Export returns a markdown body with the expected title
//
// Run:  node smoke-p12-sessions.js

'use strict';

require('dotenv').config();
const http = require('http');
const { Pool } = require('pg');

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
                resolve({ status: res.statusCode, body: json, raw: buf, headers: res.headers });
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

async function loginAs(username, password) {
    const r = await req('POST', '/api/auth/login', { body: { username, password } });
    return { token: r.body?.token, csrf: r.body?.csrfToken, body: r.body };
}

(async () => {
    console.log('\n=== Phase 12 sessions smoke ===\n');

    // ── prep: admin login ───────────────────────────────────
    const admin = await loginAs('admin', 'admin123');
    if (!admin.token) { console.log('FATAL admin login failed'); process.exit(2); }

    // Create a unique test user per run so we don't collide with a prior
    // run's password state (mustChangePassword flow rotates the secret).
    const USER_B    = 'smoke_p12_b_' + Date.now().toString(36);
    const USER_B_PW = 'SmokeTestB1A!';
    const createRes = await req('POST', '/api/users', {
        token: admin.token, csrf: admin.csrf,
        body: {
            username: USER_B, password: USER_B_PW,
            displayName: 'Smoke User B', role: 'user', balance: 100,
        },
    });
    if (!(createRes.body?.ok)) {
        console.log('FATAL create userB failed:', JSON.stringify(createRes.body));
        process.exit(2);
    }
    // New admin-created users land with mustChangePassword=true. We rotate
    // to a final password so the subsequent test endpoints don't 423.
    const bFirst = await loginAs(USER_B, USER_B_PW);
    if (!bFirst.token) { console.log('FATAL userB initial login failed'); process.exit(2); }
    const FINAL_PW = USER_B_PW + 'X';
    if (bFirst.body?.mustChangePassword) {
        const chg = await req('PUT', `/api/users/${bFirst.body.user.id}/password`, {
            token: bFirst.token, csrf: bFirst.csrf,
            body: { password: FINAL_PW },
        });
        if (!(chg.body?.ok)) { console.log('FATAL userB password change failed', JSON.stringify(chg.body)); process.exit(2); }
    }
    const userB = await loginAs(USER_B, bFirst.body?.mustChangePassword ? FINAL_PW : USER_B_PW);
    if (!userB.token) { console.log('FATAL userB re-login failed'); process.exit(2); }

    // ── [1] CRUD happy path as userB ─────────────────────────
    console.log('[1] CRUD happy path');
    const list0 = await req('GET', '/api/chat/sessions', { token: userB.token });
    check('list own sessions ok',  list0.status === 200 && list0.body?.ok === true);
    const initialCount = list0.body?.sessions?.length || 0;

    const cre = await req('POST', '/api/chat/sessions', {
        token: userB.token, csrf: userB.csrf, body: { title: 'Smoke chat' },
    });
    check('create 200',       cre.status === 200 && cre.body?.ok === true);
    check('create returns id', cre.body?.session?.id > 0, JSON.stringify(cre.body));
    const sidB = cre.body?.session?.id;

    const get1 = await req('GET', '/api/chat/sessions/' + sidB, { token: userB.token });
    check('get own session',          get1.status === 200 && get1.body?.ok);
    check('get has session object',   get1.body?.session?.title === 'Smoke chat');
    check('get has messages[] (empty)', Array.isArray(get1.body?.messages) && get1.body.messages.length === 0);

    const listAfter = await req('GET', '/api/chat/sessions', { token: userB.token });
    check('list grew by 1', (listAfter.body?.sessions?.length || 0) === initialCount + 1);

    const pat = await req('PATCH', '/api/chat/sessions/' + sidB, {
        token: userB.token, csrf: userB.csrf, body: { title: 'Renamed title' },
    });
    check('rename ok',  pat.status === 200 && pat.body?.ok === true);
    const get2 = await req('GET', '/api/chat/sessions/' + sidB, { token: userB.token });
    check('rename persisted', get2.body?.session?.title === 'Renamed title');

    // ── [2] IDOR: admin cannot access userB's session ────────
    console.log('\n[2] IDOR guard');
    const foreign = await req('GET', '/api/chat/sessions/' + sidB, { token: admin.token });
    check('admin GET userB session → 404',    foreign.status === 404);
    const foreignPatch = await req('PATCH', '/api/chat/sessions/' + sidB, {
        token: admin.token, csrf: admin.csrf, body: { title: 'PWNED' },
    });
    check('admin PATCH userB session → 404',  foreignPatch.status === 404);
    const foreignDel = await req('DELETE', '/api/chat/sessions/' + sidB, {
        token: admin.token, csrf: admin.csrf,
    });
    check('admin DELETE userB session → 404', foreignDel.status === 404);
    // Confirm it's still alive and owned by B
    const stillThere = await req('GET', '/api/chat/sessions/' + sidB, { token: userB.token });
    check('userB can still read after IDOR attempt', stillThere.status === 200);
    check('title was NOT overwritten by admin',      stillThere.body?.session?.title === 'Renamed title');

    // ── [3] Non-existent id → 404 ───────────────────────────
    const nope = await req('GET', '/api/chat/sessions/999999999', { token: userB.token });
    check('non-existent id → 404', nope.status === 404);
    const bad = await req('GET', '/api/chat/sessions/abc',    { token: userB.token });
    check('non-numeric id → 400',  bad.status === 400);

    // ── [4] CSRF required on POST/PATCH/DELETE ──────────────
    console.log('\n[4] CSRF guard');
    const noCsrfPost = await req('POST', '/api/chat/sessions', {
        token: userB.token, body: { title: 'no csrf' },  // no csrf
    });
    check('POST without CSRF → 403', noCsrfPost.status === 403);
    const noCsrfPatch = await req('PATCH', '/api/chat/sessions/' + sidB, {
        token: userB.token, body: { title: 'x' },
    });
    check('PATCH without CSRF → 403', noCsrfPatch.status === 403);
    const noCsrfDel = await req('DELETE', '/api/chat/sessions/' + sidB, {
        token: userB.token,
    });
    check('DELETE without CSRF → 403', noCsrfDel.status === 403);

    // ── [5] Export → markdown ───────────────────────────────
    console.log('\n[5] Export');
    const exp = await req('GET', '/api/chat/sessions/' + sidB + '/export', { token: userB.token });
    check('export 200',                   exp.status === 200);
    check('export content-type markdown', (exp.headers['content-type'] || '').includes('text/markdown'));
    check('export body starts with # title', exp.raw.startsWith('# Renamed title'));
    const foreignExp = await req('GET', '/api/chat/sessions/' + sidB + '/export', { token: admin.token });
    check('export IDOR → 404',            foreignExp.status === 404);

    // ── [6] Soft delete ─────────────────────────────────────
    console.log('\n[6] Soft delete');
    const del = await req('DELETE', '/api/chat/sessions/' + sidB, {
        token: userB.token, csrf: userB.csrf,
    });
    check('delete 200', del.status === 200 && del.body?.ok === true);
    const getAfter = await req('GET', '/api/chat/sessions/' + sidB, { token: userB.token });
    check('get after delete → 404', getAfter.status === 404);
    const listAfterDel = await req('GET', '/api/chat/sessions', { token: userB.token });
    const idsAfter = (listAfterDel.body?.sessions || []).map(s => s.id);
    check('list no longer contains deleted id', !idsAfter.includes(sidB));

    // Verify row is soft-deleted, not physically removed
    const pool = new Pool({
        host: process.env.DB_HOST, port: +process.env.DB_PORT,
        database: process.env.DB_NAME, user: process.env.DB_USER,
        password: process.env.DB_PASS,
    });
    try {
        const row = await pool.query(
            'SELECT is_deleted FROM tbl_chat_session WHERE session_id=$1',
            [sidB]);
        check('row still in DB', row.rows.length === 1);
        check('is_deleted=TRUE',  row.rows[0]?.is_deleted === true);
    } finally { await pool.end().catch(() => {}); }

    // ── [7] Legacy routes are gone ──────────────────────────
    console.log('\n[7] Legacy /api/sessions routes removed');
    const legacyList = await req('GET', '/api/sessions?userId=2', { token: userB.token });
    check('legacy GET /api/sessions → 404', legacyList.status === 404);

    // ── [8] Unauthenticated access ─────────────────────────
    console.log('\n[8] Unauthenticated');
    const anon = await req('GET', '/api/chat/sessions');
    check('no auth → 401', anon.status === 401);

    console.log('\n=== Result ===');
    console.log(`PASS: ${pass}`);
    console.log(`FAIL: ${fail}`);
    if (fail > 0) for (const f of failures) console.log(` - ${f.name}: ${f.detail || ''}`);
    process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
