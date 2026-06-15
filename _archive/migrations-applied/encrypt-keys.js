// ╔═══════════════════════════════════════════════════════════╗
// ║  encrypt-keys.js — one-time bulk encryption of existing    ║
// ║                    tbl_project.project_api_key values      ║
// ╚═══════════════════════════════════════════════════════════╝
//
// Run once after deploying Phase 17 to upgrade all plaintext keys in the DB.
// Safe to re-run: rows already prefixed with `enc:v1:` are skipped.
//
//   node encrypt-keys.js          # report-only (dry run)
//   node encrypt-keys.js --apply  # actually encrypt
//
// What it does
// ────────────
//   1. SELECT project_id, project_api_key FROM tbl_project
//   2. For each row where the column is NOT NULL and NOT already encrypted:
//        new_value = crypto.encrypt(old_plaintext)
//      Skip 'proj_*_key' placeholder strings (pre-Phase-16.2 legacy) — they
//      aren't real keys; flag them for admin attention.
//   3. UPDATE ... SET project_api_key = $new_value WHERE project_id = $id
//   4. Verify by decrypting the new value back to the original plaintext.
//
// Safety
// ──────
//   - Wraps each UPDATE in a single transaction so a crash mid-loop rolls back.
//   - Dry-run mode prints what WOULD change without writing.
//   - Refuses to run if ENCRYPTION_KEY is missing or malformed.

require('dotenv').config();
const { Pool } = require('pg');
const { encrypt, decrypt, isEncrypted } = require('./crypto');

const APPLY = process.argv.includes('--apply');

const pool = new Pool({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASS,
});

(async () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Phase 17 — encrypt project_api_key values');
    console.log('mode:', APPLY ? 'LIVE (will write)' : 'DRY-RUN (no writes)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const { rows } = await pool.query(
        `SELECT project_id, project_name, project_api_key
           FROM tbl_project
          WHERE project_api_key IS NOT NULL
          ORDER BY project_name`);

    let toEncrypt = 0, alreadyEncrypted = 0, placeholders = 0;
    const queued = [];
    for (const r of rows) {
        const v = r.project_api_key;
        if (isEncrypted(v)) {
            alreadyEncrypted++;
            console.log('  ✓ already encrypted:', r.project_id, '|', r.project_name);
            continue;
        }
        if (/^proj_[a-z0-9_-]+_key$/i.test(v)) {
            placeholders++;
            console.log('  ⚠ placeholder (not a real key, skipping):', r.project_id, '|', r.project_name);
            continue;
        }
        toEncrypt++;
        const enc = encrypt(v);
        // Sanity: round-trip
        if (decrypt(enc) !== v) {
            console.error('  ✗ round-trip failed for', r.project_id);
            process.exit(1);
        }
        queued.push({ id: r.project_id, name: r.project_name, enc });
        console.log('  • will encrypt:', r.project_id, '|', r.project_name,
                    '| plaintext_len=' + v.length, '→ blob_len=' + enc.length);
    }

    console.log('\nSummary:');
    console.log('  total rows with key  :', rows.length);
    console.log('  already encrypted    :', alreadyEncrypted);
    console.log('  placeholders skipped :', placeholders);
    console.log('  to encrypt this run  :', toEncrypt);

    if (!APPLY) {
        console.log('\n[dry-run] no writes performed. Add --apply to commit.');
        await pool.end();
        return;
    }

    if (toEncrypt === 0) {
        console.log('\nNothing to do.');
        await pool.end();
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const q of queued) {
            await client.query(
                'UPDATE tbl_project SET project_api_key = $1 WHERE project_id = $2',
                [q.enc, q.id]);
            console.log('  ✓ updated:', q.id);
        }
        await client.query('COMMIT');
        console.log('\n✓ All', toEncrypt, 'rows encrypted.');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('✗ FAILED — rolled back. Error:', e.message);
        process.exitCode = 1;
    } finally {
        client.release();
    }
    await pool.end();
})().catch(e => { console.error('FATAL:', e); process.exitCode = 1; });
