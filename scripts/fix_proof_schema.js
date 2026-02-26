
const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
    connectionString: process.env.DATABASE_URL
});

async function run() {
    try {
        await client.connect();

        // Check column type
        const res = await client.query(`
            SELECT data_type 
            FROM information_schema.columns 
            WHERE table_name = 'job_proofs' AND column_name = 'approved_by'
        `);

        if (res.rows.length > 0) {
            console.log('Current type:', res.rows[0].data_type);

            if (res.rows[0].data_type !== 'character varying') {
                console.log('Altering column to VARCHAR...');
                // we might need to drop FK constraint if it exists
                try {
                    await client.query(`ALTER TABLE job_proofs DROP CONSTRAINT IF EXISTS job_proofs_approved_by_fkey`);
                } catch (e) { console.log('No FK to drop or error dropping FK'); }

                await client.query(`ALTER TABLE job_proofs ALTER COLUMN approved_by TYPE VARCHAR(255) USING approved_by::text`);
                console.log('Column altered successfully.');
            } else {
                console.log('Column is already VARCHAR.');
            }
        } else {
            console.log('Column does not exist. Adding it...');
            await client.query(`ALTER TABLE job_proofs ADD COLUMN approved_by VARCHAR(255)`);
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

run();
