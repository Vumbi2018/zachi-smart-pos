const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

async function runMigration() {
    try {
        const sqlPath = path.join(__dirname, '../db/migrations/004_notifications.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Running migration: 004_notifications.sql');
        await pool.query(sql);
        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

runMigration();
