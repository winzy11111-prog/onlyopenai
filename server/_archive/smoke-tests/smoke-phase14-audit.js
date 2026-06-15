// ╔═══════════════════════════════════════════════════════════╗
// ║ Phase 14 — Audit trail smoke test                          ║
// ╚═══════════════════════════════════════════════════════════╝
// Verifies:
//   • tbl_action_admin captures action_type / target_type / target_id / change_json
//     for every admin mutation (create/update/delete user, update balance, etc.)
//   • tbl_audit_log captures event_type + detail + ip for login_ok,
//     login_fail (unknown user + wrong pw), lockout, logout
//   • Passwords / tokens never appear in change_json (redactor works)
//   • Self-password-change is logged as 'change_own_password'
//
// Run:  node smoke-phase14-audit.js      (server must be on :3001)

'use strict';

require('dotenv').config();
const http = require('http');
const { Pool } = require('pg');

const HOST = 'localhost', PORT = 3001;
const pool = new Pool({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASS,
});

function reqJSON(method, path, { body, token, csrf } = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const opts = {
            host: HOST, port: PORT, method, path,
            headers: {
                'Content-Type': 'application/json',
                ...(data  ? { 'Content-Length': Buffer.byteLength(data) } : {}),
                ...(token ? { Authorization: 'Bearer ' + token } : {}),
                ...(csrf  ? { 'X-CSRF-Token': csrf } : {}),
            },
        };
        const r = http.request(opts, (res) => {
            let buf = '';
            res.on('data', c => buf += c);
            res.on('end', () => {
                let j = null; try { j = JSON.parse(buf); } catch (_) {}
                resolve({ status: res.statusCode, body: j, raw: buf });
            });
        });
        r.on('error', e => resolve({ status: 0, error: e.message }));
        if (data) r.write(data);
        r.end();
    });
}

async function loginAs(u, p) {
    const r = await reqJSON('POST', '/api/auth/login', { body: { username: u, password: p } });
    return { token: r.body?.token, csrf: r.body?.csrfToken, body: r.body, status: r.status };
}

let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else      { fail++; failures.push({ name, detail }); console.log(`  FAIL  ${name}  ${detail || ''}`); }
}

// Pull the most recent action row matching an action_type
async function latestAction(actionType, extra = {}) {
    const where = ['action_type = $1']; const params = [actionType];
    if (extra.userId)   { params.push(extra.userId);   where.push(`user_id    = $${params.length}`); }
    if (extra.targetId) { params.push(extra.targetId); where.push(`target_id  = $${params.length}`); }
    const r = await pool.query(
        `SELECT * FROM tbl_action_admin WHERE ${where.join(' AND ')}
         ORDER BY edit_time DESC LIMIT 1`, params);
    return r.rows[0] || null;
}

// Pull the most recent audit row matching event_type
async function latestAudit(eventType, extra = {}) {
    const where = ['event_type = $1']; const params = [eventType];
    if (extra.userId === null) where.push('user_id IS NULL');
    else if (extra.userId)     { params.push(extra.userId); where.push(`user_id = $${params.length}`); }
    const r = await pool.query(
        `SELECT * FROM tbl_audit_log WHERE ${where.join(' AND ')}
         ORDER BY log_in_time DESC LIMIT 1`, params);
    return r.rows[0] || null;
}

// Mirror server's REDACT_KEYS — only these exact keys are considered secrets.
// Using a substring regex is wrong: "must_change_password_cleared" is a
// boolean flag, not a leaked secret.
const SECRET_KEYS = new Set([
    'password', 'password_hash', 'pw', 'pw_hash',
    'csrf_token', 'csrf', 'token', 'bearer', 'session_token',
]);
function hasSecret(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const walk = (o) => {
        if (!o || typeof o !== 'object') return false;
        for (const [k, v] of Object.entries(o)) {
            if (SECRET_KEYS.has(String(k).toLowerCase())) return true;
            if (typeof v === 'object' && walk(v)) return true;
        }
        return false;
    };
    return walk(obj);
}

(async () => {
    console.log('\n=== Phase 14 audit-trail smoke ===\n');

    const h = await reqJSON('GET', '/api/health');
    if (!h.body?.ok) { console.log('FATAL: server not reachable'); process.exit(2); }

    const admin = await loginAs('admin', 'admin123');
    if (!admin.token) { console.log('FATAL admin login'); process.exit(2); }

    // ─── 1) Unknown user login attempt → audit row with NULL user_id ───────────
    console.log('[1] Failed login — unknown username');
    const unknown = await loginAs('nobody_such_user_' + Date.now(), 'zzz');
    check('unknown-user login rejected (401)', unknown.status === 401);
    // small delay so the async INSERT has flushed
    await new Promise(r => setTimeout(r, 200));
    const a1 = await latestAudit('login_fail', { userId: null });
    check('audit row: login_fail with NULL user_id', a1 && a1.user_id === null && a1.event_type === 'login_fail',
          a1 ? JSON.stringify({ uid: a1.user_id, et: a1.event_type, d: a1.detail }) : 'no row');
    check('audit row: detail.reason=unknown_user',
          a1 && a1.detail && a1.detail.reason === 'unknown_user',
          a1 ? JSON.stringify(a1.detail) : 'no row');

    // ─── 2) Create a target user — logs create_user action ─────────────────────
    console.log('\n[2] Admin creates user');
    const U = 'smoke_p14a_' + Date.now().toString(36);
    const PW = 'SmokeP14_1!';
    const cre = await reqJSON('POST', '/api/users', {
        token: admin.token, csrf: admin.csrf,
        body: { username: U, password: PW, displayName: 'P14 Audit', role: 'user', balance: 100 },
    });
    check('create user ok', cre.body?.ok === true, JSON.stringify(cre.body));
    const newUid = cre.body?.id || cre.body?.user?.id;
    check('create user returned id', Number.isInteger(newUid), 'cre.body=' + JSON.stringify(cre.body));
    await new Promise(r => setTimeout(r, 200));
    const a2 = await latestAction('create_user', { userId: 1, targetId: newUid });
    check('action row: create_user logged', !!a2, 'no row');
    check('action row: target_type=user', a2 && a2.target_type === 'user');
    check('action row: target_id matches', a2 && a2.target_id === newUid);
    check('action row: change_json has after.username', a2 && a2.change_json?.after?.username === U,
          a2 ? JSON.stringify(a2.change_json) : '');
    check('action row: NO password in change_json', a2 && !hasSecret(a2.change_json),
          a2 ? JSON.stringify(a2.change_json) : '');

    // ─── 3) Wrong password → audit row with user_id known ──────────────────────
    console.log('\n[3] Failed login — wrong password for existing user');
    const wrong = await loginAs(U, 'WrongPw!X');
    check('wrong-pw login rejected', wrong.status === 401);
    await new Promise(r => setTimeout(r, 200));
    const a3 = await latestAudit('login_fail', { userId: newUid });
    check('audit row: login_fail with user_id', a3 && a3.user_id === newUid && a3.event_type === 'login_fail',
          a3 ? JSON.stringify(a3.detail) : 'no row');
    check('audit row: reason=wrong_password',
          a3 && a3.detail?.reason === 'wrong_password',
          a3 ? JSON.stringify(a3.detail) : '');

    // ─── 4) Successful login → login_ok with detail.must_change_password ───────
    console.log('\n[4] Successful login (must_change_password expected)');
    const first = await loginAs(U, PW);
    check('first login 200', first.status === 200);
    check('must_change_password flag', first.body?.mustChangePassword === true);
    await new Promise(r => setTimeout(r, 200));
    const a4 = await latestAudit('login_ok', { userId: newUid });
    check('audit row: login_ok', a4 && a4.event_type === 'login_ok');
    check('audit row: detail.must_change_password=true',
          a4 && a4.detail?.must_change_password === true,
          a4 ? JSON.stringify(a4.detail) : '');
    check('audit row: ip populated', a4 && typeof a4.ip === 'string' && a4.ip.length > 0,
          a4 ? JSON.stringify(a4.ip) : '');

    // ─── 5) User changes own password → change_own_password action row ─────────
    console.log('\n[5] User changes own password');
    const FINAL = PW + 'X';
    const chg = await reqJSON('PUT', `/api/users/${newUid}/password`, {
        token: first.token, csrf: first.csrf, body: { password: FINAL },
    });
    check('pw change ok', chg.body?.ok === true, JSON.stringify(chg.body));
    await new Promise(r => setTimeout(r, 200));
    const a5 = await latestAction('change_own_password', { userId: newUid, targetId: newUid });
    check('action row: change_own_password', !!a5, 'no row');
    check('action row: NO password leaked', a5 && !hasSecret(a5.change_json),
          a5 ? JSON.stringify(a5.change_json) : '');

    // ─── 6) Admin updates balance → before/after + delta ───────────────────────
    console.log('\n[6] Admin updates balance (100 → 777)');
    const bal = await reqJSON('PUT', `/api/users/${newUid}/balance`, {
        token: admin.token, csrf: admin.csrf, body: { balance: 777 },
    });
    check('balance update ok', bal.body?.ok === true, JSON.stringify(bal.body));
    await new Promise(r => setTimeout(r, 200));
    const a6 = await latestAction('update_balance', { userId: 1, targetId: newUid });
    check('action row: update_balance', !!a6, 'no row');
    check('action row: before.balance captured',
          a6 && (a6.change_json?.before?.balance === '100.00' || a6.change_json?.before?.balance === 100 || a6.change_json?.before?.balance === '100'),
          a6 ? JSON.stringify(a6.change_json) : '');
    check('action row: after.balance = 777',
          a6 && (a6.change_json?.after?.balance === '777.00' || a6.change_json?.after?.balance === 777 || a6.change_json?.after?.balance === '777'),
          a6 ? JSON.stringify(a6.change_json) : '');
    check('action row: extra.delta = 677',
          a6 && Math.abs((a6.change_json?.extra?.delta || 0) - 677) < 0.01,
          a6 ? JSON.stringify(a6.change_json) : '');

    // ─── 7) Admin update user fields → before/after diff ───────────────────────
    console.log('\n[7] Admin updates user display name');
    const upd = await reqJSON('PUT', `/api/users/${newUid}`, {
        token: admin.token, csrf: admin.csrf,
        body: { displayName: 'P14 Renamed' },
    });
    check('user update ok', upd.body?.ok === true, JSON.stringify(upd.body));
    await new Promise(r => setTimeout(r, 200));
    const a7 = await latestAction('update_user', { userId: 1, targetId: newUid });
    check('action row: update_user', !!a7, 'no row');
    // before/after should contain name or display_name change
    const cj7 = a7 && a7.change_json;
    const hasNameDiff =
        (cj7?.before?.name !== cj7?.after?.name) ||
        (cj7?.before?.surname !== cj7?.after?.surname) ||
        (cj7?.before?.display_name !== cj7?.after?.display_name);
    check('action row: name diff present', hasNameDiff, JSON.stringify(cj7));
    check('action row: NO password in diff', cj7 && !hasSecret(cj7), JSON.stringify(cj7));

    // ─── 8) Logout → logout event row ─────────────────────────────────────────
    console.log('\n[8] User logout');
    const lo = await reqJSON('POST', '/api/logout', { token: first.token, csrf: first.csrf, body: {} });
    check('logout 200', lo.status === 200);
    await new Promise(r => setTimeout(r, 200));
    const a8 = await latestAudit('logout', { userId: newUid });
    check('audit row: logout event', a8 && a8.event_type === 'logout', a8 ? JSON.stringify(a8) : 'no row');

    // ─── 9) /api/audit-log endpoint returns new fields ─────────────────────────
    console.log('\n[9] GET /api/audit-log returns new fields');
    const audList = await reqJSON('GET', '/api/audit-log?event=login_fail&limit=10',
        { token: admin.token, csrf: admin.csrf });
    check('audit-log 200', audList.status === 200);
    const row = (audList.body?.logs || [])[0];
    check('audit-log row has event_type', row && row.event_type === 'login_fail');
    check('audit-log row has detail/ip fields', row && 'detail' in row && 'ip' in row);

    // ─── 10) /api/action-log endpoint returns new fields ───────────────────────
    console.log('\n[10] GET /api/action-log returns new fields');
    const actList = await reqJSON('GET', `/api/action-log?target=user&targetId=${newUid}&limit=20`,
        { token: admin.token, csrf: admin.csrf });
    check('action-log 200', actList.status === 200);
    const arow = (actList.body?.logs || [])[0];
    check('action-log row has action_type', arow && typeof arow.action_type === 'string');
    check('action-log row has change_json', arow && arow.change_json !== undefined);
    check('action-log filter works (only this target)',
          (actList.body?.logs || []).every(r => r.target_id === newUid));

    // ─── Cleanup: soft-delete the smoke user ──────────────────────────────────
    await reqJSON('DELETE', `/api/users/${newUid}`, { token: admin.token, csrf: admin.csrf });

    await pool.end();
    console.log('\n=== Result ===');
    console.log(`PASS: ${pass}`);
    console.log(`FAIL: ${fail}`);
    if (fail > 0) for (const f of failures) console.log(` - ${f.name}: ${f.detail || ''}`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(async e => {
    console.error('FATAL', e);
    try { await pool.end(); } catch {}
    process.exit(2);
});
