
const { Client } = require('pg');
require('dotenv').config();

async function createDatabase() {
    // Connect to default 'postgres' database to create the new one
    const connectionString = process.env.DATABASE_URL.replace('/zachi_pos', '/postgres');
    const client = new Client({ connectionString });

    try {
        await client.connect();

        // Check if database exists
        const res = await client.query("SELECT 1 FROM pg_database WHERE datname = 'zachi_pos'");
        if (res.rowCount === 0) {
            console.log('Creating database zachi_pos...');
            await client.query('CREATE DATABASE zachi_pos');
            console.log('Database zachi_pos created successfully.');
        } else {
            console.log('Database zachi_pos already exists.');
        }
    } catch (err) {
        console.error('Error creating database:', err);
    } finally {
        await client.end();
    }
}

createDatabase();
