// ╔═══════════════════════════════════════════════════════════╗
// ║  migrate-unify-project-id.js                              ║
// ║  One-time data migration:                                 ║
// ║    rename tbl_project.project_id → openai_project_id      ║
// ║    so the dashboard's PK matches what OpenAI sees.        ║
// ╚═══════════════════════════════════════════════════════════╝
//
// Pre-requisite: phase15-002 must have applied — it adds ON UPDATE CASCADE
// to all FK references, which makes a single UPDATE on tbl_project propagate
// down to tbl_balance, tbl_response, tbl_user, and tbl_credits automatically.
//
// Two non-FK columns also hold project_id and must be renamed by hand:
//   tbl_action_admin.project_id   (audit log of admin actions)
//   tbl_daily_token.project_id    (per-day usage roll-up)
//
// Mode
// ────
//   node migrate-unify-project-id.js --dry   ← print plan only
//   node migrate-unify-project-id.js         ← actually rename
//
// Safety
// ──────
//   - Wraps every rename in a single transaction. Either ALL rename
//     atomically or NOTHING does.
//   - Skips rows where project_id already equals openai_project_id (idempotent).
//   - Refuses to run if any active project lacks openai_project_id (would leave
//     a half-migrated state).

require('dotenv').config();
const { Pool } = require('pg');

const DRY = process.argv.includes('--dry');
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
});

async function main() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Phase 15.2 — unify dashboard project_id with OpenAI id');
    console.log('mode:', DRY ? 'DRY-RUN (no writes)' : 'LIVE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // 1. Plan
    const { rows: plan } = await pool.query(`
        SELECT project_id     AS old_id,
               openai_project_id AS new_id,
               project_name,
               (SELECT COUNT(*) FROM tbl_user         WHERE project_id = p.project_id) AS users,
               (SELECT COUNT(*) FROM tbl_balance      WHERE project_id = p.project_id) AS balance,
               (SELECT COUNT(*) FROM tbl_credits      WHERE project_id = p.project_id) AS credits,
               (SELECT COUNT(*) FROM tbl_response     WHERE project_id = p.project_id) AS response,
               (SELECT COUNT(*) FROM tbl_action_admin WHERE project_id = p.project_id) AS action_admin,
               (SELECT COUNT(*) FROM tbl_daily_token  WHERE project_id = p.project_id) AS daily_token
          FROM tbl_project p
         WHERE is_deleted = FALSE
           AND openai_project_id IS NOT NULL
           AND openai_project_id <> project_id
         ORDER BY created_date
    `);
    if (plan.length === 0) {
        console.log('Nothing to do — all active projects already use the OpenAI id.\n');
        return;
    }

    // Refuse if any active project still lacks an openai_project_id
    const { rows: orphan } = await pool.query(`
        SELECT project_id, project_name
          FROM tbl_project
         WHERE is_deleted = FALSE AND openai_project_id IS NULL
    `);
    if (orphan.length > 0) {
        console.log('✗ Cannot run — these active projects have no openai_project_id yet:');
        orphan.forEach(o => console.log('  -', o.project_id, '|', o.project_name));
        console.log('  Run sync-openai-projects.js first.\n');
        process.exitCode = 1;
        return;
    }

    console.log('Renames to perform:\n');
    plan.forEach(p => {
        console.log(`  ${p.project_name}`);
        console.log(`    old: ${p.old_id}`);
        console.log(`    new: ${p.new_id}`);
        console.log(`    cascade rows: users=${p.users} balance=${p.balance} credits=${p.credits} ` +
                    `response=${p.response} action_admin=${p.action_admin} daily_token=${p.daily_token}\n`);
    });

    if (DRY) {
        console.log('[dry] no writes performed.');
        return;
    }

    // 2. Execute — one transaction so a partial failure rolls back everything
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const p of plan) {
            // Manual update for non-FK columns first (CASCADE doesn't apply)
            const a = await client.query(
                'UPDATE tbl_action_admin SET project_id=$1 WHERE project_id=$2',
                [p.new_id, p.old_id]
            );
            const d = await client.query(
                'UPDATE tbl_daily_token SET project_id=$1 WHERE project_id=$2',
                [p.new_id, p.old_id]
            );
            // Then the cascading rename — touches tbl_project + cascades to
            // tbl_balance / tbl_user / tbl_response / tbl_credits via FK
            const u = await client.query(
                'UPDATE tbl_project SET project_id=$1 WHERE project_id=$2',
                [p.new_id, p.old_id]
            );
            console.log(`  ✓ ${p.project_name}: project rows=${u.rowCount}, ` +
                        `action_admin=${a.rowCount}, daily_token=${d.rowCount}`);
        }
        await client.query('COMMIT');
        console.log('\n✓ All renames committed.\n');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('✗ FAILED — rolled back. Error:', e.message);
        process.exitCode = 1;
    } finally {
        client.release();
    }

    // 3. Verify
    const { rows: post } = await pool.query(`
        SELECT project_id, openai_project_id, project_name,
               CASE WHEN project_id = openai_project_id THEN 'unified' ELSE 'MISMATCH' END AS status
          FROM tbl_project
         WHERE is_deleted = FALSE
         ORDER BY created_date
    `);
    console.log('Post-migration state:');
    console.table(post);
}

main()
    .catch(e => { console.error('FATAL:', e); process.exitCode = 1; })
    .finally(() => pool.end());
