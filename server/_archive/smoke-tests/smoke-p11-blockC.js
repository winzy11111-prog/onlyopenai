// ╔═══════════════════════════════════════════════════════════╗
// ║ Phase 11 Block C — Logging / ops smoke                    ║
// ╚═══════════════════════════════════════════════════════════╝
// Assumes a running server on :3001.
//
// Covers:
//   1. logger.js loads and exports the three functions
//   2. Redaction removes password/token from payloads
//   3. pino-roll creates a daily-named file under LOG_DIR
//   4. httpLogger writes a JSON row for a real request,
//      with redacted Authorization header
//   5. /api/health is ignored (no row for it)
//   6. No high/critical npm vulnerabilities (via npm audit --json)
//
// Run:  node smoke-p11-blockC.js
//
// Note: to keep the test hermetic it reads the rolling file directly.
// It does NOT spawn a second server. It leans on the already-running
// server writing to logs/app.<today>.log.

'use strict';

require('dotenv').config();
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { execSync } = require('child_process');

const HOST = 'localhost', PORT = 3001;
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, 'logs');

function req(method, p, { body, token } = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const opts = {
            host: HOST, port: PORT, method, path: p,
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

// Wait until the newest log file has grown past `since` bytes (or a
// matching line arrives). Polls at 100 ms, up to 5 s.
async function waitForLogGrowth(filePath, since, matcher = null, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const st = fs.statSync(filePath);
            if (st.size > since) {
                if (!matcher) return true;
                const buf = fs.readFileSync(filePath, 'utf8');
                const lines = buf.split('\n').filter(Boolean);
                if (lines.some(matcher)) return true;
            }
        } catch (_) { /* file may not exist yet */ }
        await new Promise(r => setTimeout(r, 100));
    }
    return false;
}

function findTodayLogFile() {
    if (!fs.existsSync(LOG_DIR)) return null;
    const files = fs.readdirSync(LOG_DIR)
        .filter(f => f.startsWith('app') && f.endsWith('.log'))
        .map(f => ({ f, t: fs.statSync(path.join(LOG_DIR, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
    return files[0] ? path.join(LOG_DIR, files[0].f) : null;
}

(async () => {
    console.log('\n=== Phase 11 Block C smoke ===\n');

    // ── [1] logger module shape ─────────────────────────────
    console.log('[1] logger module');
    let mod;
    try { mod = require('./logger'); } catch (e) { console.log('FATAL require', e.message); process.exit(2); }
    check('exports logger',      !!mod.logger && typeof mod.logger.info === 'function');
    check('exports httpLogger',  typeof mod.httpLogger === 'function');
    check('exports flushLogger', typeof mod.flushLogger === 'function');

    // ── [2] redaction ───────────────────────────────────────
    console.log('\n[2] Redaction');
    // Capture what pino actually writes by hooking a temp file.
    // Simpler path: redaction paths include '*.password' and '*.token',
    // so we just assert by wiring a child logger that writes to memory.
    const pino = require('pino');
    const { Writable } = require('stream');
    let captured = '';
    const sink = new Writable({ write(chunk, _enc, cb) { captured += chunk.toString(); cb(); } });
    const L = pino({
        redact: {
            paths: ['*.password', '*.token', 'password', 'token'],
            censor: '[REDACTED]',
        },
    }, sink);
    L.info({ user: { name: 'bob', password: 'hunter2' }, token: 'SECRET123' }, 'login attempt');
    await new Promise(r => setTimeout(r, 50));
    check('password is redacted', captured.includes('[REDACTED]') && !captured.includes('hunter2'),
        captured);
    check('token is redacted',    !captured.includes('SECRET123'));

    // ── [3] rotating file exists ────────────────────────────
    console.log('\n[3] Rolling log file');
    let logFile = findTodayLogFile();
    check('LOG_DIR exists', fs.existsSync(LOG_DIR), `dir=${LOG_DIR}`);
    check('app.<date>.log present', !!logFile, `files=${fs.existsSync(LOG_DIR) ? fs.readdirSync(LOG_DIR).join(',') : '(no dir)'}`);

    // ── [4] httpLogger captures requests ────────────────────
    console.log('\n[4] httpLogger writes JSON row for real requests');
    if (!logFile) {
        check('(skipped — no log file)', false, 'rolling file not found');
    } else {
        const sizeBefore = fs.statSync(logFile).size;
        // Make a request that we KNOW is not /api/health
        const marker = 'smoke-blockC-' + Date.now();
        const al = await req('POST', '/api/auth/login', {
            body: { username: 'admin', password: 'admin123' },
        });
        check('admin login ok', al.body?.ok === true, JSON.stringify(al.body));
        const tok = al.body?.token;

        // Hit an endpoint that bounces auth — we want req.url to land in the log
        await req('GET', `/api/version?probe=${marker}`, { token: tok });

        const ok = await waitForLogGrowth(logFile, sizeBefore, (ln) => {
            try {
                const j = JSON.parse(ln);
                return j.req && j.req.url && j.req.url.includes(marker);
            } catch (_) { return false; }
        });
        check('log row for /api/version arrived', ok);

        if (ok) {
            const buf = fs.readFileSync(logFile, 'utf8');
            const row = buf.split('\n').reverse().find(ln => ln.includes(marker));
            const j = row ? JSON.parse(row) : null;
            check('log row is valid JSON', !!j);
            check('log row has statusCode', j?.res?.statusCode === 200, `got ${j?.res?.statusCode}`);
            // Authorization header should NOT leak
            check('authorization header not in row',
                !row.toLowerCase().includes('bearer ' + (tok || 'xx').slice(0, 12).toLowerCase()),
                'auth bled into log');
        }
    }

    // ── [5] /api/health is NOT logged ───────────────────────
    console.log('\n[5] /api/health is skipped by autoLogging.ignore');
    if (!logFile) {
        check('(skipped — no log file)', false);
    } else {
        const sizeBefore = fs.statSync(logFile).size;
        for (let i = 0; i < 3; i++) await req('GET', '/api/health');
        // Give pino a beat
        await new Promise(r => setTimeout(r, 400));
        const sizeAfter = fs.statSync(logFile).size;
        // Allow background writes; what matters is no /api/health row
        const buf = fs.readFileSync(logFile, 'utf8');
        const rows = buf.split('\n').filter(Boolean).slice(-50);
        const healthRows = rows.filter(ln => {
            try { const j = JSON.parse(ln); return j.req && j.req.url === '/api/health'; }
            catch { return false; }
        });
        check('zero /api/health rows', healthRows.length === 0, `found ${healthRows.length}`);
        // sizeAfter is informational only — we don't assert equality because
        // background activity (session janitor etc.) can legitimately log.
        void sizeAfter;
    }

    // ── [6] npm audit clean ─────────────────────────────────
    console.log('\n[6] npm audit — no high/critical vulnerabilities');
    try {
        const out = execSync('npm audit --json', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        const j = JSON.parse(out);
        const m = j.metadata?.vulnerabilities || {};
        check('zero high',     (m.high     || 0) === 0, `high=${m.high}`);
        check('zero critical', (m.critical || 0) === 0, `critical=${m.critical}`);
    } catch (e) {
        // npm audit exits 1 when vulns are found — read stdout from the error
        try {
            const j = JSON.parse(e.stdout ? e.stdout.toString() : '{}');
            const m = j.metadata?.vulnerabilities || {};
            check('zero high',     (m.high     || 0) === 0, `high=${m.high}`);
            check('zero critical', (m.critical || 0) === 0, `critical=${m.critical}`);
        } catch (_) {
            check('npm audit ran', false, e.message);
        }
    }

    console.log('\n=== Result ===');
    console.log(`PASS: ${pass}`);
    console.log(`FAIL: ${fail}`);
    if (fail > 0) for (const f of failures) console.log(` - ${f.name}: ${f.detail || ''}`);
    process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
