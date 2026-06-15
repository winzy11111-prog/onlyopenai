// ╔═══════════════════════════════════════════════════════════╗
// ║ Phase 8 Smoke — account lockout + first-login pw change   ║
// ╚═══════════════════════════════════════════════════════════╝
// Run with: node smoke-p8.js
// Expects the server running on http://localhost:3001 with the
// Phase 8 migration applied + Phase 8 server code restarted.
//
// Each test cleans up after itself in the DB to keep the run idempotent.

require('dotenv').config();
const http = require('http');
const { Pool } = require('pg');

const HOST = 'localhost', PORT = 3001;
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'petabyte_ai',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || '',
});

let pass = 0, fail = 0;
const failures = [];

function req(method, path, { body, token } = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const opts = {
            host: HOST, port: PORT, method, path,
            headers: {
                'Content-Type': 'application/json',
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
                ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
            },
        };
        const r = http.request(opts, (res) => {
            let buf = '';
            res.on('data', (c) => buf += c);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(buf); } catch (_) {}
                resolve({ status: res.statusCode, body: json, headers: res.headers });
            });
        });
        r.on('error', (e) => resolve({ status: 0, error: e.message }));
        if (data) r.write(data);
        r.end();
    });
}
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else      { fail++; failures.push({ name, detail }); console.log(`  FAIL  ${name}  ${detail || ''}`); }
}

(async function main() {
    console.log('\n=== Phase 8 smoke ===\n');

    // ── Pre-flight: clean any leftover test users from prior runs (FK order)
    await pool.query(`DELETE FROM tbl_audit_log WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p8\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_credits WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p8\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_session WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p8\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_user WHERE username LIKE 'p8\\_%' ESCAPE '\\'`);

    // Reset built-in admin/user lockout state (safe: only resets counters)
    await pool.query(`UPDATE tbl_user SET failed_attempts = 0, locked_until = NULL,
        must_change_password = FALSE WHERE username IN ('admin','user')`);

    // ── 1. Server alive
    console.log('[1] Health');
    const h = await req('GET', '/api/health');
    check('GET /api/health → 200', h.status === 200);

    // ── 2. Admin login (sanity)
    console.log('\n[2] Admin login');
    const al = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
    check('admin login ok', al.status === 200 && al.body?.ok && al.body?.token, JSON.stringify(al.body));
    const adminToken = al.body?.token;

    // ── 3. Create a Phase-8 test user (admin password) → must_change_password=TRUE
    console.log('\n[3] Admin-created user gets must_change_password=TRUE');
    const username = 'p8_user_' + Date.now();
    const tempPw = 'TempPass1';
    const newPw  = 'NewStrong9';
    const create = await req('POST', '/api/users', {
        token: adminToken,
        body: { username, password: tempPw, name: 'P8', surname: 'Tester', role: 'user' },
    });
    check('user create ok', create.status === 200 && create.body?.ok, JSON.stringify(create.body));
    const userId = create.body?.id;

    // Verify DB flag
    const dbRow = await pool.query('SELECT must_change_password FROM tbl_user WHERE user_id=$1', [userId]);
    check('DB must_change_password = TRUE on create',
        dbRow.rows[0]?.must_change_password === true,
        JSON.stringify(dbRow.rows[0]));

    // ── 4. New user logs in — server must signal mustChangePassword
    console.log('\n[4] Login signals mustChangePassword');
    const ul = await req('POST', '/api/auth/login', { body: { username, password: tempPw } });
    check('login ok with temp pw',
        ul.status === 200 && ul.body?.ok,
        JSON.stringify(ul.body));
    check('login response carries mustChangePassword=true',
        ul.body?.mustChangePassword === true,
        JSON.stringify(ul.body));
    const userToken = ul.body?.token;

    // ── 5. Most endpoints are blocked with 423 until password is changed
    console.log('\n[5] Other endpoints return 423 while flagged');
    const blocked = await req('GET', '/api/projects', { token: userToken });
    check('GET /api/projects → 423 mustChangePassword',
        blocked.status === 423 && blocked.body?.mustChangePassword === true,
        `status=${blocked.status} body=${JSON.stringify(blocked.body)}`);

    // ── 6. PUT /api/users/:id/password IS allowed (the only escape hatch)
    console.log('\n[6] Self password change clears the flag');
    const pwChange = await req('PUT', `/api/users/${userId}/password`, {
        token: userToken,
        body: { password: newPw },
    });
    check('PUT /password ok',
        pwChange.status === 200 && pwChange.body?.ok,
        JSON.stringify(pwChange.body));

    const dbRow2 = await pool.query('SELECT must_change_password FROM tbl_user WHERE user_id=$1', [userId]);
    check('DB must_change_password = FALSE after self-change',
        dbRow2.rows[0]?.must_change_password === false,
        JSON.stringify(dbRow2.rows[0]));

    // ── 7. After flag cleared, normal endpoints work again
    console.log('\n[7] Normal access restored');
    const proj = await req('GET', '/api/projects', { token: userToken });
    check('GET /api/projects → 200 after flag cleared',
        proj.status === 200 && proj.body?.ok,
        `status=${proj.status} body=${JSON.stringify(proj.body)}`);

    // ── 8. Login with the new password — flag must NOT come back
    console.log('\n[8] Re-login after self pw change');
    const reLogin = await req('POST', '/api/auth/login', { body: { username, password: newPw } });
    check('relogin ok with new pw',
        reLogin.status === 200 && reLogin.body?.ok,
        JSON.stringify(reLogin.body));
    check('relogin mustChangePassword = false',
        reLogin.body?.mustChangePassword === false,
        JSON.stringify(reLogin.body));

    // ── 9. Account lockout — 5 wrong then locked
    console.log('\n[9] Account lockout after 5 failed attempts');
    // Make a fresh user so the in-memory rate-limit (per IP+username)
    // doesn't trip first and mask the lockout signal.
    const lockUser = 'p8_lock_' + Date.now();
    const lockPw   = 'GoodPass1';
    await req('POST', '/api/users', {
        token: adminToken,
        body: { username: lockUser, password: lockPw, name: 'L', surname: 'K', role: 'user' },
    });
    // Clear the must_change_password so login flow reaches lockout logic
    await pool.query('UPDATE tbl_user SET must_change_password = FALSE WHERE username = $1', [lockUser]);

    let sawLock = false, lockHitAt = 0;
    for (let i = 1; i <= 6; i++) {
        const r = await req('POST', '/api/auth/login', { body: { username: lockUser, password: 'wrongPass1' } });
        if (r.status === 423 && r.body?.locked) { sawLock = true; lockHitAt = i; break; }
    }
    check(`lockout triggers (got 423/locked at attempt ${lockHitAt})`,
        sawLock && lockHitAt === 5,    // 5th wrong attempt should be the lock
        `sawLock=${sawLock} attempt=${lockHitAt}`);

    // ── 10. Even with correct password, locked account refuses
    console.log('\n[10] Locked account rejects correct password');
    const correctWhileLocked = await req('POST', '/api/auth/login',
        { body: { username: lockUser, password: lockPw } });
    check('correct pw rejected while locked',
        correctWhileLocked.status === 423 && correctWhileLocked.body?.locked,
        `status=${correctWhileLocked.status} body=${JSON.stringify(correctWhileLocked.body)}`);

    // ── 11. Manually unlock and verify success login resets counters
    console.log('\n[11] Unlock + successful login resets counters');
    await pool.query(`UPDATE tbl_user SET locked_until = NULL, failed_attempts = 0
                      WHERE username = $1`, [lockUser]);
    const goodLogin = await req('POST', '/api/auth/login',
        { body: { username: lockUser, password: lockPw } });
    check('login ok after unlock',
        goodLogin.status === 200 && goodLogin.body?.ok,
        JSON.stringify(goodLogin.body));
    const dbRow3 = await pool.query(
        `SELECT failed_attempts, locked_until FROM tbl_user WHERE username=$1`, [lockUser]);
    check('failed_attempts reset to 0',
        dbRow3.rows[0]?.failed_attempts === 0,
        JSON.stringify(dbRow3.rows[0]));

    // ── 12. PUT /users/:id by admin with password sets must_change_password=TRUE
    console.log('\n[12] Admin password reset re-arms must_change_password');
    const adminReset = await req('PUT', `/api/users/${userId}`, {
        token: adminToken,
        body: { displayName: 'P8 Tester', role: 'user', password: 'AdminReset1' },
    });
    check('admin PUT ok', adminReset.status === 200 && adminReset.body?.ok, JSON.stringify(adminReset.body));
    const dbRow4 = await pool.query('SELECT must_change_password FROM tbl_user WHERE user_id=$1', [userId]);
    check('must_change_password re-armed by admin reset',
        dbRow4.rows[0]?.must_change_password === true,
        JSON.stringify(dbRow4.rows[0]));

    // ── 13. Cleanup & summary (FK order: audit_log → credits → session → user)
    await pool.query(`DELETE FROM tbl_audit_log WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p8\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_credits WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p8\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_session WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p8\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_user WHERE username LIKE 'p8\\_%' ESCAPE '\\'`);

    console.log('\n=== Result ===');
    console.log(`PASS: ${pass}`);
    console.log(`FAIL: ${fail}`);
    if (fail > 0) {
        console.log('\nFailures:');
        for (const f of failures) console.log(` - ${f.name}: ${f.detail || ''}`);
    }
    await pool.end();
    process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
    console.error('FATAL', e);
    await pool.end();
    process.exit(2);
});
