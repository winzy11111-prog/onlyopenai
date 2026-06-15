// ╔═══════════════════════════════════════════════════════════╗
// ║ Phase 11 Block B — admin-UX smoke                         ║
// ╚═══════════════════════════════════════════════════════════╝
// Assumes a running server on :3001 with admin / admin123.
//
// Covers:
//   1. /api/version (admin-only, returns migration status)
//   2. /api/version is 401 for non-admin user
//   3. Daily cap: PUT sets the value, GET status reflects it
//   4. Clearing cap by passing null
//   5. /api/cost-by-day returns contiguous day rows with correct shape
//   6. Admin users list includes daily_cap field
//
// Run:  node smoke-p11-blockB.js

'use strict';

require('dotenv').config();
const http = require('http');
const { Pool } = require('pg');

const HOST = 'localhost', PORT = 3001;
const pool = new Pool({
    host: process.env.DB_HOST, port: +process.env.DB_PORT || 5432,
    database: process.env.DB_NAME, user: process.env.DB_USER,
    password: process.env.DB_PASS,
});

function req(method, path, { body, token, csrf } = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const opts = {
            host: HOST, port: PORT, method, path,
            headers: {
                'Content-Type': 'application/json',
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
                ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
                ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
            },
        };
        const r = http.request(opts, (res) => {
            let buf = '';
            res.on('data', (c) => buf += c);
            res.on('end', () => {
                let json = null; try { json = JSON.parse(buf); } catch (_) {}
                resolve({ status: res.statusCode, body: json });
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

(async () => {
    console.log('\n=== Phase 11 Block B smoke ===\n');

    // Pre-clean
    await pool.query(`DELETE FROM tbl_audit_log WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p11b\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_credits WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p11b\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_session WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p11b\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_user WHERE username LIKE 'p11b\\_%' ESCAPE '\\'`);
    await pool.query(`UPDATE tbl_user SET failed_attempts=0, locked_until=NULL,
        must_change_password=FALSE WHERE username='admin'`);

    // Login admin
    const al = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
    if (!al.body?.ok) { console.log('FATAL admin login failed', JSON.stringify(al)); process.exit(2); }
    const adminTok  = al.body.token;
    const adminCsrf = al.body.csrfToken;

    // ── [1] /api/version ────────────────────────────────────
    console.log('[1] /api/version (admin)');
    const v = await req('GET', '/api/version', { token: adminTok });
    check('status 200',   v.status === 200);
    check('ok=true',      v.body?.ok === true);
    check('has name/version/node', !!v.body?.name && !!v.body?.version && !!v.body?.node);
    check('has migrations block', v.body?.migrations && typeof v.body.migrations.applied === 'number');
    check('zero pending migrations', v.body?.migrations?.pending === 0,
        JSON.stringify(v.body?.migrations));
    check('zero modified migrations', v.body?.migrations?.modified === 0);

    // ── [2] /api/version requires admin ─────────────────────
    console.log('\n[2] /api/version rejects non-admin');
    // create user, login, hit endpoint
    const uname = 'p11b_u_' + Date.now();
    const cu = await req('POST', '/api/users', {
        token: adminTok, csrf: adminCsrf,
        body: { username: uname, password: 'UserPass1', name: 'B', surname: 'Test', role: 'user' },
    });
    check('create user ok', cu.body?.ok, JSON.stringify(cu.body));
    const userId = cu.body.id;
    // user must first change password (Phase 8) before other endpoints work
    const ul = await req('POST', '/api/auth/login', { body: { username: uname, password: 'UserPass1' } });
    const userTok  = ul.body.token;
    const userCsrf = ul.body.csrfToken;
    await req('PUT', `/api/users/${userId}/password`, {
        token: userTok, csrf: userCsrf, body: { password: 'UserPassNew2' },
    });
    const v2 = await req('GET', '/api/version', { token: userTok });
    check('non-admin gets 403 on /api/version',
        v2.status === 403 || (v2.status === 401), `status=${v2.status}`);

    // ── [3] daily cap set/read ──────────────────────────────
    console.log('\n[3] Daily cap PUT + status');
    const setCap = await req('PUT', `/api/users/${userId}/daily-cap`, {
        token: adminTok, csrf: adminCsrf, body: { dailyCap: 12.5 },
    });
    check('PUT cap=12.5 ok', setCap.body?.ok && parseFloat(setCap.body.dailyCap) === 12.5,
        JSON.stringify(setCap.body));

    const st1 = await req('GET', `/api/users/${userId}/daily-cap-status`, { token: userTok });
    check('user can read own cap', st1.body?.ok && parseFloat(st1.body.dailyCap) === 12.5,
        JSON.stringify(st1.body));
    check('spentToday is number',  typeof st1.body?.spentToday === 'number');
    check('remaining computed',    st1.body?.remaining !== null && st1.body?.remaining !== undefined);
    check('exhausted=false (no usage yet)', st1.body?.exhausted === false);

    // list endpoint includes daily_cap
    const list = await req('GET', '/api/users', { token: adminTok });
    const found = (list.body?.users || []).find(u => u.id === userId);
    check('GET /api/users includes daily_cap', found && parseFloat(found.daily_cap) === 12.5,
        JSON.stringify(found));

    // ── [4] clear cap with null ─────────────────────────────
    console.log('\n[4] Clear cap with null');
    const clr = await req('PUT', `/api/users/${userId}/daily-cap`, {
        token: adminTok, csrf: adminCsrf, body: { dailyCap: null },
    });
    check('PUT cap=null ok', clr.body?.ok && clr.body.dailyCap === null,
        JSON.stringify(clr.body));
    const st2 = await req('GET', `/api/users/${userId}/daily-cap-status`, { token: userTok });
    check('status reflects null cap', st2.body?.ok && st2.body.dailyCap === null,
        JSON.stringify(st2.body));
    check('remaining=null when cap=null', st2.body?.remaining === null);

    // ── [5] /api/cost-by-day shape ──────────────────────────
    console.log('\n[5] /api/cost-by-day');
    const cbd = await req('GET', '/api/cost-by-day?days=7', { token: adminTok });
    check('status 200',    cbd.status === 200);
    check('ok=true',       cbd.body?.ok === true);
    check('returns 7 rows', Array.isArray(cbd.body?.rows) && cbd.body.rows.length === 7,
        `len=${cbd.body?.rows?.length}`);
    check('row shape',     cbd.body?.rows?.[0] &&
        typeof cbd.body.rows[0].date === 'string' &&
        typeof cbd.body.rows[0].cost === 'number' &&
        typeof cbd.body.rows[0].requests === 'number');
    check('total block',   cbd.body?.total &&
        typeof cbd.body.total.cost === 'number' &&
        typeof cbd.body.total.requests === 'number');

    const cbd1 = await req('GET', '/api/cost-by-day?days=1', { token: adminTok });
    check('days=1 returns 1 row', cbd1.body?.rows?.length === 1);

    const cbdUser = await req('GET', `/api/cost-by-day?days=3&userId=${userId}`, { token: adminTok });
    check('userId filter preserves shape', cbdUser.body?.ok && cbdUser.body.userId === userId,
        JSON.stringify(cbdUser.body));

    // ── [6] non-admin cannot read cost-by-day ───────────────
    console.log('\n[6] /api/cost-by-day rejects non-admin');
    const cbdNo = await req('GET', '/api/cost-by-day', { token: userTok });
    check('non-admin gets 403', cbdNo.status === 403 || cbdNo.status === 401,
        `status=${cbdNo.status}`);

    // ── Cleanup ─────────────────────────────────────────────
    await pool.query(`DELETE FROM tbl_audit_log WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p11b\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_credits WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p11b\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_session WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p11b\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_user WHERE username LIKE 'p11b\\_%' ESCAPE '\\'`);

    console.log('\n=== Result ===');
    console.log(`PASS: ${pass}`);
    console.log(`FAIL: ${fail}`);
    if (fail > 0) for (const f of failures) console.log(` - ${f.name}: ${f.detail || ''}`);
    await pool.end();
    process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => { console.error('FATAL', e); await pool.end(); process.exit(2); });
