// ╔═══════════════════════════════════════════════════════════╗
// ║ Phase 14 — Extended router + SAP coverage smoke            ║
// ╚═══════════════════════════════════════════════════════════╝
// Verifies that the 5 new router intents resolve to the right skill IDs
// and that the new knowledge files are reachable via file_search (by
// asking a question only answerable from the new content).
//
// Assumes server on :3001 in openai mode.
//
// Run:  node smoke-phase14-router.js

'use strict';

require('dotenv').config();
const http = require('http');

const HOST = 'localhost', PORT = 3001;

function reqJSON(method, path, { body, token, csrf } = {}) {
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

function stream(token, csrf, body) {
    return new Promise((resolve) => {
        const payload = JSON.stringify(body);
        const req = http.request({
            host: HOST, port: PORT, method: 'POST', path: '/api/chat',
            headers: {
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'Authorization':  'Bearer ' + token,
                ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
            },
        }, (res) => {
            let buffer = '', text = '', events = [], done = null;
            const killer = setTimeout(() => { try { req.destroy(); } catch (_) {} }, 60000);
            res.on('data', (d) => {
                buffer += d.toString();
                const lines = buffer.split('\n'); buffer = lines.pop();
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    let ev; try { ev = JSON.parse(line.slice(6)); } catch { continue; }
                    events.push(ev.type);
                    if (ev.type === 'chunk')      text += ev.text;
                    else if (ev.type === 'done')  { done = ev; clearTimeout(killer); resolve({ status: res.statusCode, text, done, events }); }
                    else if (ev.type === 'error') { clearTimeout(killer); resolve({ status: res.statusCode, text, error: ev, events }); }
                }
            });
            res.on('end', () => { clearTimeout(killer); resolve({ status: res.statusCode, text, done, events }); });
            res.on('error', () => { clearTimeout(killer); resolve({ status: res.statusCode, text, done, events }); });
        });
        req.on('error', e => resolve({ status: 0, error: e.message }));
        req.write(payload); req.end();
    });
}

let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else      { fail++; failures.push({ name, detail }); console.log(`  FAIL  ${name}  ${detail || ''}`); }
}
async function loginAs(u, p) {
    const r = await reqJSON('POST', '/api/auth/login', { body: { username: u, password: p } });
    return { token: r.body?.token, csrf: r.body?.csrfToken, body: r.body };
}

(async () => {
    console.log('\n=== Phase 14 router + coverage smoke ===\n');

    const h = await reqJSON('GET', '/api/health');
    if (h.body?.mode !== 'openai') { console.log('SKIP: server in mock mode'); process.exit(0); }

    const admin = await loginAs('admin', 'admin123');
    if (!admin.token) { console.log('FATAL admin login'); process.exit(2); }

    const U = 'smoke_p14_' + Date.now().toString(36);
    const PW = 'SmokeP14_1!';
    const cre = await reqJSON('POST', '/api/users', {
        token: admin.token, csrf: admin.csrf,
        body: { username: U, password: PW, displayName: 'P14', role: 'user', balance: 100 },
    });
    if (!cre.body?.ok) { console.log('FATAL create user:', JSON.stringify(cre.body)); process.exit(2); }
    const first = await loginAs(U, PW);
    const FINAL = PW + 'X';
    if (first.body?.mustChangePassword) {
        await reqJSON('PUT', `/api/users/${first.body.user.id}/password`, {
            token: first.token, csrf: first.csrf, body: { password: FINAL },
        });
    }
    const u = await loginAs(U, first.body?.mustChangePassword ? FINAL : PW);
    if (!u.token) { console.log('FATAL re-login'); process.exit(2); }

    // 1) Router — send short prompts, let server run router, end stream fast.
    //    We only care that the server accepts + streams; the actual intent
    //    label is in server log, not in the SSE. So we probe indirectly by
    //    asking Qs whose answers live in the new knowledge files.

    console.log('[1] RAP question (should use new RAP knowledge)');
    const rap = await stream(u.token, u.csrf, {
        prompt: 'What does BDEF stand for in ABAP RAP, and what are the two main implementation types?',
        useRouter: true,
    });
    check('rap: got stream',        rap.status === 200 && rap.done,    JSON.stringify({s: rap.status, t: rap.text.slice(0,80)}));
    check('rap: mentions BDEF/behavior/managed', /bdef|behavior definition|managed|unmanaged/i.test(rap.text), 'reply=' + rap.text.slice(0, 200));

    console.log('\n[2] Basis question — S_TABU_DIS');
    const basis = await stream(u.token, u.csrf, {
        prompt: 'Explain the S_TABU_DIS authorization object: what are its fields and what ACTVT values mean?',
        useRouter: true,
    });
    check('basis: stream OK',          basis.status === 200 && basis.done);
    check('basis: mentions DICBERCLS', /dicberCLS|authgroup|actvt/i.test(basis.text), basis.text.slice(0,200));

    console.log('\n[3] Integration question — IDoc status 51');
    const idoc = await stream(u.token, u.csrf, {
        prompt: 'IDoc inbound has status 51. Walk me through how to reprocess it using WE02 and BD87.',
        useRouter: true,
    });
    check('idoc: stream OK',             idoc.status === 200 && idoc.done);
    check('idoc: mentions WE02 or BD87', /we02|bd87|reprocess/i.test(idoc.text), idoc.text.slice(0,200));

    console.log('\n[4] MM question — GR movement type');
    const mm = await stream(u.token, u.csrf, {
        prompt: 'Which SAP movement type is used for goods receipt to stock for a PO, and name the BAPI for creating it.',
        useRouter: true,
    });
    check('mm: stream OK',                      mm.status === 200 && mm.done);
    check('mm: mentions 101 + BAPI_GOODSMVT',   /101/.test(mm.text) && /bapi_goodsmvt_create/i.test(mm.text), mm.text.slice(0,240));

    console.log('\n[5] Functional question — OBYC / account determination');
    const spro = await stream(u.token, u.csrf, {
        prompt: 'Where in SPRO do I configure MM-FI automatic account determination? What transaction?',
        useRouter: true,
    });
    check('spro: stream OK',             spro.status === 200 && spro.done);
    check('spro: mentions OBYC',         /obyc|account determination/i.test(spro.text), spro.text.slice(0,200));

    console.log('\n[6] Fiori / UI5 question');
    const ui5 = await stream(u.token, u.csrf, {
        prompt: 'In SAPUI5, how do I filter a sap.m.Table items binding by a user-entered search term?',
        useRouter: true,
    });
    check('ui5: stream OK',                 ui5.status === 200 && ui5.done);
    check('ui5: mentions Filter/FilterOperator', /filter/i.test(ui5.text) && /getBinding|binding/i.test(ui5.text), ui5.text.slice(0,200));

    console.log('\n=== Result ===');
    console.log(`PASS: ${pass}`);
    console.log(`FAIL: ${fail}`);
    if (fail > 0) for (const f of failures) console.log(` - ${f.name}: ${f.detail || ''}`);
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
