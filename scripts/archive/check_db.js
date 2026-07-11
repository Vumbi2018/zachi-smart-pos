const { Pool } = require('pg');
require('dotenv').config({ path: '/var/www/zachipos/.env' });
const pool = new Pool();
pool.query('SELECT * FROM credit_payments LIMIT 1')
    .then(() => console.log('OK - credit_payments exists'))
    .catch(e => console.error('ERROR - credit_payments:', e.message))
    .then(() => pool.query('SELECT cost_price FROM sale_items LIMIT 1'))
    .then(() => console.log('OK - sale_items.cost_price exists'))
    .catch(e => console.error('ERROR - sale_items:', e.message))
    .then(() => pool.query("SELECT * FROM migrations"))
    .then(res => console.log('MIGRATIONS:', res.rows))
    .catch(e => console.error('ERROR - migrations:', e.message))
    .finally(() => pool.end());
