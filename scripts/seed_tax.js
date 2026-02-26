const pool = require('../db/pool');

async function run() {
    try {
        await pool.query(`
            INSERT INTO system_settings (setting_key, setting_value, description) 
            VALUES ('tax.rate', '"0.16"', 'Default VAT Rate') 
            ON CONFLICT (setting_key) DO NOTHING
        `);
        console.log('Tax setting seeded successfully.');
    } catch (err) {
        console.error('Error seeding tax setting:', err);
    } finally {
        pool.end();
    }
}

run();
