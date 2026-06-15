// ╔═══════════════════════════════════════════════════════════╗
// ║ Phase 8 — Frontend flow smoke (no browser needed)         ║
// ╚═══════════════════════════════════════════════════════════╝
// Simulates exactly what the patched js/auth.js would do:
//   1. admin POST /api/auth/login            → token A
//   2. admin POST /api/users (new user)      → user gets must_change_password=TRUE
//   3. user POST /api/auth/login             → token B + mustChangePassword:true
//   4. user GET  /api/projects (token B)     → 423 mustChangePassword
//   5. user PUT  /api/users/:id/password     → 200, flag clears
//   6. user GET  /api/projects               → 200
//   7. user POST /api/auth/login again       → mustChangePassword:false
//   8. change-password.html is reachable as static asset
// Cleans up after itself.

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

function req(method, path, { body, token, csrf } = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const opts = {
            host: HOST, port: PORT, method, path,
            headers: {
                'Content-Type': 'application/json',
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
                ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
                ...(csrf ? { 'X-CSRF-Token': csrf } : {}),    // Phase 9
            },
        };
        const r = http.request(opts, (res) => {
            let buf = '';
            res.on('data', (c) => buf += c);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(buf); } catch (_) {}
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
    console.log('\n=== Phase 8 frontend-flow smoke ===\n');

    // Pre-clean
    await pool.query(`DELETE FROM tbl_audit_log WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p8fe\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_credits WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p8fe\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_session WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p8fe\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_user WHERE username LIKE 'p8fe\\_%' ESCAPE '\\'`);
    await pool.query(`UPDATE tbl_user SET failed_attempts = 0, locked_until = NULL,
        must_change_password = FALSE WHERE username = 'admin'`);

    // 1. admin login
    console.log('[1] Admin login');
    const al = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
    check('admin login ok', al.status === 200 && al.body?.ok && al.body?.token);
    const adminToken = al.body?.token;
    const adminCsrf  = al.body?.csrfToken;    // Phase 9

    // 2. admin creates user (must_change_password=TRUE)
    console.log('\n[2] Admin creates user');
    const username = 'p8fe_user_' + Date.now();
    const tempPw = 'AdminTemp1';
    const c = await req('POST', '/api/users', {
        token: adminToken, csrf: adminCsrf,
        body: { username, password: tempPw, name: 'FE', surname: 'Test', role: 'user' },
    });
    check('user create ok', c.status === 200 && c.body?.ok);
    const userId = c.body?.id;

    // 3. user logs in — flag is reported
    console.log('\n[3] New user login carries mustChangePassword');
    const ul = await req('POST', '/api/auth/login', { body: { username, password: tempPw } });
    check('login ok', ul.status === 200 && ul.body?.ok);
    check('mustChangePassword=true in response', ul.body?.mustChangePassword === true,
        JSON.stringify(ul.body));
    check('user.mustChangePassword=true (mirrored for convenience)',
        ul.body?.user?.mustChangePassword === true,
        JSON.stringify(ul.body?.user));
    const userToken = ul.body?.token;
    const userCsrf  = ul.body?.csrfToken;    // Phase 9

    // 4. fetching anything else returns 423
    console.log('\n[4] Other endpoints return 423');
    const proj1 = await req('GET', '/api/projects', { token: userToken });
    check('GET /api/projects → 423', proj1.status === 423,
        `status=${proj1.status} body=${JSON.stringify(proj1.body)}`);
    check('423 body has mustChangePassword=true',
        proj1.body?.mustChangePassword === true,
        JSON.stringify(proj1.body));

    const users1 = await req('GET', '/api/users', { token: userToken });
    check('GET /api/users → 423 (or 403 if non-admin)',
        users1.status === 423 || users1.status === 403,
        `status=${users1.status}`);

    // 5. self-change password works
    console.log('\n[5] Self password change');
    const newPw = 'MyNewPass2';
    const ch = await req('PUT', `/api/users/${userId}/password`, {
        token: userToken, csrf: userCsrf, body: { password: newPw },
    });
    check('PUT /password ok', ch.status === 200 && ch.body?.ok);

    // 6. now everything works
    console.log('\n[6] Normal access restored');
    const proj2 = await req('GET', '/api/projects', { token: userToken });
    check('GET /api/projects → 200', proj2.status === 200 && proj2.body?.ok,
        `status=${proj2.status}`);

    // 7. re-login no longer flags
    console.log('\n[7] Re-login is clean');
    const rl = await req('POST', '/api/auth/login', { body: { username, password: newPw } });
    check('relogin ok', rl.status === 200 && rl.body?.ok);
    check('mustChangePassword=false', rl.body?.mustChangePassword === false,
        JSON.stringify(rl.body));

    // 8. change-password.html is served
    console.log('\n[8] change-password.html is reachable');
    const html = await req('GET', '/change-password.html');
    check('change-password.html served', html.status === 200);

    // Cleanup
    await pool.query(`DELETE FROM tbl_audit_log WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p8fe\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_credits WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p8fe\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_session WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p8fe\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_user WHERE username LIKE 'p8fe\\_%' ESCAPE '\\'`);

    console.log('\n=== Result ===');
    console.log(`PASS: ${pass}`);
    console.log(`FAIL: ${fail}`);
    if (fail > 0) for (const f of failures) console.log(` - ${f.name}: ${f.detail || ''}`);
    await pool.end();
    process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => { console.error('FATAL', e); await pool.end(); process.exit(2); });
