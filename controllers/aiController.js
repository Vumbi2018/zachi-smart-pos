const pool = require('../db/pool');

/**
 * Zachi-AI Intelligence Controller
 * Provides smart insights, anomaly detection, and fraud monitoring.
 */

/**
 * GET /api/ai/insights
 * Returns general business insights and trends.
 */
async function getInsights(req, res) {
    try {
        // 1. Trend Analysis: Compare last 7 days to previous 7 days
        const trendsQuery = `
            WITH current_period AS (
                SELECT COALESCE(SUM(total_amount), 0) as total
                FROM sales 
                WHERE transaction_date >= NOW() - INTERVAL '7 days' AND is_voided = FALSE
            ),
            previous_period AS (
                SELECT COALESCE(SUM(total_amount), 0) as total
                FROM sales 
                WHERE transaction_date >= NOW() - INTERVAL '14 days' 
                  AND transaction_date < NOW() - INTERVAL '7 days' 
                  AND is_voided = FALSE
            )
            SELECT 
                c.total as current_total, 
                p.total as previous_total,
                CASE 
                    WHEN p.total = 0 THEN 100 
                    ELSE ((c.total - p.total) / p.total) * 100 
                END as growth_pct
            FROM current_period c, previous_period p
        `;
        const trends = await pool.query(trendsQuery);

        // Fetch Configuration
        const settingsRes = await pool.query('SELECT key, value FROM settings WHERE key = $1', ['ai.inventory_alert_days']);
        const alertThreshold = settingsRes.rows.length > 0 ? parseInt(settingsRes.rows[0].value) : 7;

        // 2. Predictive Inventory: Days of Coverage
        // Logic: Avg daily sales (last 30 days) vs Current Stock
        const stockPredictQuery = `
            WITH daily_velocity AS (
                SELECT 
                    product_id, 
                    SUM(quantity) / 30.0 as avg_daily_qty
                FROM sale_items si
                JOIN sales s ON si.sale_id = s.sale_id
                WHERE si.item_type = 'product' 
                  AND s.transaction_date >= NOW() - INTERVAL '30 days'
                  AND s.is_voided = FALSE
                GROUP BY product_id
            )
            SELECT 
                p.product_id, 
                p.name, 
                p.stock_quantity,
                v.avg_daily_qty,
                CASE 
                    WHEN v.avg_daily_qty = 0 THEN 999
                    ELSE (p.stock_quantity / v.avg_daily_qty)
                END as days_left
            FROM products p
            JOIN daily_velocity v ON p.product_id = v.product_id
            WHERE p.is_active = TRUE AND (p.stock_quantity / v.avg_daily_qty) < ${alertThreshold}
            ORDER BY days_left ASC
            LIMIT 5
        `;
        const stockPredictions = await pool.query(stockPredictQuery);

        res.json({
            sales_trend: trends.rows[0],
            stock_alerts: stockPredictions.rows,
            summary: `Sales are ${trends.rows[0].growth_pct >= 0 ? 'up' : 'down'} by ${Math.abs(Math.round(trends.rows[0].growth_pct))}% compared to last week.`
        });
    } catch (err) {
        console.error('AI Insights error:', err);
        res.status(500).json({ error: 'AI engine failed to compute insights.' });
    }
}

/**
 * GET /api/ai/fraud-alerts
 * Monitors for suspicious activity.
 */
async function getFraudAlerts(req, res) {
    try {
        const alerts = [];

        // Fetch Configuration
        const settingsRes = await pool.query('SELECT key, value FROM settings WHERE key LIKE $1', ['ai.%']);
        const settings = {};
        settingsRes.rows.forEach(r => settings[r.key] = r.value);

        const voidThreshold = parseInt(settings['ai.fraud_void_threshold']) || 3;
        const hoursStart = parseInt(settings['ai.after_hours_start']) || 22;
        const hoursEnd = parseInt(settings['ai.after_hours_end']) || 6;

        // 1. Void Monitoring
        const voidsQuery = `
            SELECT 
                u.full_name, 
                COUNT(*) as void_count,
                (SELECT COUNT(*) FROM sales s2 WHERE s2.staff_id = s.staff_id) as total_sales
            FROM sales s
            JOIN users u ON s.staff_id = u.user_id
            WHERE s.is_voided = TRUE 
              AND s.transaction_date >= NOW() - INTERVAL '24 hours'
            GROUP BY u.full_name, s.staff_id
            HAVING COUNT(*) > ${voidThreshold} -- Threshold for alert
        `;
        const voidAlerts = await pool.query(voidsQuery);
        voidAlerts.rows.forEach(row => {
            alerts.push({
                type: 'HIGH_VOIDS',
                severity: 'medium',
                message: `${row.full_name} has voided ${row.void_count} sales today (${Math.round((row.void_count / row.total_sales) * 100)}% of their total).`
            });
        });

        // 2. After-Hours Activity
        const afterHoursQuery = `
            SELECT sale_number, transaction_date, total_amount, u.full_name
            FROM sales s
            JOIN users u ON s.staff_id = u.user_id
            WHERE (EXTRACT(HOUR FROM transaction_date) >= ${hoursStart} OR EXTRACT(HOUR FROM transaction_date) < ${hoursEnd})
              AND transaction_date >= NOW() - INTERVAL '24 hours'
        `;
        const afterHours = await pool.query(afterHoursQuery);
        afterHours.rows.forEach(row => {
            alerts.push({
                type: 'AFTER_HOURS',
                severity: 'high',
                message: `Transaction ${row.sale_number} (K${row.total_amount}) recorded at ${new Date(row.transaction_date).toLocaleTimeString()} by ${row.full_name}.`
            });
        });

        res.json({ alerts });
    } catch (err) {
        console.error('Fraud detection error:', err);
        res.status(500).json({ error: 'Fraud detection engine failed.' });
    }
}

module.exports = { getInsights, getFraudAlerts };
