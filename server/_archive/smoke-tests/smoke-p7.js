// ╔═══════════════════════════════════════════════════════════╗
// ║ Phase 7 Smoke — auth hardening                            ║
// ╚═══════════════════════════════════════════════════════════╝
// Run with: node smoke-p7.js
// Requires the server to be running on http://localhost:3001
// Uses only the built-in http module — no extra deps.

const http = require('http');

const HOST = 'localhost';
const PORT = 3001;

let pass = 0, fail = 0;
const failures = [];

function req(method, path, { body, token, headers } = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const opts = {
            host: HOST, port: PORT, method, path,
            headers: {
                'Content-Type': 'application/json',
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
                ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
                ...(headers || {}),
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

function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else      { fail++; failures.push({ name, detail }); console.log(`  FAIL  ${name}  ${detail || ''}`); }
}

(async function main() {
    console.log('\n=== Phase 7 smoke test ===\n');

    // ── 1. Server alive
    console.log('[1] Server health');
    const h = await req('GET', '/api/health');
    check('GET /api/health → 200', h.status === 200, `status=${h.status}`);

    // ── 2. Login as admin (sanity)
    console.log('\n[2] Admin login (sanity)');
    const adminLogin = await req('POST', '/api/auth/login', {
        body: { username: 'admin', password: 'admin123' }
    });
    check('admin login ok',
        adminLogin.status === 200 && adminLogin.body?.ok && adminLogin.body?.token,
        JSON.stringify(adminLogin.body));
    const adminToken = adminLogin.body?.token;

    // ── 3. Login as user (sanity)
    console.log('\n[3] User login (sanity)');
    const userLogin = await req('POST', '/api/auth/login', {
        body: { username: 'user', password: 'user123' }
    });
    check('user login ok',
        userLogin.status === 200 && userLogin.body?.ok && userLogin.body?.token,
        JSON.stringify(userLogin.body));
    const userToken = userLogin.body?.token;

    // ── 4. Session is in DB (token works on a requireAuth endpoint)
    console.log('\n[4] Session backed by DB');
    const me = await req('GET', '/api/projects', { token: userToken });
    check('GET /api/projects with token → ok',
        me.status === 200 && me.body?.ok,
        JSON.stringify(me.body));

    // ── 5. Weak password rejected on POST /api/users
    console.log('\n[5] Password policy on create');
    const weak = await req('POST', '/api/users', {
        token: adminToken,
        body: { username: 'p7_weak_' + Date.now(), password: 'short', name: 'X', surname: 'Y' }
    });
    check('weak password (5 chars) rejected',
        weak.status === 200 && weak.body?.ok === false && /password/i.test(weak.body?.error || ''),
        JSON.stringify(weak.body));

    const noDigit = await req('POST', '/api/users', {
        token: adminToken,
        body: { username: 'p7_nodigit_' + Date.now(), password: 'abcdefgh', name: 'X', surname: 'Y' }
    });
    check('letter-only password rejected',
        noDigit.status === 200 && noDigit.body?.ok === false && /digit/i.test(noDigit.body?.error || ''),
        JSON.stringify(noDigit.body));

    const noLetter = await req('POST', '/api/users', {
        token: adminToken,
        body: { username: 'p7_noletter_' + Date.now(), password: '12345678', name: 'X', surname: 'Y' }
    });
    check('digit-only password rejected',
        noLetter.status === 200 && noLetter.body?.ok === false && /letter/i.test(noLetter.body?.error || ''),
        JSON.stringify(noLetter.body));

    // ── 6. Strong password accepted (creates a victim user)
    console.log('\n[6] Strong password accepted + soft-delete flow');
    const victimUsername = 'p7_victim_' + Date.now();
    const create = await req('POST', '/api/users', {
        token: adminToken,
        body: { username: victimUsername, password: 'GoodPass1', name: 'Vic', surname: 'Tim', role: 'user' }
    });
    check('create with GoodPass1 succeeds',
        create.status === 200 && create.body?.ok,
        JSON.stringify(create.body));
    const victimId = create.body?.id;

    // 6b. Victim can log in
    const victimLogin1 = await req('POST', '/api/auth/login', {
        body: { username: victimUsername, password: 'GoodPass1' }
    });
    check('victim login (before delete) ok',
        victimLogin1.status === 200 && victimLogin1.body?.ok && victimLogin1.body?.token,
        JSON.stringify(victimLogin1.body));
    const victimToken = victimLogin1.body?.token;

    // 6c. Soft-delete the victim
    const del = await req('DELETE', '/api/users/' + victimId, { token: adminToken });
    check('admin DELETE victim → ok',
        del.status === 200 && del.body?.ok,
        JSON.stringify(del.body));

    // 6d. Victim's existing token is now revoked
    const meAfterDel = await req('GET', '/api/projects', { token: victimToken });
    check('victim token invalidated after delete',
        meAfterDel.status === 401,
        `status=${meAfterDel.status} body=${JSON.stringify(meAfterDel.body)}`);

    // 6e. Victim cannot log in again (now 401 after Phase 7 status fix)
    const victimLogin2 = await req('POST', '/api/auth/login', {
        body: { username: victimUsername, password: 'GoodPass1' }
    });
    check('soft-deleted user cannot log in',
        victimLogin2.status === 401 && victimLogin2.body?.ok === false,
        JSON.stringify(victimLogin2.body));

    // 6f. Victim no longer in GET /api/users
    const list = await req('GET', '/api/users', { token: adminToken });
    const stillThere = list.body?.users?.some(u => u.id === victimId);
    check('soft-deleted user hidden from GET /api/users',
        list.status === 200 && !stillThere,
        `stillThere=${stillThere}`);

    // ── 7. Admin cannot delete self
    console.log('\n[7] Admin self-delete guard');
    const adminId = adminLogin.body?.user?.id;
    const selfDel = await req('DELETE', '/api/users/' + adminId, { token: adminToken });
    check('admin self-delete blocked',
        selfDel.status === 200 && selfDel.body?.ok === false,
        JSON.stringify(selfDel.body));

    // ── 8. Logout deletes the session row
    console.log('\n[8] Logout invalidates token');
    const lo = await req('POST', '/api/logout', { token: userToken });
    check('logout returns ok',
        lo.status === 200 && lo.body?.ok,
        JSON.stringify(lo.body));
    const meAfterLogout = await req('GET', '/api/projects', { token: userToken });
    check('token rejected after logout',
        meAfterLogout.status === 401,
        `status=${meAfterLogout.status}`);

    // ── 9. Login rate-limit (11 bad attempts → 429 on attempt 11)
    console.log('\n[9] Login rate limit (10 / 15min per user+ip)');
    const targetUser = 'p7_rl_' + Date.now();
    let limited = false, attempts = 0;
    for (let i = 1; i <= 12; i++) {
        attempts = i;
        const r = await req('POST', '/api/auth/login', {
            body: { username: targetUser, password: 'badbadbad' }
        });
        if (r.status === 429) { limited = true; break; }
    }
    check(`rate limit triggers within 12 attempts (got at #${attempts})`,
        limited,
        `attempts=${attempts}`);

    // ── 10. Helmet headers present
    console.log('\n[10] Helmet headers');
    const helm = await req('GET', '/api/health');
    // We can't read headers from req() above — re-issue raw
    const helmHeaders = await new Promise((resolve) => {
        const r = http.request({ host: HOST, port: PORT, method: 'GET', path: '/api/health' },
            (res) => { res.resume(); resolve(res.headers); });
        r.on('error', () => resolve({}));
        r.end();
    });
    check('X-DNS-Prefetch-Control header set',
        !!helmHeaders['x-dns-prefetch-control'],
        JSON.stringify(helmHeaders));
    check('X-Content-Type-Options: nosniff',
        helmHeaders['x-content-type-options'] === 'nosniff',
        helmHeaders['x-content-type-options']);

    // ── Summary
    console.log('\n=== Result ===');
    console.log(`PASS: ${pass}`);
    console.log(`FAIL: ${fail}`);
    if (fail > 0) {
        console.log('\nFailures:');
        for (const f of failures) console.log(` - ${f.name}: ${f.detail || ''}`);
    }
    process.exit(fail === 0 ? 0 : 1);
})();
