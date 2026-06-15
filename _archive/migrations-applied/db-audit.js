// Phase 5 audit — check schema state before migration
const path = require('path');
require(path.join(__dirname, 'server', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, 'server', '.env') });
const { Pool } = require(path.join(__dirname, 'server', 'node_modules', 'pg'));

const p = new Pool({
    host: process.env.DB_HOST, port: 5432, database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASS,
    connectionTimeoutMillis: 5000,
});

(async () => {
    console.log('═════ Schema audit ═════════════════════════');

    // 1. password column width + sample length
    const pw = await p.query(`
        SELECT character_maximum_length AS max_len
        FROM information_schema.columns
        WHERE table_name='tbl_user' AND column_name='password'`);
    const pwSample = await p.query(`SELECT user_id, username, length(password) AS pw_len, password FROM tbl_user ORDER BY user_id LIMIT 5`);
    console.log('\n[1] tbl_user.password');
    console.log('    Column width: VARCHAR(' + pw.rows[0].max_len + ')');
    console.log('    Sample lengths:');
    pwSample.rows.forEach(r => {
        const head = r.password.substring(0, 7);
        const isBcrypt = /^\$2[aby]\$/.test(r.password);
        console.log('      user_id=' + r.user_id + ' (@' + r.username + ') len=' + r.pw_len + ' starts="' + head + '..." bcrypt=' + isBcrypt);
    });

    // 2. money columns
    const money = await p.query(`
        SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE (table_name='tbl_balance' AND column_name='project_credits')
           OR (table_name='tbl_credits' AND column_name='user_credits')`);
    console.log('\n[2] Money columns');
    money.rows.forEach(r => {
        console.log('    ' + r.table_name + '.' + r.column_name + ' = ' + r.data_type +
            (r.numeric_precision ? ' (' + r.numeric_precision + ',' + r.numeric_scale + ')' : ''));
    });

    // 3. PK status of audit/action logs
    const pks = await p.query(`
        SELECT tc.table_name, kc.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kc
          ON kc.constraint_name = tc.constraint_name
        WHERE tc.constraint_type='PRIMARY KEY'
          AND tc.table_name IN ('tbl_audit_log','tbl_action_admin')
        ORDER BY tc.table_name, kc.ordinal_position`);
    console.log('\n[3] PK columns on audit/action logs');
    const groups = {};
    pks.rows.forEach(r => { (groups[r.table_name] = groups[r.table_name] || []).push(r.column_name); });
    Object.keys(groups).forEach(t => console.log('    ' + t + ' PK: (' + groups[t].join(', ') + ')'));

    // 4. row counts
    console.log('\n[4] Row counts');
    for (const t of ['tbl_audit_log', 'tbl_action_admin', 'tbl_user', 'tbl_balance', 'tbl_credits']) {
        const r = await p.query('SELECT COUNT(*)::int AS c FROM ' + t);
        console.log('    ' + (r.rows[0].c + '').padStart(4) + '  ' + t);
    }

    await p.end();
    console.log('\n═══════════════════════════════════════════');
})();
