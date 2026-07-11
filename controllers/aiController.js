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
        const settingsRes = await pool.query('SELECT setting_key as key, setting_value as value FROM system_settings WHERE setting_key = $1', ['ai.inventory_alert_days']);
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
        const settingsRes = await pool.query('SELECT setting_key as key, setting_value as value FROM system_settings WHERE setting_key LIKE $1', ['ai.%']);
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

/**
 * GET /api/ai/stock-alerts
 * AI-powered inventory alerts based on sales velocity and urgency scoring.
 */
async function getStockAlerts(req, res) {
    try {
        // 1. Products with sales velocity (sold in last 30 days)
        const velocityQuery = `
            WITH daily_velocity AS (
                SELECT
                    si.product_id,
                    SUM(si.quantity) / 30.0 AS avg_daily_qty,
                    SUM(si.quantity)         AS total_sold_30d
                FROM sale_items si
                JOIN sales s ON si.sale_id = s.sale_id
                WHERE si.item_type = 'product'
                  AND s.transaction_date >= NOW() - INTERVAL '30 days'
                  AND s.is_voided = FALSE
                GROUP BY si.product_id
            )
            SELECT
                p.product_id,
                p.name,
                p.category,
                p.sku,
                p.stock_quantity,
                p.reorder_level,
                p.cost_price,
                p.unit_price,
                ROUND(v.avg_daily_qty::numeric, 2)      AS avg_daily_qty,
                v.total_sold_30d,
                ROUND(
                    CASE WHEN v.avg_daily_qty = 0 THEN 9999
                         ELSE p.stock_quantity / v.avg_daily_qty
                    END::numeric, 1
                )                                        AS days_left
            FROM products p
            JOIN daily_velocity v ON p.product_id = v.product_id
            WHERE p.is_active = TRUE
              AND (
                    p.stock_quantity <= p.reorder_level
                 OR (p.stock_quantity / NULLIF(v.avg_daily_qty, 0)) < 14
              )
            ORDER BY days_left ASC
        `;

        // 2. Zero-velocity items still below reorder level (no recent sales)
        const thresholdQuery = `
            SELECT
                p.product_id, p.name, p.category, p.sku,
                p.stock_quantity, p.reorder_level, p.cost_price, p.unit_price,
                0::numeric AS avg_daily_qty,
                0          AS total_sold_30d,
                9999::numeric AS days_left
            FROM products p
            WHERE p.is_active = TRUE
              AND p.stock_quantity <= p.reorder_level
              AND p.product_id NOT IN (
                    SELECT si.product_id FROM sale_items si
                    JOIN sales s ON si.sale_id = s.sale_id
                    WHERE s.transaction_date >= NOW() - INTERVAL '30 days'
                      AND s.is_voided = FALSE
              )
        `;

        const [velRes, thrRes] = await Promise.all([
            pool.query(velocityQuery),
            pool.query(thresholdQuery)
        ]);

        // Merge & de-duplicate by product_id (velocity results take priority)
        const seen = new Set();
        const rawItems = [...velRes.rows, ...thrRes.rows].filter(item => {
            if (seen.has(item.product_id)) return false;
            seen.add(item.product_id);
            return true;
        });

        // Score, classify and generate recommendations
        const alerts = rawItems.map(item => {
            const daysLeft = parseFloat(item.days_left);
            const velocity = parseFloat(item.avg_daily_qty);
            const shortage = Math.max(0, item.reorder_level - item.stock_quantity);
            const hasVelocity = velocity > 0;

            // Urgency classification
            let urgency;
            if (!hasVelocity) {
                urgency = item.stock_quantity === 0 ? 'CRITICAL' : 'MEDIUM';
            } else if (daysLeft <= 3) {
                urgency = 'CRITICAL';
            } else if (daysLeft <= 7) {
                urgency = 'HIGH';
            } else {
                urgency = 'MEDIUM';
            }

            // Suggested reorder = 30-day demand × 1.5 − current stock (minimum: shortage)
            const suggestedOrder = hasVelocity
                ? Math.max(shortage, Math.ceil(velocity * 30 * 1.5 - item.stock_quantity))
                : Math.max(shortage, item.reorder_level * 2);

            // Natural-language recommendation
            let recommendation;
            if (!hasVelocity && item.stock_quantity === 0) {
                recommendation = `⚠️ Out of stock with no recent sales. Verify if still active or archive this product.`;
            } else if (!hasVelocity) {
                recommendation = `Stock (${item.stock_quantity}) is below reorder level (${item.reorder_level}) but no sales in 30 days. Consider a stock review or updating the reorder level.`;
            } else if (daysLeft <= 1) {
                recommendation = `🚨 Less than 1 day of stock remaining at current rate (${velocity}/day). Order ${suggestedOrder} units immediately.`;
            } else if (daysLeft <= 3) {
                recommendation = `Critical: Only ${daysLeft} days of coverage left. Selling ${velocity} units/day. Order ${suggestedOrder} units to cover the next 45 days.`;
            } else if (daysLeft <= 7) {
                recommendation = `Order ${suggestedOrder} units soon — at ${velocity} units/day you'll run out in ${daysLeft} days.`;
            } else {
                recommendation = `Approaching reorder point. Selling ${velocity} units/day (~${daysLeft} days left). Reordering ${suggestedOrder} units will cover 45 days.`;
            }

            return {
                product_id: item.product_id,
                name: item.name,
                category: item.category || 'Uncategorized',
                sku: item.sku || '—',
                stock_quantity: item.stock_quantity,
                reorder_level: item.reorder_level,
                avg_daily_qty: velocity,
                total_sold_30d: parseInt(item.total_sold_30d),
                days_left: daysLeft >= 9999 ? null : daysLeft,
                urgency,
                suggested_order: suggestedOrder,
                recommendation,
                stock_value: parseFloat(item.cost_price || 0) * item.stock_quantity
            };
        });

        // Sort: CRITICAL → HIGH → MEDIUM, then by days_left ASC
        const urgencyOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
        alerts.sort((a, b) => {
            const uDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
            if (uDiff !== 0) return uDiff;
            return (a.days_left ?? 9999) - (b.days_left ?? 9999);
        });

        res.json({
            alerts,
            summary: {
                critical: alerts.filter(a => a.urgency === 'CRITICAL').length,
                high: alerts.filter(a => a.urgency === 'HIGH').length,
                medium: alerts.filter(a => a.urgency === 'MEDIUM').length,
                total: alerts.length
            }
        });
    } catch (err) {
        console.error('Stock Alerts error:', err);
        res.status(500).json({ error: 'Stock alert engine failed.' });
    }
}

/**
 * GET /api/ai/stock-analysis
 * Returns ALL active products with velocity + urgency scoring for the table view.
 */
async function getStockAnalysis(req, res) {
    try {
        const query = `
            WITH daily_velocity AS (
                SELECT
                    si.product_id,
                    SUM(si.quantity) / 30.0 AS avg_daily_qty,
                    SUM(si.quantity)         AS total_sold_30d
                FROM sale_items si
                JOIN sales s ON si.sale_id = s.sale_id
                WHERE si.item_type = 'product'
                  AND s.transaction_date >= NOW() - INTERVAL '30 days'
                  AND s.is_voided = FALSE
                GROUP BY si.product_id
            )
            SELECT
                p.product_id,
                p.name,
                p.category,
                p.sku,
                p.stock_quantity,
                p.reorder_level,
                p.cost_price,
                p.unit_price,
                COALESCE(ROUND(v.avg_daily_qty::numeric, 2), 0) AS avg_daily_qty,
                COALESCE(v.total_sold_30d, 0)                   AS total_sold_30d,
                ROUND(
                    CASE
                        WHEN COALESCE(v.avg_daily_qty, 0) = 0 THEN NULL
                        ELSE p.stock_quantity / v.avg_daily_qty
                    END::numeric, 1
                ) AS days_left
            FROM products p
            LEFT JOIN daily_velocity v ON p.product_id = v.product_id
            WHERE p.is_active = TRUE
            ORDER BY
                CASE
                    WHEN COALESCE(v.avg_daily_qty,0) = 0 AND p.stock_quantity <= p.reorder_level THEN 0
                    WHEN COALESCE(v.avg_daily_qty,0) > 0 AND (p.stock_quantity / v.avg_daily_qty) <= 3  THEN 1
                    WHEN COALESCE(v.avg_daily_qty,0) > 0 AND (p.stock_quantity / v.avg_daily_qty) <= 7  THEN 2
                    WHEN COALESCE(v.avg_daily_qty,0) > 0 AND (p.stock_quantity / v.avg_daily_qty) <= 14 THEN 3
                    ELSE 4
                END,
                p.name ASC
        `;

        const result = await pool.query(query);

        const products = result.rows.map(item => {
            const velocity = parseFloat(item.avg_daily_qty);
            const daysLeft = item.days_left !== null ? parseFloat(item.days_left) : null;
            const hasVelocity = velocity > 0;
            const belowReorder = item.stock_quantity <= item.reorder_level;

            let urgency;
            if (item.stock_quantity === 0) {
                urgency = 'CRITICAL';
            } else if (!hasVelocity && belowReorder) {
                urgency = 'MEDIUM';
            } else if (hasVelocity && daysLeft !== null && daysLeft <= 3) {
                urgency = 'CRITICAL';
            } else if (hasVelocity && daysLeft !== null && daysLeft <= 7) {
                urgency = 'HIGH';
            } else if (hasVelocity && daysLeft !== null && daysLeft <= 14) {
                urgency = 'MEDIUM';
            } else if (belowReorder) {
                urgency = 'MEDIUM';
            } else {
                urgency = 'OK';
            }

            const shortage = Math.max(0, item.reorder_level - item.stock_quantity);
            const suggestedOrder = urgency !== 'OK'
                ? (hasVelocity
                    ? Math.max(shortage, Math.ceil(velocity * 30 * 1.5 - item.stock_quantity))
                    : Math.max(shortage, item.reorder_level * 2))
                : 0;

            return {
                product_id: item.product_id,
                name: item.name,
                category: item.category || 'Uncategorized',
                sku: item.sku || '—',
                stock_quantity: item.stock_quantity,
                reorder_level: item.reorder_level,
                avg_daily_qty: velocity,
                total_sold_30d: parseInt(item.total_sold_30d),
                days_left: daysLeft,
                urgency,
                suggested_order: suggestedOrder
            };
        });

        res.json({ products, total: products.length });
    } catch (err) {
        console.error('Stock Analysis error:', err);
        res.status(500).json({ error: 'Stock analysis engine failed.' });
    }
}

// =============================================================
// LLM-backed features (Anthropic Claude via Replit AI Integrations)
// =============================================================

const llm = require('../utils/anthropic');

// Schema description we hand to Claude as the system prompt for NL→SQL.
// Keep it concise — only the columns the model is allowed to query.
const SCHEMA_FOR_LLM = `
You generate ONE PostgreSQL SELECT query to answer a user question about a Zambian retail point-of-sale database.

Rules:
- Output ONLY the SQL inside a single \`\`\`sql ... \`\`\` code block. No prose.
- The query MUST start with SELECT (or WITH ... SELECT). NEVER use INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, GRANT, REVOKE, CREATE, COPY, or pg_*.
- ALWAYS add a LIMIT clause (default 50, max 200) unless the question is a single aggregate (SUM, COUNT, AVG).
- Currency is Zambian Kwacha (ZMW). Tax rate is 16% VAT.
- Use ONLY these tables and columns:

products(product_id, barcode, name, description, category, unit_price, cost_price, stock_quantity, reorder_level, unit_of_measure, is_active, created_at)
services(service_id, service_name, category, base_price, unit_measure, is_active, created_at)
customers(customer_id, full_name, phone, email, company_name, customer_type, loyalty_points, created_at)
sales(sale_id, sale_number, customer_id, staff_id, subtotal, tax_amount, discount_amount, total_amount, payment_method, payment_status, amount_paid, change_due, is_voided, transaction_date)
sale_items(item_id, sale_id, item_type, product_id, service_id, description, quantity, unit_price, discount, line_total)
users(user_id, username, full_name, role, is_active)

- ALWAYS exclude voided sales: WHERE is_voided = FALSE.
- For "today" use transaction_date::date = CURRENT_DATE. For "this week" use transaction_date >= date_trunc('week', CURRENT_DATE). Similarly month/year.
- Column-name aliases must use snake_case identifiers.
`.trim();

const FORBIDDEN_SQL = /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|merge|vacuum|analyze|reindex|cluster|do|call|set|reset|listen|notify|begin|commit|rollback|savepoint|lock)\b/i;
const PG_SYSTEM = /\b(pg_[a-z_]+|information_schema|current_user|session_user|current_database|current_setting|version)\b/i;
// Sensitive columns the LLM must never project, even from allowed tables.
const FORBIDDEN_COLUMNS = /\b(password_hash|password|secret|api_key|token|reset_token|2fa_secret|totp_secret)\b/i;
// Whitelist of tables the AI is allowed to query. Anything else => reject.
const ALLOWED_TABLES = new Set([
    'products', 'services', 'customers', 'sales', 'sale_items', 'users',
]);

function extractSql(text) {
    const m = text.match(/```sql\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/);
    return (m ? m[1] : text).trim().replace(/;+\s*$/, '');
}

function extractReferencedTables(sql) {
    // Pull every identifier following FROM or JOIN. Strip schema prefixes ("public.products" → "products").
    const refs = new Set();
    const re = /\b(?:from|join)\s+([a-zA-Z_][\w."]*)/gi;
    let m;
    while ((m = re.exec(sql)) !== null) {
        const raw = m[1].replace(/"/g, '').toLowerCase();
        const tbl = raw.includes('.') ? raw.split('.').pop() : raw;
        refs.add(tbl);
    }
    return refs;
}

function looksSafe(sql) {
    if (!sql || sql.length > 4000) return false;
    if (!/^\s*(with|select)\b/i.test(sql)) return false;
    if (FORBIDDEN_SQL.test(sql)) return false;
    if (PG_SYSTEM.test(sql)) return false;
    if (FORBIDDEN_COLUMNS.test(sql)) return false;
    if (sql.includes(';')) return false; // disallow multi-statement
    if (sql.includes('--') || sql.includes('/*')) return false; // disallow comments (could hide intent)
    // Every referenced table must be in our allowlist.
    const tables = extractReferencedTables(sql);
    if (tables.size === 0) return false;
    for (const t of tables) {
        if (!ALLOWED_TABLES.has(t)) return false;
    }
    return true;
}

/**
 * POST /api/ai/ask
 * Body: { question: string }
 * Natural-language report query. Claude → SQL → execute → NL answer.
 */
async function ask(req, res) {
    if (!llm.isAvailable()) {
        return res.status(503).json({ error: 'AI features are not configured on this server.' });
    }
    const question = (req.body && req.body.question || '').toString().trim();
    if (!question) return res.status(400).json({ error: 'Missing question' });
    if (question.length > 1000) return res.status(400).json({ error: 'Question too long (max 1000 chars)' });

    try {
        // Step 1: NL → SQL
        const sqlText = await llm.ask({
            system: SCHEMA_FOR_LLM,
            messages: [{ role: 'user', content: question }],
            maxTokens: 1024,
        });
        const sql = extractSql(sqlText);
        if (!looksSafe(sql)) {
            console.warn('[AI ask] rejected unsafe SQL for question:', question.slice(0, 120), '| sql:', sql.slice(0, 300));
            return res.status(400).json({
                error: 'Could not generate a safe query for that question. Try rephrasing.',
            });
        }

        // Step 2: Execute inside a READ ONLY transaction so SET LOCAL is honoured
        let rows;
        const client = await pool.connect();
        try {
            await client.query('BEGIN READ ONLY');
            await client.query("SET LOCAL statement_timeout = '8s'");
            const result = await client.query(sql);
            rows = result.rows.slice(0, 200);
            await client.query('COMMIT');
        } catch (qErr) {
            try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
            throw qErr;
        } finally {
            client.release();
        }

        // Step 3: Summarise the result back in plain English
        const sample = JSON.stringify(rows.slice(0, 25), null, 2);
        const answer = await llm.ask({
            system: 'You are a helpful retail-store analyst for a Zambian small business. Answer in 1-3 short sentences. Format Kwacha amounts as "ZMW 1,234.56". Do not show raw JSON.',
            messages: [{
                role: 'user',
                content: `Question: ${question}\n\nQuery results (first ${rows.length} rows):\n${sample}\n\nAnswer plainly.`,
            }],
            maxTokens: 512,
        });

        res.json({
            question,
            sql,
            rows,
            row_count: rows.length,
            answer: answer.trim(),
        });
    } catch (err) {
        console.error('AI ask error:', err.message);
        res.status(500).json({ error: 'AI query failed: ' + (err.message || 'unknown error') });
    }
}

/**
 * POST /api/ai/suggest-product
 * Body: { name: string, description?: string }
 * Suggests category, reorder level, and a price band based on the item name.
 * Useful when staff are typing in a new product — saves data-entry time.
 */
async function suggestProduct(req, res) {
    if (!llm.isAvailable()) {
        return res.status(503).json({ error: 'AI features are not configured on this server.' });
    }
    const name = (req.body && req.body.name || '').toString().trim();
    const description = (req.body && req.body.description || '').toString().trim();
    if (!name) return res.status(400).json({ error: 'Missing name' });

    try {
        // Pull existing categories so the model picks one we already use when possible
        const cats = await pool.query(
            "SELECT category, COUNT(*) AS n FROM products WHERE category IS NOT NULL AND category <> '' GROUP BY category ORDER BY n DESC LIMIT 20"
        );
        const existingCategories = cats.rows.map(r => r.category);

        const system = `You help a Zambian retail point-of-sale system pre-fill product details when staff are adding a new item. Reply in JSON only — no prose, no markdown — with this exact shape:
{
  "category": "<one of the existing categories if it fits, otherwise a new short title-cased category>",
  "unit_of_measure": "<piece|ream|pack|box|meter|roll|kg|litre|bottle>",
  "reorder_level": <integer 1..50 — how many units to keep as safety stock>,
  "suggested_unit_price_zmw": <number, ZMW retail price estimate>,
  "suggested_cost_price_zmw": <number, typical wholesale cost estimate>,
  "notes": "<one short sentence explaining your reasoning>"
}
Existing categories in this store (prefer one of these if a fit): ${JSON.stringify(existingCategories)}.
Currency is Zambian Kwacha (ZMW). For stationery / consumables in Zambia in 2026, prices are roughly: pen K5–25, ream K150–250, exercise book K10–40, USB drive K150–500, ink cartridge K400–1500. Be realistic.`;

        const userMsg = description ? `Product name: ${name}\nDescription: ${description}` : `Product name: ${name}`;
        const text = await llm.ask({
            system,
            messages: [{ role: 'user', content: userMsg }],
            maxTokens: 512,
        });

        // Parse JSON (strip code fences if any)
        const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
        let suggestion;
        try {
            suggestion = JSON.parse(jsonText);
        } catch (e) {
            console.error('AI suggest-product parse failure. Raw:', text);
            return res.status(502).json({ error: 'AI returned invalid JSON' });
        }

        // Light sanity coercion
        const out = {
            category: typeof suggestion.category === 'string' ? suggestion.category.slice(0, 50) : null,
            unit_of_measure: typeof suggestion.unit_of_measure === 'string' ? suggestion.unit_of_measure.slice(0, 20) : 'piece',
            reorder_level: Number.isFinite(+suggestion.reorder_level) ? Math.max(1, Math.min(200, Math.round(+suggestion.reorder_level))) : 10,
            suggested_unit_price_zmw: Number.isFinite(+suggestion.suggested_unit_price_zmw) ? +(+suggestion.suggested_unit_price_zmw).toFixed(2) : null,
            suggested_cost_price_zmw: Number.isFinite(+suggestion.suggested_cost_price_zmw) ? +(+suggestion.suggested_cost_price_zmw).toFixed(2) : null,
            notes: typeof suggestion.notes === 'string' ? suggestion.notes.slice(0, 240) : '',
        };
        res.json(out);
    } catch (err) {
        console.error('AI suggest-product error:', err.message);
        res.status(500).json({ error: 'AI suggestion failed: ' + (err.message || 'unknown error') });
    }
}

module.exports = { getInsights, getFraudAlerts, getStockAlerts, getStockAnalysis, ask, suggestProduct };

