const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('./pool');

/**
 * One-off shim: existing production databases recorded the colliding
 * filenames `004_enterprise_skeleton.sql`, `004_notifications.sql`,
 * `005_add_inventory_columns.sql`, `005_system_settings.sql`. Those
 * files were renamed to use a/b suffixes so directory ordering is
 * deterministic. This shim updates the migrations table so the renamed
 * files are not re-applied on existing deployments.
 */
const RENAME_SHIM = {
    '004_enterprise_skeleton.sql': '004a_enterprise_skeleton.sql',
    '004_notifications.sql': '004b_notifications.sql',
    '005_add_inventory_columns.sql': '005a_add_inventory_columns.sql',
    '005_system_settings.sql': '005b_system_settings.sql',
    // v1.0.14 had two parallel branches both numbered 020. The
    // banking-details branch shipped first to dev as 020; the
    // manual-invoices branch was authored as 020 too. To resolve the
    // collision the banking file was renamed to 021, and any DB that
    // already recorded the old name needs a one-shot rename.
    '020_banking_details.sql': '021_banking_details.sql',
};

function sha256(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

const RECOVERED_CHECKSUM_ALIASES = {
    '011b_convert_to_uuid.sql': new Set([
        '0d25614b6ab838368203543130e377c0e347cd9d6374263fba3d7c596fb32d5e',
    ]),
    '028_fix_invoice_items_types.sql': new Set([
        '6ddf554392c2f1490af574b88d25e9c27dc05063b83e3d8c4d340ea0303f45f4',
    ]),
};

/**
 * Split a SQL file on top-level `;` while respecting:
 *   - single-quoted strings ('...')
 *   - PostgreSQL dollar-quoted strings ($$...$$ and $tag$...$tag$)
 *   - line comments (-- ...)
 *   - block comments (/* ... *\/)
 * Statements are returned trimmed; empty statements are dropped.
 *
 * Exported for unit tests.
 */
function splitSqlStatements(sql) {
    const statements = [];
    let buf = '';
    let i = 0;
    const n = sql.length;

    while (i < n) {
        const ch = sql[i];
        const next = sql[i + 1];

        // Line comment
        if (ch === '-' && next === '-') {
            const eol = sql.indexOf('\n', i);
            const stop = eol === -1 ? n : eol;
            buf += sql.slice(i, stop);
            i = stop;
            continue;
        }
        // Block comment
        if (ch === '/' && next === '*') {
            const close = sql.indexOf('*/', i + 2);
            const stop = close === -1 ? n : close + 2;
            buf += sql.slice(i, stop);
            i = stop;
            continue;
        }
        // Single-quoted string (with '' as escape)
        if (ch === "'") {
            buf += ch;
            i += 1;
            while (i < n) {
                buf += sql[i];
                if (sql[i] === "'" && sql[i + 1] === "'") {
                    buf += sql[i + 1];
                    i += 2;
                    continue;
                }
                if (sql[i] === "'") {
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }
        // Dollar-quoted string: $tag$ ... $tag$  (tag may be empty)
        if (ch === '$') {
            const tagMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
            if (tagMatch) {
                const fullTag = tagMatch[0];
                buf += fullTag;
                i += fullTag.length;
                const end = sql.indexOf(fullTag, i);
                if (end === -1) {
                    // Unterminated dollar quote - append the rest verbatim
                    buf += sql.slice(i);
                    i = n;
                } else {
                    buf += sql.slice(i, end + fullTag.length);
                    i = end + fullTag.length;
                }
                continue;
            }
        }
        // Statement terminator
        if (ch === ';') {
            const trimmed = buf.trim();
            if (trimmed) statements.push(trimmed);
            buf = '';
            i += 1;
            continue;
        }
        buf += ch;
        i += 1;
    }

    const tail = buf.trim();
    if (tail) statements.push(tail);
    return statements;
}

async function ensureMigrationsTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS migrations (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) UNIQUE NOT NULL,
            checksum CHAR(64),
            executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
    // Backfill column on legacy DBs that pre-date the checksum addition.
    await pool.query(`ALTER TABLE migrations ADD COLUMN IF NOT EXISTS checksum CHAR(64);`);
}

async function applyRenameShim() {
    for (const [oldName, newName] of Object.entries(RENAME_SHIM)) {
        await pool.query(
            `UPDATE migrations
             SET name = $1
             WHERE name = $2
               AND NOT EXISTS (SELECT 1 FROM migrations WHERE name = $1)`,
            [newName, oldName]
        );
    }
}

async function getExecutedMigrations() {
    const res = await pool.query('SELECT name, checksum FROM migrations');
    const map = new Map();
    for (const row of res.rows) map.set(row.name, row.checksum);
    return map;
}

async function migrate() {
    console.log('[migrate] Checking database migrations...\n');
    await ensureMigrationsTable();
    await applyRenameShim();
    const executed = await getExecutedMigrations();

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

    let ranAny = false;

    for (const file of files) {
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');
        const checksum = sha256(sql);

        if (executed.has(file)) {
            const stored = executed.get(file);
            // Backfill checksum for legacy rows that were applied before we tracked it.
            if (!stored) {
                await pool.query(
                    'UPDATE migrations SET checksum = $1 WHERE name = $2 AND checksum IS NULL',
                    [checksum, file]
                );
                continue;
            }
            if (stored !== checksum) {
                const aliases = RECOVERED_CHECKSUM_ALIASES[file];
                if (aliases && aliases.has(stored)) {
                    console.warn(
                        `  [warn] ${file} matches a trusted recovered historical checksum; ` +
                            'normalizing to the current migration checksum.'
                    );
                    await pool.query(
                        'UPDATE migrations SET checksum = $1 WHERE name = $2',
                        [checksum, file]
                    );
                    continue;
                }
                console.error(
                    `\n[error] Migration checksum mismatch for ${file}.\n` +
                        `   Stored:   ${stored}\n` +
                        `   On disk:  ${checksum}\n` +
                        `   Applied migrations are immutable. Restore the original file or\n` +
                        `   write a new follow-on migration instead of editing this one.\n`
                );
                process.exit(1);
            }
            continue;
        }

        console.log(`  [run] Executing ${file}...`);

        const statements = splitSqlStatements(sql);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const stmt of statements) {
                await client.query(stmt);
            }
            await client.query(
                'INSERT INTO migrations (name, checksum) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum',
                [file, checksum]
            );
            await client.query('COMMIT');
            console.log(`  [ok] ${file} applied successfully (${statements.length} stmts).`);
            ranAny = true;
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            console.error(`  [error] ${file} failed: ${err.message}`);
            client.release();
            process.exit(1);
        } finally {
            client.release();
        }
    }

    if (!ranAny) console.log('  [ok] No new migrations to apply.');
    else console.log('\n[ok] Migrations up to date.');
}

async function seed() {
    console.log('\n[seed] Running seed data...\n');

    const seedsDir = path.join(__dirname, 'seeds');
    if (!fs.existsSync(seedsDir)) {
        console.log('  (no seeds directory)');
        return;
    }
    const files = fs
        .readdirSync(seedsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

    for (const file of files) {
        console.log(`  [seed] Seeding ${file}...`);
        const filePath = path.join(seedsDir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');
        try {
            await pool.query(sql);
            console.log(`  [ok] ${file}`);
        } catch (err) {
            console.error(`  [error] ${file}: ${err.message}`);
            // Don't exit on seed error - rows may already exist (idempotent seeds).
        }
    }

    console.log('\n[ok] Seed data process finished.');
}

async function run() {
    const command = process.argv[2];

    try {
        if (command === 'seed') {
            await seed();
        } else if (command === 'fresh') {
            if (process.env.NODE_ENV === 'production') {
                console.error('[error] Refusing to run "fresh" in production.');
                process.exit(1);
            }
            console.log('[fresh] Dropping all tables...');
            await pool.query(`
                DROP TABLE IF EXISTS migrations CASCADE;
                DROP VIEW IF EXISTS v_daily_profit CASCADE;
                DROP TABLE IF EXISTS audit_logs CASCADE;
                DROP TABLE IF EXISTS expenses CASCADE;
                DROP TABLE IF EXISTS job_cards CASCADE;
                DROP TABLE IF EXISTS sale_items CASCADE;
                DROP TABLE IF EXISTS sales CASCADE;
                DROP TABLE IF EXISTS customers CASCADE;
                DROP TABLE IF EXISTS services CASCADE;
                DROP TABLE IF EXISTS products CASCADE;
                DROP TABLE IF EXISTS role_permissions CASCADE;
                DROP TABLE IF EXISTS permissions CASCADE;
                DROP TABLE IF EXISTS password_reset_tokens CASCADE;
                DROP TABLE IF EXISTS users CASCADE;
            `);
            console.log('  [ok] All tables dropped.\n');
            await migrate();
            await seed();
        } else {
            await migrate();
            if (process.argv.includes('--seed')) await seed();
        }
    } catch (err) {
        console.error('Migration framework error:', err);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    run();
}

module.exports = { migrate, seed, RENAME_SHIM, splitSqlStatements };



