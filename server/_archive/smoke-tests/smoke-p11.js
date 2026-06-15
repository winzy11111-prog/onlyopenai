// ╔═══════════════════════════════════════════════════════════╗
// ║ Phase 11 Block A — ship-ready smoke                       ║
// ╚═══════════════════════════════════════════════════════════╝
// Proves:
//   1. runMigrations() is idempotent (re-runs are no-ops)
//   2. migrationStatus() reports same files as applied
//   3. boot() starts the server, /api/health returns 200
//   4. SIGTERM triggers graceful shutdown and exits 0
//
// Run:  node smoke-p11.js
// Exits 0 on full pass, 1 on any failure.

'use strict';

require('dotenv').config();
const http          = require('http');
const { spawn }     = require('child_process');
const path          = require('path');
const { Pool }      = require('pg');
const { runMigrations, migrationStatus } = require('./migrate-schema');

const PORT = 3001;
let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else      { fail++; failures.push({ name, detail }); console.log(`  FAIL  ${name}  ${detail || ''}`); }
}

function httpGet(p) {
    return new Promise((resolve) => {
        const req = http.request({ host: 'localhost', port: PORT, method: 'GET', path: p }, (res) => {
            let buf = '';
            res.on('data', (c) => buf += c);
            res.on('end', () => {
                let j = null; try { j = JSON.parse(buf); } catch (_) {}
                resolve({ status: res.statusCode, body: j });
            });
        });
        req.on('error', (e) => resolve({ status: 0, error: e.message }));
        req.end();
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
    console.log('\n=== Phase 11 Block A smoke ===\n');

    // ── 1. idempotent migrations ─────────────────────────────
    console.log('[1] Migration idempotency');
    const pool = new Pool({
        host: process.env.DB_HOST, port: +process.env.DB_PORT || 5432,
        database: process.env.DB_NAME, user: process.env.DB_USER,
        password: process.env.DB_PASS,
    });
    const s1 = await runMigrations(pool);
    check('first pass — any migrations', s1.applied.length + s1.skipped.length > 0);
    const s2 = await runMigrations(pool);
    check('second pass — zero applied', s2.applied.length === 0,
        `applied=${JSON.stringify(s2.applied)}`);
    check('second pass — all skipped (up-to-date)',
        s2.skipped.length === (s1.applied.length + s1.skipped.length),
        `skipped=${s2.skipped.length} expected=${s1.applied.length + s1.skipped.length}`);

    // ── 2. status matches ────────────────────────────────────
    console.log('\n[2] Migration status API');
    const st = await migrationStatus(pool);
    check('status: zero pending',  st.pending.length === 0,  `pending=${st.pending.join(',')}`);
    check('status: zero modified', st.modified.length === 0, `modified=${st.modified.join(',')}`);
    check('status: all applied',   st.applied.length > 0);

    await pool.end();

    // ── 3. boot + health + SIGTERM ───────────────────────────
    console.log('\n[3] Boot / health / SIGTERM');

    // port check — we don't want to collide with a running server
    const pre = await httpGet('/api/health');
    if (pre.status !== 0) {
        console.log('  SKIP  live server already on port', PORT, '— skipping boot subtest');
    } else {
        const child = spawn(process.execPath, ['server.js'], {
            cwd: __dirname,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '', stderr = '';
        child.stdout.on('data', (c) => stdout += c);
        child.stderr.on('data', (c) => stderr += c);

        let exitCode = null, exitSignal = null;
        child.on('exit', (code, sig) => { exitCode = code; exitSignal = sig; });

        // wait for server banner (up to 15s)
        let up = false;
        for (let i = 0; i < 30 && !up; i++) {
            await sleep(500);
            const h = await httpGet('/api/health');
            if (h.status === 200) up = true;
        }
        check('server came up within 15s', up,
            up ? '' : `stdout:\n${stdout}\nstderr:\n${stderr}`);

        if (up) {
            const h = await httpGet('/api/health');
            check('/api/health ok', h.status === 200, JSON.stringify(h.body));
        }

        // SIGTERM
        // Windows doesn't deliver POSIX signals to console apps —
        // child.kill('SIGTERM') maps to a hard kill. Fall back to SIGINT
        // which Node *does* translate to Ctrl-C on Windows in some cases;
        // otherwise skip clean-exit assertion.
        if (process.platform === 'win32') {
            console.log('  SKIP  SIGTERM clean-exit assertion on Windows (OS limitation)');
            try { child.kill(); } catch (_) {}
            await sleep(2000);
        } else {
            child.kill('SIGTERM');
            for (let i = 0; i < 20 && exitCode === null; i++) await sleep(500);
            check('exited after SIGTERM', exitCode !== null,
                `still running; stdout tail:\n${stdout.slice(-500)}`);
            check('exit code 0', exitCode === 0, `code=${exitCode} signal=${exitSignal}`);
            check('stdout mentions shutdown', /shutdown/i.test(stdout),
                stdout.slice(-300));
        }
    }

    console.log('\n=== Result ===');
    console.log(`PASS: ${pass}`);
    console.log(`FAIL: ${fail}`);
    if (fail > 0) for (const f of failures) console.log(` - ${f.name}: ${f.detail || ''}`);
    process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
