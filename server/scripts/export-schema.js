// ╔═══════════════════════════════════════════════════════════╗
// ║  export-schema.js                                          ║
// ║  Dumps the live PG schema to:                              ║
// ║   - schema.dbml      → paste into dbdiagram.io             ║
// ║   - schema.mmd       → Mermaid (renders natively on GitHub)║
// ║   - schema.txt       → human-readable summary              ║
// ║   - schema.sql       → re-runnable CREATE TABLE / FK / IDX ║
// ╚═══════════════════════════════════════════════════════════╝
//
// Run with:  node scripts/export-schema.js
//
// Outputs are written next to this file under ../schema-exports/.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASS,
});

(async () => {
    const outDir = path.join(__dirname, '..', 'schema-exports');
    fs.mkdirSync(outDir, { recursive: true });

    // 1) Columns per table (only our `tbl_*` namespace)
    const cols = await pool.query(`
        SELECT c.table_name, c.column_name, c.data_type, c.character_maximum_length,
               c.is_nullable, c.column_default, c.ordinal_position
          FROM information_schema.columns c
          JOIN information_schema.tables  t ON t.table_name = c.table_name
         WHERE c.table_schema='public' AND c.table_name LIKE 'tbl_%'
           AND t.table_type='BASE TABLE'
         ORDER BY c.table_name, c.ordinal_position`);

    // 2) PKs
    const pks = await pool.query(`
        SELECT tc.table_name, kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage  kcu
            ON kcu.constraint_name = tc.constraint_name
         WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public'
           AND tc.table_name LIKE 'tbl_%'`);
    const pkSet = new Set(pks.rows.map(r => r.table_name + '.' + r.column_name));

    // 3) FKs
    const fks = await pool.query(`
        SELECT tc.table_name      AS src_table,
               kcu.column_name    AS src_col,
               ccu.table_name     AS dst_table,
               ccu.column_name    AS dst_col,
               rc.update_rule, rc.delete_rule
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage     kcu
            ON kcu.constraint_name = tc.constraint_name
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
          JOIN information_schema.referential_constraints rc
            ON rc.constraint_name = tc.constraint_name
         WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
           AND tc.table_name LIKE 'tbl_%'`);

    // 4) Indexes (non-PK)
    const idx = await pool.query(`
        SELECT t.relname AS table_name, i.relname AS index_name,
               pg_get_indexdef(i.oid) AS def
          FROM pg_class t
          JOIN pg_index ix      ON t.oid = ix.indrelid
          JOIN pg_class i       ON i.oid = ix.indexrelid
          JOIN pg_namespace n   ON n.oid = t.relnamespace
         WHERE n.nspname='public' AND t.relname LIKE 'tbl_%'
           AND NOT ix.indisprimary
         ORDER BY t.relname, i.relname`);

    // === Build per-table column groups ===
    const byTable = {};
    for (const c of cols.rows) {
        if (!byTable[c.table_name]) byTable[c.table_name] = [];
        byTable[c.table_name].push(c);
    }

    // === Emit DBML (https://dbml.dbdiagram.io/home) ===
    let dbml = '// Auto-generated from live PostgreSQL schema\n';
    dbml += '// Paste this entire block at https://dbdiagram.io/d to render the diagram\n\n';
    for (const tbl of Object.keys(byTable).sort()) {
        dbml += `Table ${tbl} {\n`;
        for (const c of byTable[tbl]) {
            const type = c.character_maximum_length
                ? `${c.data_type}(${c.character_maximum_length})`
                : c.data_type;
            const flags = [];
            if (pkSet.has(tbl + '.' + c.column_name)) flags.push('pk');
            if (c.is_nullable === 'NO' && !flags.includes('pk')) flags.push('not null');
            if (c.column_default) flags.push(`default: \`${c.column_default}\``);
            dbml += `  ${c.column_name} ${type}${flags.length ? ' [' + flags.join(', ') + ']' : ''}\n`;
        }
        dbml += '}\n\n';
    }
    dbml += '\n// === Foreign keys ===\n';
    for (const f of fks.rows) {
        dbml += `Ref: ${f.src_table}.${f.src_col} > ${f.dst_table}.${f.dst_col}`;
        if (f.update_rule !== 'NO ACTION' || f.delete_rule !== 'NO ACTION') {
            dbml += ` // ON UPDATE ${f.update_rule}, ON DELETE ${f.delete_rule}`;
        }
        dbml += '\n';
    }
    fs.writeFileSync(path.join(outDir, 'schema.dbml'), dbml);

    // === Emit Mermaid erDiagram ===
    let mmd = 'erDiagram\n';
    for (const tbl of Object.keys(byTable).sort()) {
        mmd += `    ${tbl} {\n`;
        for (const c of byTable[tbl]) {
            const type = c.data_type.replace(/\s+/g, '_');
            const tag  = pkSet.has(tbl + '.' + c.column_name) ? ' PK'
                      : fks.rows.some(f => f.src_table === tbl && f.src_col === c.column_name) ? ' FK'
                      : '';
            const safeName = c.column_name.replace(/[^a-zA-Z0-9_]/g, '_');
            mmd += `        ${type} ${safeName}${tag}\n`;
        }
        mmd += '    }\n';
    }
    for (const f of fks.rows) {
        // Mermaid relationship: many src → one dst
        mmd += `    ${f.dst_table} ||--o{ ${f.src_table} : "${f.src_col}"\n`;
    }
    fs.writeFileSync(path.join(outDir, 'schema.mmd'), mmd);

    // === Emit human-readable summary ===
    let txt = '═════════════════════════════════════════\n';
    txt += 'PetabyteAi DB — schema snapshot ' + new Date().toISOString() + '\n';
    txt += '═════════════════════════════════════════\n\n';
    for (const tbl of Object.keys(byTable).sort()) {
        txt += `\n📋 ${tbl}\n`;
        txt += '─'.repeat(50) + '\n';
        for (const c of byTable[tbl]) {
            const isPk = pkSet.has(tbl + '.' + c.column_name);
            const fkRef = fks.rows.find(f => f.src_table === tbl && f.src_col === c.column_name);
            const tag = isPk ? '🔑' : fkRef ? `🔗 → ${fkRef.dst_table}.${fkRef.dst_col}` : '  ';
            const nul = c.is_nullable === 'NO' ? 'NOT NULL' : 'NULL';
            txt += `  ${tag.padEnd(6)} ${c.column_name.padEnd(28)} ${c.data_type.padEnd(28)} ${nul}\n`;
        }
        const tIdx = idx.rows.filter(i => i.table_name === tbl);
        if (tIdx.length > 0) {
            txt += `   Indexes:\n`;
            tIdx.forEach(i => txt += `     - ${i.index_name}\n`);
        }
    }
    fs.writeFileSync(path.join(outDir, 'schema.txt'), txt);

    // === Emit re-runnable SQL (CREATE TABLE + PK/FK/UNIQUE/CHECK/INDEX + sequences) ===
    // We assemble in the order:
    //   1. CREATE SEQUENCE  (for any owned sequences — must exist before tables that reference them)
    //   2. CREATE TABLE     (cols + inline NOT NULL/DEFAULT/PK)
    //   3. ALTER TABLE add FK / UNIQUE / CHECK
    //   4. CREATE INDEX     (non-PK)
    //   5. INSERT seed data (lookup tables only — tbl_acc_status, tbl_user_role)
    // Output is psql-compatible and order-of-operations safe: re-running on
    // an empty DB will recreate everything in dependency order.

    // 1) sequences owned by any of our tables (one per SERIAL / BIGSERIAL column)
    const seqs = await pool.query(`
        SELECT s.relname AS seq_name,
               c.relname AS owner_table,
               a.attname AS owner_col,
               pg_get_expr(d.adbin, d.adrelid) AS default_expr,
               format_type(a.atttypid, NULL)   AS col_type
          FROM pg_class s
          JOIN pg_depend dep   ON dep.objid = s.oid
          JOIN pg_class c      ON c.oid = dep.refobjid
          JOIN pg_attribute a  ON a.attrelid = c.oid AND a.attnum = dep.refobjsubid
          LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
          JOIN pg_namespace n  ON n.oid = s.relnamespace
         WHERE s.relkind = 'S' AND n.nspname = 'public' AND c.relname LIKE 'tbl_%'
         ORDER BY s.relname`);

    // 2) all named constraints (PK/UNIQUE/CHECK) — FKs already in `fks`
    const constraints = await pool.query(`
        SELECT con.conname,
               cls.relname           AS table_name,
               con.contype,                                -- p=pk, u=unique, c=check
               pg_get_constraintdef(con.oid, true) AS def
          FROM pg_constraint con
          JOIN pg_class cls    ON cls.oid = con.conrelid
          JOIN pg_namespace n  ON n.oid = cls.relnamespace
         WHERE n.nspname='public' AND cls.relname LIKE 'tbl_%'
           AND con.contype IN ('p','u','c')
         ORDER BY cls.relname, con.conname`);

    // Helper: format type with length / precision the way SQL expects
    const fmtType = c => {
        const dt = c.data_type;
        if (dt === 'character varying' && c.character_maximum_length)
            return `VARCHAR(${c.character_maximum_length})`;
        if (dt === 'character' && c.character_maximum_length)
            return `CHAR(${c.character_maximum_length})`;
        // PG returns generic "numeric" without precision in information_schema.columns
        // unless we hit pg_attribute. Good enough for re-import — NUMERIC = unlimited.
        return dt.toUpperCase();
    };

    let sql = '-- ════════════════════════════════════════════════════════════════════\n';
    sql += '-- PetabyteAi DB — re-runnable schema export\n';
    sql += '-- Generated: ' + new Date().toISOString() + '\n';
    sql += '-- Source: ' + (process.env.DB_NAME || '?') + '@' + (process.env.DB_HOST || '?') + ':' + (process.env.DB_PORT || '?') + '\n';
    sql += '--\n';
    sql += '-- Re-import recipe:\n';
    sql += '--   psql -h <host> -U <user> -d <new-db> -f schema.sql\n';
    sql += '-- ════════════════════════════════════════════════════════════════════\n\n';

    // 1) Sequences first
    if (seqs.rowCount > 0) {
        sql += '-- ── Sequences (owned by SERIAL/BIGSERIAL columns) ───────────────────\n';
        for (const s of seqs.rows) {
            sql += `CREATE SEQUENCE IF NOT EXISTS ${s.seq_name};\n`;
        }
        sql += '\n';
    }

    // 2) CREATE TABLE
    sql += '-- ── Tables ──────────────────────────────────────────────────────────\n';
    for (const tbl of Object.keys(byTable).sort()) {
        sql += `\nCREATE TABLE IF NOT EXISTS ${tbl} (\n`;
        const lines = byTable[tbl].map(c => {
            let line = '    ' + c.column_name + ' ' + fmtType(c);
            if (c.column_default) line += ' DEFAULT ' + c.column_default;
            if (c.is_nullable === 'NO') line += ' NOT NULL';
            return line;
        });
        // append PRIMARY KEY inline (PG accepts both inline and out-of-line PK)
        const tblConstr = constraints.rows.filter(k => k.table_name === tbl);
        const pkRow = tblConstr.find(k => k.contype === 'p');
        if (pkRow) lines.push('    CONSTRAINT ' + pkRow.conname + ' ' + pkRow.def);
        // append UNIQUE + CHECK inline too
        for (const k of tblConstr) {
            if (k.contype === 'u' || k.contype === 'c') {
                lines.push('    CONSTRAINT ' + k.conname + ' ' + k.def);
            }
        }
        sql += lines.join(',\n') + '\n);\n';
    }
    sql += '\n';

    // 3) FK constraints — out-of-line because they cross-reference tables
    if (fks.rowCount > 0) {
        sql += '-- ── Foreign keys ────────────────────────────────────────────────────\n';
        // Names taken from information_schema.referential_constraints (not directly
        // queried above; we use a synthetic name derived from src table/col so
        // the FK is recoverable. PG will accept any unique name.)
        for (const f of fks.rows) {
            const cname = `${f.src_table}_${f.src_col}_fkey`;
            sql += `ALTER TABLE ${f.src_table}\n`;
            sql += `    ADD CONSTRAINT ${cname}\n`;
            sql += `    FOREIGN KEY (${f.src_col}) REFERENCES ${f.dst_table}(${f.dst_col})`;
            if (f.update_rule && f.update_rule !== 'NO ACTION') sql += `\n    ON UPDATE ${f.update_rule}`;
            if (f.delete_rule && f.delete_rule !== 'NO ACTION') sql += `\n    ON DELETE ${f.delete_rule}`;
            sql += ';\n';
        }
        sql += '\n';
    }

    // 4) Non-PK indexes
    if (idx.rowCount > 0) {
        sql += '-- ── Indexes (non-PK) ────────────────────────────────────────────────\n';
        for (const i of idx.rows) {
            // pg_get_indexdef already returns a complete CREATE INDEX statement
            sql += i.def + ';\n';
        }
        sql += '\n';
    }

    // 5) Seed data for lookup tables (small, deterministic)
    sql += '-- ── Lookup seed data ────────────────────────────────────────────────\n';
    for (const lookup of ['tbl_acc_status', 'tbl_user_role']) {
        try {
            const rows = await pool.query(`SELECT * FROM ${lookup} ORDER BY 1`);
            if (rows.rowCount === 0) continue;
            const cols = Object.keys(rows.rows[0]);
            for (const r of rows.rows) {
                const vals = cols.map(c => {
                    const v = r[c];
                    if (v === null) return 'NULL';
                    if (typeof v === 'number') return v;
                    return "'" + String(v).replace(/'/g, "''") + "'";
                });
                sql += `INSERT INTO ${lookup} (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT DO NOTHING;\n`;
            }
        } catch (e) {
            sql += `-- skipped ${lookup}: ${e.message}\n`;
        }
    }

    fs.writeFileSync(path.join(outDir, 'schema.sql'), sql);

    // === Emit a drawsql.app-friendly variant ============================
    // drawsql.app's parser is strict. The full re-runnable schema.sql
    // contains PG-specific bits that confuse it:
    //   - nextval('seq'::regclass) default expressions
    //   - CREATE SEQUENCE statements
    //   - Partial-index `WHERE` clauses
    //   - CHECK constraints with ::text[] casts
    //   - CREATE TABLE IF NOT EXISTS  (their parser wants plain CREATE TABLE)
    //   - Separate ALTER TABLE … ADD FOREIGN KEY (works but inline is cleaner)
    // This variant strips all of the above and inlines FKs inside CREATE TABLE
    // so the parser produces a clean ERD on first import.
    let drawsql = '-- ════════════════════════════════════════════════════════════════════\n';
    drawsql += '-- PetabyteAi DB — drawsql.app import format\n';
    drawsql += '-- Generated: ' + new Date().toISOString() + '\n';
    drawsql += '--\n';
    drawsql += '-- How to use:\n';
    drawsql += '--   1) Open https://drawsql.app/teams/<you>/diagrams/new\n';
    drawsql += '--   2) Choose "Import from SQL"  →  Database: PostgreSQL\n';
    drawsql += '--   3) Paste this entire file and import.\n';
    drawsql += '-- ════════════════════════════════════════════════════════════════════\n\n';

    for (const tbl of Object.keys(byTable).sort()) {
        drawsql += `CREATE TABLE ${tbl} (\n`;
        const tblConstr = constraints.rows.filter(k => k.table_name === tbl);
        const pkRow    = tblConstr.find(k => k.contype === 'p');
        const pkCols   = pkRow
            ? (pkRow.def.match(/\((.*?)\)/) || [])[1]?.split(',').map(s => s.trim()) || []
            : [];

        const lines = byTable[tbl].map(c => {
            let line = '    ' + c.column_name + ' ' + fmtType(c);
            // Skip nextval() defaults — drawsql can infer SERIAL from being PK + integer.
            // Keep CURRENT_DATE / now() / static defaults since they parse cleanly.
            if (c.column_default && !/nextval\(/.test(c.column_default)) {
                line += ' DEFAULT ' + c.column_default;
            }
            if (c.is_nullable === 'NO') line += ' NOT NULL';
            // Inline PK marker for single-column PKs — drawsql parses this best.
            if (pkCols.length === 1 && pkCols[0] === c.column_name) line += ' PRIMARY KEY';
            return line;
        });

        // Multi-column PK goes as a table-level constraint
        if (pkCols.length > 1) {
            lines.push(`    PRIMARY KEY (${pkCols.join(', ')})`);
        }

        // Inline FKs (one per column) — much friendlier to drawsql than ALTER TABLE
        const tblFks = fks.rows.filter(f => f.src_table === tbl);
        for (const f of tblFks) {
            let ref = `    FOREIGN KEY (${f.src_col}) REFERENCES ${f.dst_table}(${f.dst_col})`;
            if (f.delete_rule && f.delete_rule !== 'NO ACTION') ref += ` ON DELETE ${f.delete_rule}`;
            if (f.update_rule && f.update_rule !== 'NO ACTION') ref += ` ON UPDATE ${f.update_rule}`;
            lines.push(ref);
        }

        // Skip CHECK constraints + UNIQUE — drawsql doesn't render them anyway
        // and the ::text[] casts in our CHECK defs trip its parser.

        drawsql += lines.join(',\n') + '\n);\n\n';
    }

    fs.writeFileSync(path.join(outDir, 'schema-drawsql.sql'), drawsql);

    console.log('✓ wrote', outDir + path.sep + 'schema.dbml');
    console.log('✓ wrote', outDir + path.sep + 'schema.mmd');
    console.log('✓ wrote', outDir + path.sep + 'schema.txt');
    console.log('✓ wrote', outDir + path.sep + 'schema.sql');
    console.log('✓ wrote', outDir + path.sep + 'schema-drawsql.sql');
    console.log();
    console.log('Next steps:');
    console.log('  • dbml → paste at https://dbdiagram.io/d');
    console.log('  • mmd  → renders natively on GitHub or VS Code Mermaid preview');
    console.log('  • txt  → quick read in any editor');
    console.log('  • sql  → re-import with: psql -h <host> -U <user> -d <db> -f schema.sql');
    console.log('  • schema-drawsql.sql → paste at drawsql.app (Import from SQL → PostgreSQL)');

    await pool.end();
})();
