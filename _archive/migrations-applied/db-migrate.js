// Apply Phase 5 migration via Node (no psql client needed)
const path = require('path');
const fs   = require('fs');
require(path.join(__dirname, 'server', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, 'server', '.env') });
const { Pool } = require(path.join(__dirname, 'server', 'node_modules', 'pg'));

const SQL_FILE = process.argv[2] || path.join(__dirname, 'server', 'migrations', 'phase5-001-decimal-money.sql');
if (!fs.existsSync(SQL_FILE)) { console.error('Migration file not found: ' + SQL_FILE); process.exit(1); }

const sql = fs.readFileSync(SQL_FILE, 'utf-8');
console.log('▸ Applying ' + path.basename(SQL_FILE));

const pool = new Pool({
    host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASS,
    connectionTimeoutMillis: 8000,
});

(async () => {
    const client = await pool.connect();
    // Capture NOTICE messages from RAISE NOTICE inside DO blocks
    client.on('notice', n => console.log('  [pg]', n.message));
    try {
        const r = await client.query(sql);
        // Some statements return result sets — print last one (verify SELECT)
        if (Array.isArray(r) && r.length > 0) {
            const last = r[r.length - 1];
            if (last.rows && last.rows.length > 0) {
                console.log('\n▸ Verify result:');
                last.rows.forEach(row => {
                    console.log('  ' + JSON.stringify(row));
                });
            }
        } else if (r && r.rows && r.rows.length > 0) {
            console.log('\n▸ Verify result:');
            r.rows.forEach(row => console.log('  ' + JSON.stringify(row)));
        }
        console.log('\n✅ Migration applied successfully');
    } catch (e) {
        console.error('\n❌ Migration FAILED — rolled back: ' + e.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
})();
