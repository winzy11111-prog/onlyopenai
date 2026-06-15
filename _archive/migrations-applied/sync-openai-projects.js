// ╔═══════════════════════════════════════════════════════════╗
// ║  sync-openai-projects.js                                  ║
// ║  Phase 15 — first-run sync: create one OpenAI project +    ║
// ║  one service-account API key per active dashboard project. ║
// ╚═══════════════════════════════════════════════════════════╝
//
// What it does
// ────────────
//  • Reads all active rows from tbl_project (is_deleted = false)
//  • For each row WITHOUT openai_project_id:
//      1. POST /v1/organization/projects                          → openai_project_id
//      2. POST /v1/organization/projects/{id}/service_accounts    → sk-svcacct-…
//      3. UPDATE tbl_project SET openai_project_id, openai_service_account_id,
//         project_api_key (PLAINTEXT for now), openai_synced_at = NOW()
//  • Skips rows that already have openai_project_id (idempotent)
//  • Prints a verification table with key prefix + suffix so you
//    can compare against the OpenAI web dashboard
//
// Why plaintext on this run?
// ──────────────────────────
//  Encryption (AES-256-GCM) lands as a follow-up step once you've
//  verified the IDs/keys really do match what OpenAI shows. Storing
//  plaintext today is no worse than the master key already living
//  in .env.
//
// Safety
// ──────
//  • Idempotent: re-running won't double-create OpenAI projects.
//  • Dry-run: pass --dry to skip the writes (still calls list APIs).
//  • Names: OpenAI project name = dashboard project_name. Suffix
//    " (dashboard)" is appended so they're easy to spot in the UI.

require('dotenv').config();
const { Pool } = require('pg');

const ADMIN_KEY = process.env.OPENAI_ADMIN_KEY;
if (!ADMIN_KEY) {
    console.error('✗ OPENAI_ADMIN_KEY missing in .env');
    process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
});

const H = {
    Authorization: 'Bearer ' + ADMIN_KEY,
    'Content-Type': 'application/json',
};

async function api(method, path, body) {
    const res = await fetch('https://api.openai.com' + path, {
        method,
        headers: H,
        body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = json.error?.message || JSON.stringify(json);
        throw new Error(`HTTP ${res.status} ${method} ${path} → ${msg}`);
    }
    return json;
}

function maskKey(k) {
    if (!k) return '(none)';
    if (k.length < 16) return k;
    return k.slice(0, 14) + '…' + k.slice(-6) + '  (len=' + k.length + ')';
}

async function main() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Phase 15 — sync dashboard projects → OpenAI org');
    console.log('mode:', DRY_RUN ? 'DRY-RUN (no writes)' : 'LIVE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // 1) Pull all active dashboard projects
    const { rows: projects } = await pool.query(`
        SELECT project_id, project_name, openai_project_id,
               openai_service_account_id, openai_synced_at,
               COALESCE(LENGTH(project_api_key), 0) AS key_len
          FROM tbl_project
         WHERE is_deleted = FALSE
         ORDER BY created_date ASC
    `);
    console.log(`Found ${projects.length} active dashboard projects:\n`);
    projects.forEach(p => {
        const linked = p.openai_project_id ? '✓ linked' : '· not linked';
        console.log(`  [${linked}]  ${p.project_id.padEnd(25)}  ${p.project_name}`);
    });
    console.log('');

    // 2) Process each unlinked one
    const todo = projects.filter(p => !p.openai_project_id);
    if (todo.length === 0) {
        console.log('All projects already linked. Nothing to do.\n');
        await printSummary();
        return;
    }
    console.log(`→ ${todo.length} project(s) need linking.\n`);

    for (const p of todo) {
        console.log(`── ${p.project_name} (internal id: ${p.project_id}) ──`);
        if (DRY_RUN) {
            console.log('  [dry] would POST /v1/organization/projects {name:"' + p.project_name + ' (dashboard)"}');
            console.log('  [dry] would POST .../service_accounts {name:"dashboard-sa"}');
            continue;
        }
        try {
            // 2a. Create OpenAI project
            const proj = await api('POST', '/v1/organization/projects', {
                name: p.project_name + ' (dashboard)',
            });
            console.log('  ✓ openai_project_id:', proj.id);

            // 2b. Create service account inside it
            const sa = await api(
                'POST',
                `/v1/organization/projects/${proj.id}/service_accounts`,
                { name: 'dashboard-sa' }
            );
            const saKey = sa.api_key?.value || sa.api_key?.secret || sa.value;
            if (!saKey) {
                console.log('  ✗ service-account created but no key in response:', JSON.stringify(sa, null, 2));
                continue;
            }
            console.log('  ✓ service_account_id:', sa.id);
            console.log('  ✓ key:', maskKey(saKey));

            // 2c. Persist (plaintext for this verification run)
            await pool.query(
                `UPDATE tbl_project
                    SET openai_project_id = $1,
                        openai_service_account_id = $2,
                        project_api_key = $3,
                        openai_synced_at = NOW()
                  WHERE project_id = $4`,
                [proj.id, sa.id, saKey, p.project_id]
            );
            console.log('  ✓ tbl_project updated\n');
        } catch (e) {
            console.log('  ✗ FAILED:', e.message, '\n');
        }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    await printSummary();
}

async function printSummary() {
    const { rows } = await pool.query(`
        SELECT project_id, project_name, openai_project_id,
               openai_service_account_id,
               project_api_key,
               openai_synced_at
          FROM tbl_project
         WHERE is_deleted = FALSE
         ORDER BY created_date ASC
    `);

    console.log('Verification table (cross-check with OpenAI dashboard):\n');
    rows.forEach(r => {
        console.log('  ┌─', r.project_name);
        console.log('  │  internal_id   :', r.project_id);
        console.log('  │  openai_project:', r.openai_project_id || '(unlinked)');
        console.log('  │  service_acct  :', r.openai_service_account_id || '(none)');
        console.log('  │  api_key       :', maskKey(r.project_api_key));
        console.log('  │  synced_at     :', r.openai_synced_at ? r.openai_synced_at.toISOString() : '(never)');
        console.log('  └─');
    });
    console.log('\nOpen https://platform.openai.com/organization/projects');
    console.log('You should see new projects named "<name> (dashboard)" with one');
    console.log('service-account key each. Compare the LAST 6 chars of the key');
    console.log('shown above with what OpenAI displays for that key.\n');
}

main()
    .catch(e => {
        console.error('FATAL:', e);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
