// DEBUG SCRIPT: Check recent sales and DB timezone
// Run with: node scripts/debug-sales.js
const pool = require('../db/pool');

async function debugSales() {
    try {
        // Check DB time and timezone
        const timeRes = await pool.query(
            "SELECT NOW()::text as db_now, NOW() AT TIME ZONE 'UTC' as utc_now, current_setting('TIMEZONE') as timezone"
        );
        console.log('\n=== DB Time Info ===');
        console.log(JSON.stringify(timeRes.rows[0], null, 2));

        // Check the very latest sale
        const latestRes = await pool.query(
            "SELECT sale_id, sale_number, transaction_date, total_amount, is_voided FROM sales ORDER BY sale_id DESC LIMIT 3"
        );
        console.log('\n=== Last 3 Sales in DB ===');
        latestRes.rows.forEach(r => console.log(`ID:${r.sale_id} | ${r.transaction_date} | K${r.total_amount} | voided:${r.is_voided}`));

        // Check for today's sales (local date is 2026-02-21)
        const todayLocal = '2026-02-21';
        const todayRes = await pool.query(
            "SELECT COUNT(*) as count, SUM(total_amount) as total FROM sales WHERE transaction_date::date = $1 AND is_voided = FALSE",
            [todayLocal]
        );
        console.log(`\n=== Sales on ${todayLocal} ===`);
        console.log(JSON.stringify(todayRes.rows[0], null, 2));

        process.exit(0);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
}

debugSales();
