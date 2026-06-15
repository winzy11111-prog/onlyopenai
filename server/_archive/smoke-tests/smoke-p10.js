// ╔═══════════════════════════════════════════════════════════╗
// ║ Phase 10 — Input validation + CSP smoke                   ║
// ╚═══════════════════════════════════════════════════════════╝
// Covers:
//   A. CSP header is present and locked down
//      - object-src 'none'
//      - frame-ancestors 'none'
//      - base-uri 'self'
//      - form-action 'self'
//   B. Login schema
//      - missing username → 400
//      - oversize username (>64) → 400
//      - non-string username → 400
//      - valid → 200 (backward compat)
//   C. Create-user schema
//      - missing password → 400
//      - invalid role ('superadmin') → 400
//      - negative balance → 400
//      - mass-assignment: extra field `is_deleted:true` is silently stripped
//        and the row shows is_deleted=false in DB
//   D. Update-user schema
//      - role:'superadmin' → 400
//      - balance: -1 → 400
//   E. Top-up schema
//      - amount: -5 → 400
//      - amount: 0 → 400 (strict >0)
//      - amount: 100 → 200
//   F. Password strength still enforced (belt & suspenders)
//      - password 'short' → 400 (length) before zod, or after strength check

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

function req(method, path, { body, token, csrf, cookie } = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const headers = {
            'Content-Type': 'application/json',
            ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
            ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
            ...(cookie ? { 'Cookie': cookie } : {}),
        };
        const opts = { host: HOST, port: PORT, method, path, headers };
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

let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else      { fail++; failures.push({ name, detail }); console.log(`  FAIL  ${name}  ${detail || ''}`); }
}

(async () => {
    console.log('\n=== Phase 10 validation + CSP smoke ===\n');

    // Pre-clean
    await pool.query(`DELETE FROM tbl_audit_log WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p10\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_credits WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p10\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_session WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p10\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_user WHERE username LIKE 'p10\\_%' ESCAPE '\\'`);
    await pool.query(`UPDATE tbl_user SET failed_attempts=0, locked_until=NULL,
        must_change_password=FALSE WHERE username='admin'`);

    // ────────────────────────────────────────────────────────
    // A. CSP header check (use /api/health — any response has CSP)
    console.log('[A] CSP header is locked down');
    const h = await req('GET', '/api/health');
    const csp = h.headers['content-security-policy'] || '';
    check('CSP header present', csp.length > 0, `csp="${csp.slice(0,80)}..."`);
    check("CSP has object-src 'none'", /object-src\s+'none'/i.test(csp), csp);
    check("CSP has frame-ancestors 'none'", /frame-ancestors\s+'none'/i.test(csp), csp);
    check("CSP has base-uri 'self'", /base-uri\s+'self'/i.test(csp), csp);
    check("CSP has form-action 'self'", /form-action\s+'self'/i.test(csp), csp);
    check("CSP has default-src 'self'", /default-src\s+'self'/i.test(csp), csp);

    // ────────────────────────────────────────────────────────
    // B. Login schema
    console.log('\n[B] Login schema');
    const b1 = await req('POST', '/api/auth/login', { body: {} });
    check('missing username → 400', b1.status === 400, `status=${b1.status}`);
    const b2 = await req('POST', '/api/auth/login',
        { body: { username: 'x'.repeat(100), password: 'whatever' } });
    check('oversize username → 400', b2.status === 400, `status=${b2.status}`);
    const b3 = await req('POST', '/api/auth/login',
        { body: { username: 12345, password: 'whatever' } });
    check('non-string username → 400', b3.status === 400, `status=${b3.status}`);
    // Valid login still works (backward compat)
    const bOk = await req('POST', '/api/auth/login',
        { body: { username: 'admin', password: 'admin123' } });
    check('valid login → 200', bOk.status === 200 && bOk.body?.ok, `status=${bOk.status}`);
    const adminToken = bOk.body?.token;
    const adminCsrf  = bOk.body?.csrfToken;

    // ────────────────────────────────────────────────────────
    // C. Create-user schema
    console.log('\n[C] Create-user schema + mass-assignment guard');
    const c1 = await req('POST', '/api/users', {
        token: adminToken, csrf: adminCsrf,
        body: { username: 'p10_a_' + Date.now() },                    // no password
    });
    check('missing password → 400', c1.status === 400,
        `status=${c1.status} body=${JSON.stringify(c1.body)}`);

    const c2 = await req('POST', '/api/users', {
        token: adminToken, csrf: adminCsrf,
        body: { username: 'p10_b_' + Date.now(), password: 'Abcdefg1', role: 'superadmin' },
    });
    check('invalid role → 400', c2.status === 400, `status=${c2.status}`);

    const c3 = await req('POST', '/api/users', {
        token: adminToken, csrf: adminCsrf,
        body: { username: 'p10_c_' + Date.now(), password: 'Abcdefg1', balance: -1 },
    });
    check('negative balance → 400', c3.status === 400, `status=${c3.status}`);

    // Mass-assignment: sender tries to smuggle is_deleted=true. Schema strips
    // unknown fields so the row must be created with is_deleted=FALSE.
    const unameMass = 'p10_mass_' + Date.now();
    const cMass = await req('POST', '/api/users', {
        token: adminToken, csrf: adminCsrf,
        body: {
            username: unameMass, password: 'Abcdefg1', role: 'user',
            is_deleted: true, admin_api_key: 'pwned', role_id: 1,    // ← all stripped
        },
    });
    check('mass-assignment call succeeds', cMass.status === 200 && cMass.body?.ok,
        `status=${cMass.status} body=${JSON.stringify(cMass.body)}`);
    const chk = await pool.query(
        `SELECT is_deleted, role_id FROM tbl_user WHERE username=$1`, [unameMass]);
    check('but is_deleted stayed FALSE (strip worked)',
        chk.rows[0]?.is_deleted === false,
        JSON.stringify(chk.rows[0]));
    check('and role_id came from role enum (=2 for "user"), not smuggled value',
        chk.rows[0]?.role_id === 2, JSON.stringify(chk.rows[0]));

    // ────────────────────────────────────────────────────────
    // D. Update-user schema
    console.log('\n[D] Update-user schema');
    const userId = cMass.body?.id;
    const d1 = await req('PUT', `/api/users/${userId}`, {
        token: adminToken, csrf: adminCsrf,
        body: { role: 'superadmin' },
    });
    check('update role=superadmin → 400', d1.status === 400, `status=${d1.status}`);

    const d2 = await req('PUT', `/api/users/${userId}`, {
        token: adminToken, csrf: adminCsrf,
        body: { balance: -5 },
    });
    check('update balance=-5 → 400', d2.status === 400, `status=${d2.status}`);

    // ────────────────────────────────────────────────────────
    // E. Top-up schema
    console.log('\n[E] Project top-up schema');
    // Find a real project
    const anyProj = await pool.query(
        'SELECT project_id FROM tbl_project WHERE is_deleted=FALSE LIMIT 1');
    const pid = anyProj.rows[0]?.project_id;

    const e1 = await req('PUT', `/api/projects/${pid}/topup`, {
        token: adminToken, csrf: adminCsrf, body: { amount: -5 },
    });
    check('top-up amount=-5 → 400', e1.status === 400, `status=${e1.status}`);

    const e2 = await req('PUT', `/api/projects/${pid}/topup`, {
        token: adminToken, csrf: adminCsrf, body: { amount: 0 },
    });
    check('top-up amount=0 → 400 (strict > 0)', e2.status === 400, `status=${e2.status}`);

    const e3 = await req('PUT', `/api/projects/${pid}/topup`, {
        token: adminToken, csrf: adminCsrf, body: { amount: 100 },
    });
    check('top-up amount=100 → 200', e3.status === 200 && e3.body?.ok,
        `status=${e3.status} body=${JSON.stringify(e3.body)}`);
    // reverse the top-up so we don't skew the project balance
    if (e3.status === 200) {
        await pool.query(
            `UPDATE tbl_balance SET project_credits = project_credits - 100 WHERE project_id=$1`,
            [pid]);
    }

    // ────────────────────────────────────────────────────────
    // F. Weak password still blocked (zod allows length-1, strength blocks <8)
    console.log('\n[F] Weak password rejected by strength check');
    const f1 = await req('POST', '/api/users', {
        token: adminToken, csrf: adminCsrf,
        body: { username: 'p10_weak_' + Date.now(), password: 'abc' },
    });
    check('weak password → 400', f1.status === 400,
        `status=${f1.status} body=${JSON.stringify(f1.body)}`);

    // ────────────────────────────────────────────────────────
    // Cleanup
    await pool.query(`DELETE FROM tbl_audit_log WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p10\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_credits WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p10\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_session WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p10\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_user WHERE username LIKE 'p10\\_%' ESCAPE '\\'`);

    console.log('\n=== Result ===');
    console.log(`PASS: ${pass}`);
    console.log(`FAIL: ${fail}`);
    if (fail > 0) for (const f of failures) console.log(` - ${f.name}: ${f.detail || ''}`);
    await pool.end();
    process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => { console.error('FATAL', e); await pool.end(); process.exit(2); });
