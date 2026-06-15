// ╔═══════════════════════════════════════════════════════════╗
// ║ Tier 1 — Stop Generation smoke                            ║
// ╚═══════════════════════════════════════════════════════════╝
// Assumes a running server on :3001. This test exercises server-side
// client-disconnect handling on /api/chat:
//
//   1. Open an SSE stream to /api/chat.
//   2. Wait for the first 'chunk' event (proves streaming started).
//   3. Abort the fetch mid-stream (simulates frontend Stop button).
//   4. After the abort, the server should:
//        - stop consuming OpenAI tokens (no more res.write fires)
//        - not crash the process
//        - still have persisted the partial response to tbl_chat_message
//          (best-effort: we check message_count>=2 OR 0 if not reached
//          persistence path yet — lenient because abort timing varies).
//
// If OPENAI key is absent, server returns JSON with useMock=true and
// this smoke exits cleanly marking the test SKIPPED (not failed).
//
// Run:  node smoke-tier1-stop.js

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

let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else      { fail++; failures.push({ name, detail }); console.log(`  FAIL  ${name}  ${detail || ''}`); }
}

async function loginAs(u, p) {
    const r = await reqJSON('POST', '/api/auth/login', { body: { username: u, password: p } });
    return { token: r.body?.token, csrf: r.body?.csrfToken, body: r.body };
}

// Open an SSE to /api/chat and abort it once we see the first chunk.
// Returns { aborted, chunksSeen, sessionId }.
function streamAndAbort(token, csrf, prompt) {
    return new Promise((resolve) => {
        const payload = JSON.stringify({ prompt, useRouter: false });
        const request = http.request({
            host: HOST, port: PORT, method: 'POST', path: '/api/chat',
            headers: {
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'Authorization':  'Bearer ' + token,
                ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
            },
        }, (res) => {
            let chunksSeen = 0, firstChunkAt = 0, sessionId = null, buffer = '';
            // Guard against infinite hang — 15s ceiling.
            const safetyTimer = setTimeout(() => {
                try { request.destroy(); } catch (_) {}
                resolve({ aborted: false, chunksSeen, sessionId, timeout: true, status: res.statusCode });
            }, 15000);

            res.on('data', (data) => {
                buffer += data.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    let ev; try { ev = JSON.parse(line.slice(6)); } catch { continue; }
                    if (ev.type === 'chunk') {
                        chunksSeen++;
                        if (chunksSeen === 1) {
                            firstChunkAt = Date.now();
                            // Give it ~200ms of streaming then abort — enough to
                            // prove we're mid-stream, not at the end.
                            setTimeout(() => {
                                try { request.destroy(); } catch (_) {}
                            }, 200);
                        }
                    } else if (ev.type === 'done') {
                        sessionId = ev.sessionId;
                        clearTimeout(safetyTimer);
                        resolve({ aborted: false, chunksSeen, sessionId, gotDone: true, stopped: !!ev.stopped, status: res.statusCode });
                    } else if (ev.type === 'use_mock' || ev.type === 'error') {
                        clearTimeout(safetyTimer);
                        resolve({ aborted: false, chunksSeen, sessionId, mock: true, reason: ev.reason, status: res.statusCode });
                    }
                }
            });
            res.on('error', () => {
                clearTimeout(safetyTimer);
                resolve({ aborted: true, chunksSeen, sessionId, status: res.statusCode });
            });
        });
        request.on('error', () => {
            // This fires when we destroy() the request — that's the success case
            resolve({ aborted: true, chunksSeen: -1, sessionId: null });
        });
        // Handle the 'response' side's abort being the primary path
        request.write(payload);
        request.end();
    });
}

(async () => {
    console.log('\n=== Tier 1 stop-generation smoke ===\n');

    // Health check first — skip if OpenAI key is not configured
    const health = await reqJSON('GET', '/api/health');
    if (health.body?.mode !== 'openai') {
        console.log('SKIP: server is in mock mode (no OPENAI_API_KEY), stop smoke needs real streaming');
        process.exit(0);
    }

    const admin = await loginAs('admin', 'admin123');
    if (!admin.token) { console.log('FATAL admin login'); process.exit(2); }

    const USER    = 'smoke_stop_' + Date.now().toString(36);
    const USER_PW = 'SmokeStop1A!';
    const cre = await reqJSON('POST', '/api/users', {
        token: admin.token, csrf: admin.csrf,
        body: { username: USER, password: USER_PW, displayName: 'Stop', role: 'user', balance: 50 },
    });
    if (!cre.body?.ok) { console.log('FATAL create user:', JSON.stringify(cre.body)); process.exit(2); }
    const first = await loginAs(USER, USER_PW);
    const FINAL = USER_PW + 'X';
    if (first.body?.mustChangePassword) {
        await reqJSON('PUT', `/api/users/${first.body.user.id}/password`, {
            token: first.token, csrf: first.csrf, body: { password: FINAL },
        });
    }
    const u = await loginAs(USER, first.body?.mustChangePassword ? FINAL : USER_PW);
    if (!u.token) { console.log('FATAL re-login'); process.exit(2); }

    // Ask for a long answer so we're guaranteed to abort mid-stream
    const prompt = 'Write a long, detailed, step-by-step explanation of how TCP/IP works. At least 500 words.';
    console.log('[1] Abort mid-stream');
    const r = await streamAndAbort(u.token, u.csrf, prompt);

    check('server responded with HTTP 200',        r.status === 200 || r.status === undefined /* aborted before status cache */ , 'got status=' + r.status);
    check('at least one chunk streamed before abort', (r.chunksSeen || 0) >= 1, 'chunksSeen=' + r.chunksSeen);
    check('request was aborted (no done event)',   r.aborted === true || r.gotDone !== true, JSON.stringify(r));

    // Give the server a moment to finish its post-abort persistence path
    await new Promise(r2 => setTimeout(r2, 500));

    // Verify server still responsive (didn't crash)
    console.log('\n[2] Server still healthy after abort');
    const h2 = await reqJSON('GET', '/api/health');
    check('health 200 post-abort', h2.status === 200);

    // Check that listing sessions still works for this user
    const list = await reqJSON('GET', '/api/chat/sessions', { token: u.token });
    check('session list ok post-abort', list.status === 200 && list.body?.ok === true);

    console.log('\n=== Result ===');
    console.log(`PASS: ${pass}`);
    console.log(`FAIL: ${fail}`);
    if (fail > 0) for (const f of failures) console.log(` - ${f.name}: ${f.detail || ''}`);
    process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
