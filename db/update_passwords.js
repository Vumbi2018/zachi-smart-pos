
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
require('dotenv').config();

async function updatePasswords() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL
    });

    try {
        await client.connect();

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash('password123', salt);

        console.log(`Generated hash for 'password123': ${hash}`);

        // Update all default users
        const users = ['director', 'cashier1', 'designer1'];
        for (const username of users) {
            const res = await client.query(
                'UPDATE users SET password_hash = $1 WHERE username = $2 RETURNING username',
                [hash, username]
            );
            if (res.rowCount > 0) {
                console.log(`Updated password for ${username}`);
            } else {
                console.log(`User ${username} not found`);
            }
        }

    } catch (err) {
        console.error('Error updating passwords:', err);
    } finally {
        await client.end();
    }
}

updatePasswords();
