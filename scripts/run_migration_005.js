const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

async function runMigration() {
    try {
        const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/005_add_inventory_columns.sql'), 'utf8');
        await pool.query(sql);
        console.log('Migration 005 executed successfully.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        pool.end();
    }
}

runMigration();
