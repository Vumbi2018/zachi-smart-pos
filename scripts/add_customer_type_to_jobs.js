
const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
    connectionString: process.env.DATABASE_URL
});

async function run() {
    try {
        await client.connect();
        console.log('Connected to database...');

        // Add customer_type column if it doesn't exist
        // Using IF NOT EXISTS is cleaner
        try {
            await client.query(`ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS customer_type VARCHAR(50) DEFAULT 'Walk-in'`);
            console.log('Schema update complete: Added customer_type to job_cards.');
        } catch (e) {
            if (e.code === '42701') { // duplicate_column
                console.log('Column customer_type already exists.');
            } else {
                throw e;
            }
        }

    } catch (err) {
        console.error('Error updating schema:', err);
    } finally {
        await client.end();
    }
}

run();
