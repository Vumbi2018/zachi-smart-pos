const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function ensureMigrationsTable() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function getExecutedMigrations() {
    const res = await pool.query('SELECT name FROM migrations');
    return new Set(res.rows.map(r => r.name));
}

async function logMigration(name) {
    await pool.query('INSERT INTO migrations (name) VALUES ($1)', [name]);
}

async function migrate() {
    console.log('🔄 Checking database migrations...\n');
    await ensureMigrationsTable();
    const executed = await getExecutedMigrations();

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

    let ranAny = false;

    for (const file of files) {
        if (executed.has(file)) {
            continue; // Skip already executed
        }

        console.log(`  🚀 Executing ${file}...`);
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');

        try {
            await pool.query('BEGIN'); // Transaction
            await pool.query(sql);
            await logMigration(file);
            await pool.query('COMMIT');
            console.log(`  ✅ ${file} applied successfully.`);
            ranAny = true;
        } catch (err) {
            await pool.query('ROLLBACK');
            console.error(`  ❌ ${file} failed: ${err.message}`);
            process.exit(1);
        }
    }

    if (!ranAny) {
        console.log('  ✨ No new migrations to apply.');
    } else {
        console.log('\n✅ Migrations up to date.');
    }
}

async function seed() {
    console.log('\n🌱 Running seed data...\n');

    const seedsDir = path.join(__dirname, 'seeds');
    const files = fs.readdirSync(seedsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

    for (const file of files) {
        console.log(`  🌱 Seeding ${file}...`);
        const filePath = path.join(seedsDir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');

        try {
            await pool.query(sql);
            console.log(`  ✅ ${file}`);
        } catch (err) {
            console.error(`  ❌ ${file}: ${err.message}`);
            // Don't exit on seed error, might be duplicate data
        }
    }

    console.log('\n✅ Seed data process finished.');
}

async function run() {
    const command = process.argv[2];

    try {
        if (command === 'seed') {
            await seed();
        } else if (command === 'fresh') {
            // Drop all tables and re-run
            console.log('🗑️  Dropping all tables...');
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
        DROP TABLE IF EXISTS users CASCADE;
      `);
            console.log('  ✅ All tables dropped.\n');
            await migrate();
            await seed();
        } else {
            await migrate();
            // Optional: seed on migrate if requested, but usually separate
            if (process.argv.includes('--seed')) {
                await seed();
            }
        }
    } catch (err) {
        console.error('Migration framework error:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

run();
