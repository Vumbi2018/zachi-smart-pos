const pool = require('../db/pool');

async function verify() {
    try {
        const sales = await pool.query(
            "SELECT sale_number, total_amount, transaction_date::date FROM sales ORDER BY transaction_date"
        );
        console.log('\n=== SALES ===');
        console.table(sales.rows);

        const settings = await pool.query(
            "SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('system.idle_timeout','ai.inventory_alert_days','ai.fraud_void_threshold')"
        );
        console.log('\n=== SYSTEM SETTINGS ===');
        console.table(settings.rows);

        const movements = await pool.query(
            "SELECT im.movement_type, p.name, im.quantity, im.balance_after FROM inventory_movements im JOIN products p ON im.product_id = p.product_id ORDER BY im.created_at"
        );
        console.log('\n=== INVENTORY MOVEMENTS ===');
        console.table(movements.rows);
    } catch (e) {
        console.error(e.message);
    } finally {
        pool.end();
    }
}

verify();
