const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function fixSchema() {
    try {
        console.log('🔌 Connecting to database...');
        const client = await pool.connect();

        console.log('🔧 Fixing sales table schema...');

        // 1. Add payment_reference column
        await client.query(`
            ALTER TABLE sales 
            ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(100);
        `);
        console.log('✅ Added payment_reference column to sales table.');

        // 2. Create payment_methods table if not exists
        await client.query(`
            CREATE TABLE IF NOT EXISTS payment_methods (
                id SERIAL PRIMARY KEY,
                name VARCHAR(50) UNIQUE NOT NULL,
                type VARCHAR(20) NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                config JSONB DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Created payment_methods table (if not exists).');

        // 3. Seed Payment Methods
        await client.query(`
            INSERT INTO payment_methods (name, type) VALUES 
            ('Cash', 'cash'),
            ('Airtel Money', 'mobile'),
            ('MTN Money', 'mobile'),
            ('Zamtel Money', 'mobile'),
            ('Zanaco', 'bank'),
            ('FNB', 'bank'),
            ('Stanbic', 'bank'),
            ('ABSA', 'bank'),
            ('POS / Swipe', 'card'),
            ('Cheque', 'bank') 
            ON CONFLICT (name) DO NOTHING;
        `);
        console.log('✅ Seeded payment methods.');

        client.release();
        console.log('🚀 Schema fix completed successfully!');
        process.exit(0);

    } catch (err) {
        console.error('❌ Error fixing schema:', err);
        process.exit(1);
    }
}

fixSchema();
