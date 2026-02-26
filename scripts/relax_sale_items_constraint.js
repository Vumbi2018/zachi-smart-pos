const pool = require('../db/pool');

async function run() {
    console.log('Relaxing sale_items check constraint...');
    try {
        // Drop the constraint if it exists
        await pool.query(`
            ALTER TABLE sale_items DROP CONSTRAINT IF EXISTS chk_item_type;
        `);
        console.log('Constraint chk_item_type dropped.');
    } catch (err) {
        console.error('Error dropping constraint:', err);
    } finally {
        pool.end();
    }
}

run();
