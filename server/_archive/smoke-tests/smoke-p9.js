// ╔═══════════════════════════════════════════════════════════╗
// ║ Phase 9 — HttpOnly cookie + CSRF double-submit smoke      ║
// ╚═══════════════════════════════════════════════════════════╝
// Covers:
//   1. Login returns csrfToken in body AND Set-Cookie: petabyte_session
//   2. The cookie is HttpOnly + SameSite=Strict (+ Secure in prod)
//   3. POST with valid cookie + X-CSRF-Token header → 200
//   4. POST with valid cookie but NO X-CSRF-Token header → 403
//   5. POST with valid cookie but wrong CSRF → 403
//   6. GET (read-only) with cookie, no CSRF → 200 (CSRF guard only on writes)
//   7. Backward compat: Bearer token with X-CSRF-Token still works
//   8. Backward compat: Bearer token POST without CSRF → 403 (guard applies regardless of transport)
//   9. Logout clears cookie (Set-Cookie with maxAge=0 / expires in past)
//  10. Health + login remain exempt from CSRF

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

function req(method, path, { body, token, cookie, csrf, extraHeaders } = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const headers = {
            'Content-Type': 'application/json',
            ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
            ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
            ...(cookie ? { 'Cookie': cookie } : {}),
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
            ...(extraHeaders || {}),
        };
        const opts = { host: HOST, port: PORT, method, path, headers };
        const r = http.request(opts, (res) => {
            let buf = '';
            res.on('data', (c) => buf += c);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(buf); } catch (_) {}
                resolve({ status: res.statusCode, body: json, headers: res.headers, raw: buf });
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

function parseSetCookie(headers) {
    const sc = headers['set-cookie'] || [];
    for (const raw of sc) {
        if (raw.startsWith('petabyte_session=')) {
            const val = raw.split(';')[0].split('=')[1];
            const lower = raw.toLowerCase();
            return {
                raw,
                value: val,
                httpOnly: lower.includes('httponly'),
                sameSite: (raw.match(/samesite=([^;]+)/i) || [])[1],
                secure:   lower.includes('secure'),
                maxAge:   (raw.match(/max-age=(-?\d+)/i) || [])[1],
                expires:  (raw.match(/expires=([^;]+)/i) || [])[1],
            };
        }
    }
    return null;
}

(async () => {
    console.log('\n=== Phase 9 CSRF + cookie smoke ===\n');

    // Pre-clean — re-usable admin creds for login
    await pool.query(`UPDATE tbl_user SET failed_attempts = 0, locked_until = NULL,
        must_change_password = FALSE WHERE username = 'admin'`);

    // ────────────────────────────────────────────────────────
    // 1. Login — cookie + csrfToken
    console.log('[1] Login returns cookie + csrfToken');
    const login = await req('POST', '/api/auth/login', {
        body: { username: 'admin', password: 'admin123' },
    });
    check('login 200', login.status === 200 && login.body?.ok, `status=${login.status}`);
    check('response has token (backward compat)', !!login.body?.token);
    check('response has csrfToken (phase 9)', !!login.body?.csrfToken,
        JSON.stringify(login.body));

    const setCookie = parseSetCookie(login.headers);
    check('Set-Cookie petabyte_session present', !!setCookie,
        JSON.stringify(login.headers['set-cookie']));
    check('cookie is HttpOnly', setCookie?.httpOnly);
    check('cookie is SameSite=Strict', (setCookie?.sameSite || '').toLowerCase() === 'strict',
        `sameSite=${setCookie?.sameSite}`);
    // In dev NODE_ENV is typically not "production" so Secure should be OFF
    // (can't test secure reliably without knowing prod/dev).
    check('cookie value matches token', setCookie?.value === login.body?.token,
        `cookie=${setCookie?.value?.slice(0,8)} token=${login.body?.token?.slice(0,8)}`);

    const bearer = login.body?.token;
    const csrf   = login.body?.csrfToken;
    const cookieHdr = 'petabyte_session=' + setCookie?.value;

    // ────────────────────────────────────────────────────────
    // 2. GET with cookie only, no CSRF, no Bearer → 200 (reads exempt)
    console.log('\n[2] GET /api/projects with cookie only (no CSRF) → 200');
    const getProj = await req('GET', '/api/projects', { cookie: cookieHdr });
    check('GET with cookie only → 200', getProj.status === 200 && getProj.body?.ok,
        `status=${getProj.status}`);

    // ────────────────────────────────────────────────────────
    // 3. POST with cookie + valid CSRF → 200 (creating a user)
    console.log('\n[3] POST /api/users with cookie + valid CSRF → 200');
    const uname = 'p9_u_' + Date.now();
    const mk = await req('POST', '/api/users', {
        cookie: cookieHdr, csrf: csrf,
        body: { username: uname, password: 'Abcdefg1', name: 'P9', surname: 'Test', role: 'user' },
    });
    check('POST with cookie+csrf → 200', mk.status === 200 && mk.body?.ok,
        `status=${mk.status} body=${JSON.stringify(mk.body)}`);
    const newUserId = mk.body?.id;

    // ────────────────────────────────────────────────────────
    // 4. POST with cookie, NO CSRF → 403
    console.log('\n[4] POST /api/users with cookie but no CSRF → 403');
    const noCsrf = await req('POST', '/api/users', {
        cookie: cookieHdr,
        body: { username: 'p9_nope_' + Date.now(), password: 'Abcdefg1', name: 'X', surname: 'Y', role: 'user' },
    });
    check('POST without CSRF → 403', noCsrf.status === 403,
        `status=${noCsrf.status} body=${JSON.stringify(noCsrf.body)}`);
    check('403 body has CSRF error', (noCsrf.body?.error || '').toLowerCase().includes('csrf'),
        JSON.stringify(noCsrf.body));

    // ────────────────────────────────────────────────────────
    // 5. POST with cookie + WRONG CSRF → 403
    console.log('\n[5] POST /api/users with wrong CSRF → 403');
    const badCsrf = await req('POST', '/api/users', {
        cookie: cookieHdr, csrf: 'deadbeef'.repeat(8),
        body: { username: 'p9_bad_' + Date.now(), password: 'Abcdefg1', name: 'X', surname: 'Y', role: 'user' },
    });
    check('wrong CSRF → 403', badCsrf.status === 403,
        `status=${badCsrf.status}`);

    // ────────────────────────────────────────────────────────
    // 6. Backward compat: Bearer token + CSRF → 200
    console.log('\n[6] Bearer-only (no cookie) + CSRF → 200');
    const bearerOk = await req('GET', '/api/projects', { token: bearer });
    check('GET with Bearer only → 200', bearerOk.status === 200 && bearerOk.body?.ok,
        `status=${bearerOk.status}`);
    const bearerPost = await req('PUT', `/api/users/${newUserId}`, {
        token: bearer, csrf: csrf,
        body: { display_name: 'Renamed P9' },
    });
    check('PUT with Bearer + CSRF → 200', bearerPost.status === 200 && bearerPost.body?.ok,
        `status=${bearerPost.status} body=${JSON.stringify(bearerPost.body)}`);

    // ────────────────────────────────────────────────────────
    // 7. Bearer without CSRF → 403 (guard applies regardless of transport)
    console.log('\n[7] Bearer without CSRF on write → 403');
    const bearerNoCsrf = await req('PUT', `/api/users/${newUserId}`, {
        token: bearer,
        body: { display_name: 'Again' },
    });
    check('Bearer without CSRF → 403', bearerNoCsrf.status === 403,
        `status=${bearerNoCsrf.status}`);

    // ────────────────────────────────────────────────────────
    // 8. Login & health are CSRF-exempt
    console.log('\n[8] Exempt paths work without CSRF');
    const reLogin = await req('POST', '/api/auth/login', {
        body: { username: 'admin', password: 'admin123' },
    });
    check('login stays exempt → 200', reLogin.status === 200 && reLogin.body?.ok,
        `status=${reLogin.status}`);
    const health = await req('GET', '/api/health');
    check('health 200', health.status === 200);

    // ────────────────────────────────────────────────────────
    // 9. Logout clears cookie
    console.log('\n[9] Logout clears cookie');
    const lo = await req('POST', '/api/logout', { cookie: cookieHdr, token: bearer });
    check('logout 200', lo.status === 200, `status=${lo.status}`);
    const loSet = (lo.headers['set-cookie'] || []).find(s => s.startsWith('petabyte_session='));
    check('logout emits Set-Cookie clearing petabyte_session', !!loSet,
        JSON.stringify(lo.headers['set-cookie']));
    const cleared = loSet && (
        /expires=thu,\s*01\s*jan\s*1970/i.test(loSet) ||
        /max-age=0/i.test(loSet) ||
        /petabyte_session=;/.test(loSet)
    );
    check('cleared cookie has expired flag', !!cleared, loSet);

    // ────────────────────────────────────────────────────────
    // Cleanup
    await pool.query(`DELETE FROM tbl_audit_log WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p9\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_credits WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p9\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_session WHERE user_id IN
        (SELECT user_id FROM tbl_user WHERE username LIKE 'p9\\_%' ESCAPE '\\')`);
    await pool.query(`DELETE FROM tbl_user WHERE username LIKE 'p9\\_%' ESCAPE '\\'`);

    console.log('\n=== Result ===');
    console.log(`PASS: ${pass}`);
    console.log(`FAIL: ${fail}`);
    if (fail > 0) for (const f of failures) console.log(` - ${f.name}: ${f.detail || ''}`);
    await pool.end();
    process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => { console.error('FATAL', e); await pool.end(); process.exit(2); });
