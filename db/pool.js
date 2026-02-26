const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  // Prevent connection exhaustion and hanging requests
  max: 10,                   // max simultaneous connections
  idleTimeoutMillis: 30000,  // release idle connections after 30 s
  connectionTimeoutMillis: 5000, // fail fast if no connection available in 5 s
});

// Test connection on startup
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

// Log errors but do NOT exit — transient DB hiccups should not crash the app
pool.on('error', (err) => {
  console.error('❌ PostgreSQL pool error:', err.message);
});

module.exports = pool;
