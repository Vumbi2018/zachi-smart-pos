const pool = require('../db/pool');

/**
 * GET /api/reports/daily-revenue
 * Revenue breakdown by payment method for a given period
 */
async function dailyRevenue(req, res) {
    try {
        const { startDate, endDate } = req.query;
        // Default to today if no dates provided
        const today = new Date().toLocaleDateString('en-CA');
        const start = startDate || today;
        const end = endDate || `${today} 23:59:59`;

        const result = await pool.query(
            `SELECT 
          payment_method,
          COUNT(sale_id) AS total_transactions,
          SUM(total_amount) AS gross_revenue,
          SUM(tax_amount) AS vat_collected,
          SUM(subtotal) AS net_revenue
       FROM sales
       WHERE transaction_date >= $1 AND transaction_date <= $2 AND is_voided = FALSE
       GROUP BY payment_method
       ORDER BY gross_revenue DESC`,
            [start, end]
        );

        const totals = await pool.query(
            `SELECT 
          COUNT(sale_id) AS total_transactions,
          COALESCE(SUM(total_amount), 0) AS gross_revenue,
          COALESCE(SUM(tax_amount), 0) AS vat_collected,
          COALESCE(SUM(subtotal), 0) AS net_revenue
       FROM sales
       WHERE transaction_date >= $1 AND transaction_date <= $2 AND is_voided = FALSE`,
            [start, end]
        );

        res.json({
            date: start === end.split(' ')[0] ? start : `${start} to ${end.split(' ')[0]}`,
            by_payment_method: result.rows,
            totals: totals.rows[0]
        });
    } catch (err) {
        console.error('Revenue report error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * GET /api/reports/daily-profit
 * Net profit (revenue minus expenses) for a period
 */
async function dailyProfit(req, res) {
    try {
        const { startDate, endDate } = req.query;
        const today = new Date().toLocaleDateString('en-CA');
        const start = startDate || today;
        const end = endDate || `${today} 23:59:59`;

        const result = await pool.query(
            `WITH period_sales AS (
          SELECT COALESCE(SUM(total_amount), 0) AS revenue
          FROM sales WHERE transaction_date >= $1 AND transaction_date <= $2 AND is_voided = FALSE
       ),
       period_expenses AS (
          SELECT COALESCE(SUM(amount), 0) AS costs
          FROM expenses WHERE expense_date >= $1 AND expense_date <= $2
       )
       SELECT
          revenue AS total_revenue,
          costs AS total_costs,
          (revenue - costs) AS net_profit
       FROM period_sales, period_expenses`,
            [start, end]
        );

        res.json({ date: start, ...result.rows[0] });
    } catch (err) {
        console.error('Profit report error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * GET /api/reports/low-stock
 */
async function lowStock(req, res) {
    try {
        const result = await pool.query(
            `SELECT product_id, name, category, stock_quantity, reorder_level,
              (reorder_level - stock_quantity) AS shortage
       FROM products
       WHERE stock_quantity <= reorder_level AND is_active = TRUE
       ORDER BY shortage DESC`
        );
        res.json({ alerts: result.rows, count: result.rows.length });
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * GET /api/reports/top-services
 * Most popular/profitable services
 */
async function topServices(req, res) {
    try {
        const { startDate, endDate } = req.query;

        // Default to last 30 days if no dates
        let start, end;
        if (startDate && endDate) {
            start = startDate;
            end = endDate;
        } else {
            // Default to a rolling 30-day window when no dates are supplied.
            // We compute it in JS instead of SQL so the same start/end can be
            // referenced consistently in any further client-side rendering.
            const d = new Date();
            d.setDate(d.getDate() - 30);
            start = d.toISOString().split('T')[0];
            end = new Date().toISOString().split('T')[0] + ' 23:59:59';
        }

        const result = await pool.query(
            `SELECT
          sv.service_name,
          sv.category,
          COUNT(si.item_id) AS total_orders,
          SUM(si.line_total) AS total_revenue
       FROM sale_items si
       JOIN services sv ON si.service_id = sv.service_id
       JOIN sales s ON si.sale_id = s.sale_id
       WHERE si.item_type = 'service'
         AND s.transaction_date >= $1 AND s.transaction_date <= $2
         AND s.is_voided = FALSE
       GROUP BY sv.service_name, sv.category
       ORDER BY total_revenue DESC
       LIMIT 10`,
            [start, end]
        );
        res.json({ services: result.rows });
    } catch (err) {
        console.error('Top services error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * GET /api/reports/production-status
 * Job card status summary
 */
async function productionStatus(req, res) {
    try {
        const result = await pool.query(
            `SELECT
          status,
          COUNT(job_id) AS number_of_jobs,
          MIN(deadline) AS earliest_deadline
       FROM job_cards
       WHERE status != 'Collected'
       GROUP BY status
       ORDER BY earliest_deadline ASC`
        );
        res.json({ statuses: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * GET /api/reports/sales-summary
 * Summary stats for the dashboard
 */
async function salesSummary(req, res) {
    try {
        const { startDate, endDate } = req.query;
        const today = new Date().toLocaleDateString('en-CA');
        const start = startDate || today;
        const end = endDate || `${today} 23:59:59`;

        const sales = await pool.query(
            `SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS total
       FROM sales WHERE transaction_date >= $1 AND transaction_date <= $2 AND is_voided = FALSE`,
            [start, end]
        );

        const pendingJobs = await pool.query(
            "SELECT COUNT(*) AS count FROM job_cards WHERE status NOT IN ('Completed', 'Collected')"
        );

        const lowStockCount = await pool.query(
            'SELECT COUNT(*) AS count FROM products WHERE stock_quantity <= reorder_level AND is_active = TRUE'
        );

        const totalProducts = await pool.query(
            'SELECT COUNT(*) AS count FROM products WHERE is_active = TRUE'
        );

        const totalCustomers = await pool.query(
            'SELECT COUNT(*) AS count FROM customers'
        );

        res.json({
            sales: sales.rows[0], // Renamed from today_sales to generic sales
            pending_jobs: parseInt(pendingJobs.rows[0].count),
            low_stock_items: parseInt(lowStockCount.rows[0].count),
            total_products: parseInt(totalProducts.rows[0].count),
            total_customers: parseInt(totalCustomers.rows[0].count)
        });
    } catch (err) {
        console.error('Sales summary error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}
/**
 * GET /api/reports/service-vs-retail
 * Compare product sales vs service revenue
 */
async function serviceVsRetail(req, res) {
    try {
        const { startDate, endDate } = req.query;
        let start, end;
        if (startDate && endDate) {
            start = startDate;
            end = endDate;
        } else {
            const d = new Date();
            d.setDate(d.getDate() - 30);
            start = d.toISOString().split('T')[0];
            end = new Date().toISOString().split('T')[0] + ' 23:59:59';
        }

        const result = await pool.query(
            `SELECT
              item_type,
              COUNT(si.item_id) AS total_orders,
              COALESCE(SUM(si.line_total), 0) AS total_revenue
           FROM sale_items si
           JOIN sales s ON si.sale_id = s.sale_id
           WHERE s.transaction_date >= $1 AND s.transaction_date <= $2
             AND s.is_voided = FALSE
           GROUP BY item_type`,
            [start, end]
        );

        const retail = result.rows.find(r => r.item_type === 'product') || { total_orders: 0, total_revenue: 0 };
        const service = result.rows.find(r => r.item_type === 'service') || { total_orders: 0, total_revenue: 0 };
        const totalRev = parseFloat(retail.total_revenue) + parseFloat(service.total_revenue);

        res.json({
            retail: { orders: parseInt(retail.total_orders), revenue: parseFloat(retail.total_revenue), pct: totalRev > 0 ? Math.round((parseFloat(retail.total_revenue) / totalRev) * 100) : 0 },
            service: { orders: parseInt(service.total_orders), revenue: parseFloat(service.total_revenue), pct: totalRev > 0 ? Math.round((parseFloat(service.total_revenue) / totalRev) * 100) : 0 },
            total_revenue: totalRev
        });
    } catch (err) {
        console.error('Service vs Retail error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * GET /api/reports/sales
 * Advanced sales reporting with filters
 */
/**
 * GET /api/reports/sales
 * Advanced sales reporting with filters
 */
async function getSalesReports(req, res) {
    try {
        const { startDate, endDate, groupBy, payment_method, service_id, format } = req.query; // groupBy: 'date', 'category', 'product', 'payment_method'

        let query = '';
        const params = [startDate, endDate];
        let paramIndex = 3;

        // Base filter conditions
        let whereClause = 'WHERE s.transaction_date >= $1 AND s.transaction_date <= $2 AND s.is_voided = FALSE';

        if (payment_method) {
            whereClause += ` AND s.payment_method = $${paramIndex}`;
            params.push(payment_method);
            paramIndex++;
        }

        // sales_type is whitelisted up-front — never interpolated into SQL —
        // and only bound as a parameter inside branches that actually JOIN
        // sale_items (date grouping does not, so the filter is meaningless
        // there and we reject with 400 to avoid silent surprise).
        const SALES_TYPE_WHITELIST = new Set(['product', 'service', 'custom']);
        const salesType = req.query.sales_type;
        if (salesType && !SALES_TYPE_WHITELIST.has(String(salesType))) {
            return res.status(400).json({
                error: `Invalid sales_type. Must be one of: ${[...SALES_TYPE_WHITELIST].join(', ')}.`,
            });
        }
        if (salesType && groupBy === 'date') {
            return res.status(400).json({
                error: 'sales_type filter is not supported with groupBy=date.',
            });
        }

        // Helper: append the sales_type clause and bind its parameter only
        // when used. Keeps params.length == placeholder count for every branch.
        const appendSalesType = () => {
            if (!salesType) return '';
            const clause = ` AND si.item_type = $${paramIndex}`;
            params.push(salesType);
            paramIndex++;
            return clause;
        };

        if (groupBy === 'date') {
            query = `
                SELECT transaction_date::date as date, COUNT(*) as count, SUM(total_amount) as total, SUM(subtotal) as net
                FROM sales s
                ${whereClause}
                GROUP BY transaction_date::date ORDER BY date ASC
            `;
        } else if (groupBy === 'category') {
            const stClause = appendSalesType();
            query = `
                SELECT p.category, COUNT(si.item_id) as count, SUM(si.line_total) as total
                FROM sale_items si
                JOIN sales s ON si.sale_id = s.sale_id
                JOIN products p ON si.product_id = p.product_id
                ${whereClause}${stClause}
                GROUP BY p.category ORDER BY total DESC
            `;
        } else if (groupBy === 'product') {
            const stClause = appendSalesType();
            query = `
                SELECT p.name, p.sku, COUNT(si.item_id) as count, SUM(si.line_total) as total
                FROM sale_items si
                JOIN sales s ON si.sale_id = s.sale_id
                JOIN products p ON si.product_id = p.product_id
                ${whereClause}${stClause}
                GROUP BY p.name, p.sku ORDER BY total DESC ${format === 'csv' ? '' : 'LIMIT 20'}
            `;
        } else {
            // Detailed transaction list
            const stClause = appendSalesType();
            query = `
                SELECT 
                    s.sale_id, 
                    s.sale_number, 
                    s.transaction_date, 
                    s.payment_method, 
                    s.total_amount, 
                    s.payment_reference,
                    u.full_name as staff_name,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'item_id', si.item_id,
                                'description', si.description,
                                'quantity', si.quantity,
                                'unit_price', si.unit_price,
                                'line_total', si.line_total,
                                'item_type', si.item_type,
                                'removed_at', si.removed_at,
                                'removed_by', si.removed_by,
                                'removed_by_name', ru.full_name,
                                'removed_reason', si.removed_reason
                            )
                            ORDER BY si.item_id
                        ) FILTER (WHERE si.item_id IS NOT NULL), 
                        '[]'
                    ) as items
                FROM sales s
                LEFT JOIN users u ON s.staff_id = u.user_id
                LEFT JOIN sale_items si ON s.sale_id = si.sale_id
                LEFT JOIN users   ru ON si.removed_by = ru.user_id
                ${whereClause}${stClause}
                GROUP BY s.sale_id, u.full_name
                ORDER BY s.transaction_date DESC
                ${(() => {
                    if (format === 'csv') return '';
                    // v1.0.29: support ?page=N&limit=M for the Daily
                    // Sales "Load more" flow. When `page` is present
                    // we honour it and return a paged envelope further
                    // down. Otherwise the legacy single-shot behaviour
                    // applies — default 100 rows, capped at 5000 so a
                    // director hunting an old sale can widen the
                    // window without losing rows past the first page.
                    const lim = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 100));
                    if (req.query.page) {
                        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
                        const offset = (page - 1) * lim;
                        return `LIMIT ${lim} OFFSET ${offset}`;
                    }
                    return `LIMIT ${lim}`;
                })()}
            `;
        }

        const result = await pool.query(query, params);

        // Paged envelope path — only the detail-mode (no groupBy)
        // branch supports `?page=`. We compute total once per request
        // so the UI can render "Showing N of M" honestly.
        if (!groupBy && req.query.page && format !== 'csv') {
            const lim  = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 100));
            const page = Math.max(1, parseInt(req.query.page, 10) || 1);
            // The detail branch may have appended a `sales_type` bind
            // via appendSalesType(); the count query must mirror that
            // join + filter or the bind count won't match (and the
            // total would be wrong even if it did). We use
            // COUNT(DISTINCT s.sale_id) so the LEFT JOIN doesn't
            // multiply rows.
            const countQuery = salesType
                ? `SELECT COUNT(DISTINCT s.sale_id)::int AS total
                     FROM sales s
                     LEFT JOIN sale_items si ON si.sale_id = s.sale_id
                    ${whereClause} AND si.item_type = $${paramIndex - 1}`
                : `SELECT COUNT(*)::int AS total FROM sales s ${whereClause}`;
            // Params for the count match the detail-query params
            // exactly (same length, same order); the LIMIT/OFFSET are
            // not bound parameters so nothing else to slice off.
            const countResult = await pool.query(countQuery, params);
            return res.json({
                rows: result.rows,
                total: countResult.rows[0].total,
                page,
                limit: lim,
            });
        }

        if (format === 'csv') {
            const rows = result.rows;
            let csvContent = '';

            if (groupBy === 'date') {
                csvContent = 'Date,Count,Total Amount,Net Revenue\n';
                rows.forEach(r => {
                    csvContent += `${new Date(r.date).toLocaleDateString()},${r.count},${r.total},${r.net}\n`;
                });
            } else if (groupBy === 'category') {
                csvContent = 'Category,Items Sold,Total Revenue\n';
                rows.forEach(r => {
                    csvContent += `${r.category},${r.count},${r.total}\n`;
                });
            } else if (groupBy === 'product') {
                csvContent = 'Product,SKU,Items Sold,Total Revenue\n';
                rows.forEach(r => {
                    csvContent += `"${r.name}",${r.sku},${r.count},${r.total}\n`;
                });
            } else {
                // Detailed
                csvContent = 'Sale #,Date,Time,Staff,Payment Method,Reference,Items,Total Amount\n';
                rows.forEach(r => {
                    const d = new Date(r.transaction_date);
                    const dateStr = d.toLocaleDateString();
                    const timeStr = d.toLocaleTimeString();
                    const itemsStr = r.items.map(i => `${i.quantity}x ${i.description}`).join('; ');

                    csvContent += `${r.sale_number},${dateStr},${timeStr},${r.staff_name || 'System'},${r.payment_method},${r.payment_reference || ''},"${itemsStr.replace(/"/g, '""')}",${r.total_amount}\n`;
                });
            }

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="sales_report_${Date.now()}.csv"`);
            return res.send(csvContent);
        }

        res.json(result.rows);
    } catch (err) {
        console.error('Sales Report Error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /api/reports/stock
 * Valuation and slow-moving items
 */
async function getStockReports(req, res) {
    try {
        const { type } = req.query; // 'valuation', 'slow_moving'

        if (type === 'valuation') {
            const result = await pool.query(`
                SELECT 
                    COUNT(*) as total_items, 
                    SUM(stock_quantity) as total_units,
                    SUM(stock_quantity * cost_price) as total_cost_value,
                    SUM(stock_quantity * unit_price) as total_retail_value
                FROM products WHERE is_active = TRUE
             `);
            return res.json(result.rows[0]);
        }

        if (type === 'slow_moving') {
            // Items with stock > 0 but no sales in last 90 days
            const result = await pool.query(`
                SELECT p.product_id, p.name, p.stock_quantity, p.cost_price, MAX(s.transaction_date) as last_sale
                FROM products p
                LEFT JOIN sale_items si ON p.product_id = si.product_id
                LEFT JOIN sales s ON si.sale_id = s.sale_id
                WHERE p.stock_quantity > 0 AND p.is_active = TRUE
                GROUP BY p.product_id, p.name, p.stock_quantity, p.cost_price
                HAVING MAX(s.transaction_date) < NOW() - INTERVAL '90 days' OR MAX(s.transaction_date) IS NULL
                ORDER BY p.stock_quantity DESC LIMIT 50
            `);
            return res.json(result.rows);
        }

        res.json({ error: 'Invalid report type' });
    } catch (err) {
        console.error('Stock Report Error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /api/reports/financials
 * P&L Statement (Approximation)
 */
async function getFinancials(req, res) {
    try {
        const { startDate, endDate } = req.query;

        // 1. Revenue (Sales)
        const sales = await pool.query(`
            SELECT COALESCE(SUM(subtotal), 0) as net_sales, COALESCE(SUM(tax_amount), 0) as tax
            FROM sales 
            WHERE transaction_date >= $1 AND transaction_date <= $2 AND is_voided = FALSE
        `, [startDate, endDate]);

        // 2. COGS — sum quantity * cost_price captured on the sale_item
        // at sale time. (Migration 011 added sale_items.cost_price; rows
        // older than that migration may have NULL cost_price and are
        // counted as zero by COALESCE.)

        const cogs = await pool.query(`
            SELECT COALESCE(SUM(si.quantity * si.cost_price), 0) as cogs
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.sale_id
            WHERE s.transaction_date >= $1 AND s.transaction_date <= $2 AND s.is_voided = FALSE AND si.item_type = 'product'
        `, [startDate, endDate]);

        // 3. Operating Expenses
        const expenses = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM expenses 
            WHERE expense_date >= $1 AND expense_date <= $2
        `, [startDate, endDate]);

        const revenue = parseFloat(sales.rows[0].net_sales);
        const costOfGoods = parseFloat(cogs.rows[0].cogs);
        const operatingExpenses = parseFloat(expenses.rows[0].total);
        const grossProfit = revenue - costOfGoods;
        const netProfit = grossProfit - operatingExpenses;

        res.json({
            revenue,
            cogs: costOfGoods,
            gross_profit: grossProfit,
            expenses: operatingExpenses,
            net_profit: netProfit,
            margin_percent: revenue > 0 ? (grossProfit / revenue) * 100 : 0
        });

    } catch (err) {
        console.error('Financials Error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /api/reports/tax
 * Tax inputs and outputs
 */
async function getTaxReport(req, res) {
    try {
        const { startDate, endDate } = req.query;

        // Output Tax (collected from sales)
        const output = await pool.query(`
            SELECT COALESCE(SUM(tax_amount), 0) as collected
            FROM sales 
            WHERE transaction_date >= $1 AND transaction_date <= $2 AND is_voided = FALSE
        `, [startDate, endDate]);

        // Input Tax (paid on purchases) -> Assuming 16% VAT on POs?
        // Checking purchase_orders schema for tax_amount
        const input = await pool.query(`
            SELECT COALESCE(SUM(tax_amount), 0) as paid
            FROM purchase_orders 
            WHERE created_at >= $1 AND created_at <= $2 AND status = 'Received'
        `, [startDate, endDate]);

        res.json({
            tax_collected: parseFloat(output.rows[0].collected),
            tax_paid: parseFloat(input.rows[0].paid),
            net_tax_payable: parseFloat(output.rows[0].collected) - parseFloat(input.rows[0].paid)
        });

    } catch (err) {
        console.error('Tax Report Error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /api/reports/staff-performance
 */
async function staffPerformance(req, res) {
    try {
        const { startDate, endDate } = req.query;
        const today = new Date().toLocaleDateString('en-CA');
        const start = startDate || today;
        const end = endDate || `${today} 23:59:59`;

        const result = await pool.query(`
            SELECT 
                u.full_name as staff_name,
                COUNT(s.sale_id) as total_transactions,
                COALESCE(SUM(s.total_amount), 0) as total_revenue,
                COALESCE(AVG(s.total_amount), 0) as avg_sale_value
            FROM sales s
            JOIN users u ON s.staff_id = u.user_id
            WHERE s.transaction_date >= $1 AND s.transaction_date <= $2 AND s.is_voided = FALSE
            GROUP BY u.full_name
            ORDER BY total_revenue DESC
        `, [start, end]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /api/reports/customer-insights
 */
async function customerInsights(req, res) {
    try {
        const { startDate, endDate } = req.query;
        const today = new Date().toLocaleDateString('en-CA');
        const start = startDate || today;
        const end = endDate || `${today} 23:59:59`;

        const result = await pool.query(`
            SELECT 
                COALESCE(c.full_name, 'Walk-in') as customer_name,
                COUNT(s.sale_id) as visitation_count,
                COALESCE(SUM(s.total_amount), 0) as total_spent,
                MAX(s.transaction_date) as last_visit
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.customer_id
            WHERE s.transaction_date >= $1 AND s.transaction_date <= $2 AND s.is_voided = FALSE
            GROUP BY c.full_name
            ORDER BY total_spent DESC
            LIMIT 20
        `, [start, end]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /api/reports/category-margin
 */
async function categoryMargin(req, res) {
    try {
        const { startDate, endDate } = req.query;
        const today = new Date().toLocaleDateString('en-CA');
        const start = startDate || today;
        const end = endDate || `${today} 23:59:59`;

        const result = await pool.query(`
            SELECT 
                p.category,
                SUM(si.line_total) as revenue,
                SUM(si.quantity * si.cost_price) as cost,
                (SUM(si.line_total) - SUM(si.quantity * si.cost_price)) as gross_profit,
                CASE 
                    WHEN SUM(si.line_total) > 0 
                    THEN ((SUM(si.line_total) - SUM(si.quantity * si.cost_price)) / SUM(si.line_total)) * 100 
                    ELSE 0 
                END as margin_pct
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.sale_id
            JOIN products p ON si.product_id = p.product_id
            WHERE s.transaction_date >= $1 AND s.transaction_date <= $2 AND s.is_voided = FALSE
            GROUP BY p.category
            ORDER BY gross_profit DESC
        `, [start, end]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /api/reports/hourly-trend
 */
async function hourlyTrend(req, res) {
    try {
        const { startDate, endDate } = req.query;
        const today = new Date().toLocaleDateString('en-CA');
        const start = startDate || today;
        const end = endDate || `${today} 23:59:59`;

        const result = await pool.query(`
            SELECT 
                EXTRACT(HOUR FROM transaction_date) as hour,
                COUNT(*) as transaction_count,
                SUM(total_amount) as revenue
            FROM sales
            WHERE transaction_date >= $1 AND transaction_date <= $2 AND is_voided = FALSE
            GROUP BY hour
            ORDER BY hour ASC
        `, [start, end]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /api/reports/aggregated-sales
 */
async function getAggregatedSales(req, res) {
    try {
        const { type } = req.query; // 'day', 'week', 'month', 'quarter', 'year'
        let dateTrunc = 'day';
        if (['week', 'month', 'quarter', 'year'].includes(type)) {
            dateTrunc = type;
        }

        const result = await pool.query(`
            SELECT 
                DATE_TRUNC($1, transaction_date) as period,
                COUNT(*) as transactions,
                SUM(total_amount) as revenue
            FROM sales
            WHERE is_voided = FALSE
            GROUP BY period
            ORDER BY period ASC
        `, [dateTrunc]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /api/reports/pdf
 * Generate a PDF report for a given type and date range
 * ?type=daily|sales|financials  &startDate=  &endDate=
 */
async function getPdfReport(req, res) {
    try {
        const PDFDocument = require('pdfkit');
        const { type = 'daily', startDate, endDate } = req.query;
        const today = new Date().toLocaleDateString('en-CA');
        const start = startDate || today;
        const end = endDate || `${today} 23:59:59`;
        const endDisplay = endDate || today;

        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="zachipos_report_${type}_${today}.pdf"`);
        doc.pipe(res);

        // ── Header ───────────────────────────────────────────────────────────
        doc.fontSize(20).fillColor('#1B3A5C').text('Zachi Smart-POS', { align: 'center' });
        doc.fontSize(10).fillColor('#666666').text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
        doc.moveDown(0.5);

        const reportTitle = type === 'financials' ? 'Financial Report (P&L)' :
            type === 'sales' ? 'Sales Analysis Report' : 'Daily Summary Report';
        doc.fontSize(14).fillColor('#000000').text(reportTitle, { align: 'center' });
        doc.fontSize(10).fillColor('#666666').text(`Period: ${start} → ${endDisplay}`, { align: 'center' });
        doc.moveTo(40, doc.y + 8).lineTo(555, doc.y + 8).strokeColor('#1B3A5C').lineWidth(1).stroke();
        doc.moveDown(1.5);

        // Helper: draw a simple table
        function drawTable(headers, rows, colWidths) {
            const startX = 40;
            let y = doc.y;
            const rowH = 20;

            // Header row
            doc.fillColor('#1B3A5C').fontSize(9);
            let x = startX;
            headers.forEach((h, i) => {
                doc.rect(x, y, colWidths[i], rowH).fill();
                doc.fillColor('#FFFFFF').text(h, x + 4, y + 5, { width: colWidths[i] - 8, lineBreak: false });
                x += colWidths[i];
            });
            y += rowH;

            // Data rows
            rows.forEach((row, ri) => {
                x = startX;
                doc.fillColor(ri % 2 === 0 ? '#F8FAFC' : '#FFFFFF');
                row.forEach((cell, i) => {
                    doc.rect(x, y, colWidths[i], rowH).fill();
                    doc.fillColor('#1e293b').fontSize(8).text(String(cell), x + 4, y + 5, { width: colWidths[i] - 8, lineBreak: false });
                    x += colWidths[i];
                });
                y += rowH;
                if (y > 750) { doc.addPage(); y = 50; }
            });
            doc.y = y + 10;
        }

        const fmt = (n) => `K ${parseFloat(n || 0).toFixed(2)}`;

        if (type === 'daily') {
            // ── Profit summary ────────────────────────────────────────────────
            const [profit, revenue] = await Promise.all([
                pool.query(`WITH ps AS (SELECT COALESCE(SUM(total_amount),0) AS revenue FROM sales WHERE transaction_date >= $1 AND transaction_date <= $2 AND is_voided=FALSE),
                    pe AS (SELECT COALESCE(SUM(amount),0) AS costs FROM expenses WHERE expense_date >= $1 AND expense_date <= $2)
                    SELECT revenue, costs, (revenue - costs) AS net_profit FROM ps, pe`, [start, end]),
                pool.query(`SELECT payment_method, COUNT(*) AS txn, SUM(total_amount) AS gross FROM sales
                    WHERE transaction_date >= $1 AND transaction_date <= $2 AND is_voided=FALSE
                    GROUP BY payment_method ORDER BY gross DESC`, [start, end])
            ]);
            const p = profit.rows[0];
            doc.fontSize(11).fillColor('#000').text('Summary', { underline: true });
            doc.moveDown(0.3);
            drawTable(
                ['Metric', 'Amount'],
                [
                    ['Total Revenue', fmt(p.revenue)],
                    ['Total Expenses', fmt(p.costs)],
                    ['Net Profit', fmt(p.net_profit)]
                ],
                [350, 165]
            );
            doc.moveDown(0.5);
            doc.fontSize(11).fillColor('#000').text('Revenue by Payment Method', { underline: true });
            doc.moveDown(0.3);
            drawTable(
                ['Payment Method', 'Transactions', 'Amount'],
                revenue.rows.map(r => [r.payment_method.replace('_', ' '), r.txn, fmt(r.gross)]),
                [250, 110, 155]
            );

        } else if (type === 'sales') {
            // ── Sales by product ──────────────────────────────────────────────
            const products = await pool.query(`
                SELECT p.name, p.sku, COUNT(si.item_id) as qty_sold, SUM(si.line_total) as revenue
                FROM sale_items si
                JOIN sales s ON si.sale_id = s.sale_id
                JOIN products p ON si.product_id = p.product_id
                WHERE s.transaction_date >= $1 AND s.transaction_date <= $2 AND s.is_voided=FALSE
                GROUP BY p.name, p.sku ORDER BY revenue DESC`, [start, end]);
            doc.fontSize(11).fillColor('#000').text('Top Products by Revenue', { underline: true });
            doc.moveDown(0.3);
            drawTable(
                ['Product', 'SKU', 'Qty Sold', 'Revenue'],
                products.rows.map(r => [r.name, r.sku || '—', r.qty_sold, fmt(r.revenue)]),
                [240, 80, 70, 125]
            );

        } else if (type === 'financials') {
            // ── P&L ──────────────────────────────────────────────────────────
            const [fin, tax] = await Promise.all([
                pool.query(`
                    SELECT
                        COALESCE(SUM(s.subtotal),0) as revenue,
                        COALESCE((SELECT SUM(si2.quantity * si2.cost_price) FROM sale_items si2 JOIN sales s2 ON si2.sale_id=s2.sale_id WHERE s2.transaction_date>=$1 AND s2.transaction_date<=$2 AND s2.is_voided=FALSE AND si2.item_type='product'),0) as cogs,
                        COALESCE((SELECT SUM(amount) FROM expenses WHERE expense_date>=$1 AND expense_date<=$2),0) as expenses
                    FROM sales s WHERE s.transaction_date>=$1 AND s.transaction_date<=$2 AND s.is_voided=FALSE`, [start, end]),
                pool.query(`SELECT COALESCE(SUM(tax_amount),0) as collected FROM sales WHERE transaction_date>=$1 AND transaction_date<=$2 AND is_voided=FALSE`, [start, end])
            ]);
            const f = fin.rows[0];
            const revenue = parseFloat(f.revenue);
            const cogs = parseFloat(f.cogs);
            const expenses = parseFloat(f.expenses);
            const gross = revenue - cogs;
            const net = gross - expenses;
            drawTable(
                ['Line Item', 'Amount'],
                [
                    ['Net Revenue (excl. tax)', fmt(revenue)],
                    ['Cost of Goods Sold (COGS)', `- ${fmt(cogs)}`],
                    ['Gross Profit', fmt(gross)],
                    ['Operating Expenses', `- ${fmt(expenses)}`],
                    ['NET PROFIT', fmt(net)],
                    ['VAT Collected', fmt(tax.rows[0].collected)],
                ],
                [350, 165]
            );
        }

        doc.end();
    } catch (err) {
        console.error('PDF Report Error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'PDF generation failed' });
    }
}

/**
 * GET /api/reports/profit-margin
 * Granular Profit Margin Report by Product and Category
 */
async function getProfitMarginReport(req, res) {
    try {
        const { startDate, endDate, groupBy } = req.query; // groupBy can be 'product' or 'category'
        const today = new Date().toLocaleDateString('en-CA');
        const start = startDate || today;
        const end = endDate || `${today} 23:59:59`;

        let selectClause, groupClause;

        if (groupBy === 'product') {
            selectClause = 'p.name as item_name, p.category as category_name';
            groupClause = 'p.product_id, p.name, p.category';
        } else {
            selectClause = 'p.category as item_name, p.category as category_name';
            groupClause = 'p.category';
        }

        const query = `
            SELECT 
                ${selectClause},
                SUM(si.quantity) as items_sold,
                SUM(si.line_total) as revenue,
                SUM(si.quantity * si.cost_price) as cogs,
                (SUM(si.line_total) - SUM(si.quantity * si.cost_price)) as gross_profit,
                CASE 
                    WHEN SUM(si.line_total) > 0 
                    THEN ((SUM(si.line_total) - SUM(si.quantity * si.cost_price)) / SUM(si.line_total)) * 100 
                    ELSE 0 
                END as margin_pct
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.sale_id
            JOIN products p ON si.product_id = p.product_id
            WHERE s.transaction_date >= $1 
              AND s.transaction_date <= $2 
              AND s.is_voided = FALSE
              AND si.item_type = 'product'
            GROUP BY ${groupClause}
            ORDER BY gross_profit DESC
        `;

        const result = await pool.query(query, [start, end]);

        // Calculate Totals
        const totals = result.rows.reduce((acc, row) => {
            acc.revenue += parseFloat(row.revenue);
            acc.cogs += parseFloat(row.cogs);
            acc.gross_profit += parseFloat(row.gross_profit);
            return acc;
        }, { revenue: 0, cogs: 0, gross_profit: 0 });

        totals.margin_pct = totals.revenue > 0 ? (totals.gross_profit / totals.revenue) * 100 : 0;

        res.json({
            data: result.rows,
            summary: totals
        });

    } catch (err) {
        console.error('[getProfitMarginReport] Error:', err);
        res.status(500).json({ error: 'Failed to generate profit margin report.' });
    }
}

/**
 * GET /api/reports/dashboard-charts
 * Returns the three datasets the director's dashboard renders as charts:
 *   - sales_trend : revenue per day for the last 14 days
 *   - top_products: top 5 products by revenue (last 30 days)
 *   - payment_mix : revenue grouped by payment method (last 30 days)
 *
 * Single round-trip so the dashboard charts paint in one paint instead of three.
 */
async function dashboardCharts(req, res) {
    try {
        const trendQ = pool.query(`
            SELECT DATE(transaction_date) AS day,
                   COALESCE(SUM(total_amount), 0)::float AS revenue,
                   COUNT(*)::int AS txns
            FROM sales
            WHERE transaction_date >= NOW() - INTERVAL '14 days'
              AND is_voided = FALSE
            GROUP BY DATE(transaction_date)
            ORDER BY day ASC
        `);

        const topProductsQ = pool.query(`
            SELECT COALESCE(p.name, 'Unknown') AS name,
                   COALESCE(SUM(si.line_total), 0)::float AS revenue,
                   COALESCE(SUM(si.quantity), 0)::float AS qty
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.sale_id
            LEFT JOIN products p ON si.product_id = p.product_id
            WHERE s.transaction_date >= NOW() - INTERVAL '30 days'
              AND s.is_voided = FALSE
              AND si.item_type = 'product'
            GROUP BY p.name
            ORDER BY revenue DESC
            LIMIT 5
        `);

        const paymentMixQ = pool.query(`
            SELECT COALESCE(payment_method, 'Other') AS method,
                   COALESCE(SUM(total_amount), 0)::float AS revenue
            FROM sales
            WHERE transaction_date >= NOW() - INTERVAL '30 days'
              AND is_voided = FALSE
            GROUP BY payment_method
            ORDER BY revenue DESC
        `);

        const [trend, topProducts, paymentMix] = await Promise.all([trendQ, topProductsQ, paymentMixQ]);

        // Fill missing days so the line chart doesn't have gaps
        const byDay = new Map(trend.rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), r]));
        const filledTrend = [];
        for (let i = 13; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            const row = byDay.get(key);
            filledTrend.push({
                day: key,
                revenue: row ? Number(row.revenue) : 0,
                txns: row ? Number(row.txns) : 0,
            });
        }

        res.json({
            sales_trend: filledTrend,
            top_products: topProducts.rows,
            payment_mix: paymentMix.rows,
        });
    } catch (err) {
        console.error('Dashboard charts error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * GET /api/reports/line-removals
 *
 * Task #58 — Per-line refund audit report. v1.0.31 introduced the
 * "Remove line" flow which soft-deletes a sale_items row (stamping
 * removed_at / removed_by / removed_reason) and posts a cash refund.
 * Directors need a single place to scan every such removal across a
 * date range — by staff, with totals — so unusual patterns surface
 * without trawling Daily Sales.
 *
 * Query params:
 *   startDate, endDate — required-ish (defaults to today)
 *   staffId            — optional UUID; filters by removed_by
 *
 * Response shape: { rows, totals: { count, refunded, by_tender: [...] } }
 */
async function lineRemovals(req, res) {
    try {
        const { startDate, endDate, staffId } = req.query;
        const today = new Date().toLocaleDateString('en-CA');
        const start = startDate || today;
        // If the caller passed a bare date (no time), extend to end-of-day
        // so same-day removals are not silently dropped at the boundary.
        let end = endDate || `${today} 23:59:59`;
        if (/^\d{4}-\d{2}-\d{2}$/.test(end)) end = `${end} 23:59:59`;

        const params = [start, end];
        let staffFilter = '';
        if (staffId) {
            params.push(staffId);
            staffFilter = ` AND si.removed_by = $${params.length}`;
        }

        const rowsQ = await pool.query(
            `SELECT
                 si.item_id,
                 si.removed_at,
                 si.removed_reason,
                 si.description,
                 si.quantity,
                 si.unit_price,
                 si.line_total      AS refund_amount,
                 s.sale_id,
                 s.sale_number,
                 s.payment_method,
                 ru.user_id         AS removed_by,
                 ru.full_name       AS removed_by_name
             FROM sale_items si
             JOIN sales s     ON si.sale_id    = s.sale_id
             LEFT JOIN users ru ON si.removed_by = ru.user_id
             WHERE si.removed_at IS NOT NULL
               AND si.removed_at >= $1
               AND si.removed_at <= $2
               ${staffFilter}
             ORDER BY si.removed_at DESC`,
            params
        );

        const byTenderQ = await pool.query(
            `SELECT
                 s.payment_method,
                 COUNT(si.item_id)::int          AS count,
                 COALESCE(SUM(si.line_total), 0) AS refunded
             FROM sale_items si
             JOIN sales s ON si.sale_id = s.sale_id
             WHERE si.removed_at IS NOT NULL
               AND si.removed_at >= $1
               AND si.removed_at <= $2
               ${staffFilter}
             GROUP BY s.payment_method
             ORDER BY refunded DESC`,
            params
        );

        const totalRefunded = rowsQ.rows.reduce(
            (sum, r) => sum + parseFloat(r.refund_amount || 0),
            0
        );

        res.json({
            rows: rowsQ.rows,
            totals: {
                count: rowsQ.rows.length,
                refunded: totalRefunded,
                by_tender: byTenderQ.rows,
            },
        });
    } catch (err) {
        console.error('Line removals report error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * GET /api/reports/line-removal-alerts
 * Task #61 — Flag cashiers who remove an unusual number of lines.
 *
 * Compares each staff member's line-removal count over the current
 * "alert window" (default: last 24h) against their personal rolling
 * baseline (default: prior 30 days, excluding the alert window).
 *
 * A cashier is flagged when their current-window count is BOTH:
 *   - ≥ the absolute floor (system setting `reports.line_removal_alert_floor`,
 *     default 5), so we don't shout about 2 vs 0.5/day, AND
 *   - ≥ baselineDaily × multiplier (`reports.line_removal_alert_multiplier`,
 *     default 3), OR baseline is zero and current ≥ floor (new offender).
 *
 * Query params:
 *   windowHours    — current alert window in hours, default 24
 *   baselineDays   — rolling baseline length in days, default 30
 *
 * Response:
 *   {
 *     window: { hours, baselineDays },
 *     thresholds: { floor, multiplier },
 *     alerts: [{
 *       staff_id, staff_name, current_count, current_refunded,
 *       baseline_daily_avg, multiple, severity
 *     }]
 *   }
 */
async function lineRemovalAlerts(req, res) {
    try {
        const windowHours = Math.max(1, parseInt(req.query.windowHours, 10) || 24);
        const baselineDays = Math.max(1, parseInt(req.query.baselineDays, 10) || 30);

        // Read tunables from system_settings (best-effort — fall back to
        // safe defaults if the rows or table aren't present).
        let floor = 5;
        let multiplier = 3;
        try {
            const cfg = await pool.query(
                `SELECT setting_key AS key, setting_value AS value
                   FROM system_settings
                  WHERE setting_key IN ($1, $2)`,
                ['reports.line_removal_alert_floor', 'reports.line_removal_alert_multiplier']
            );
            cfg.rows.forEach(r => {
                if (r.key === 'reports.line_removal_alert_floor') {
                    const n = parseFloat(r.value);
                    if (Number.isFinite(n) && n > 0) floor = n;
                } else if (r.key === 'reports.line_removal_alert_multiplier') {
                    const n = parseFloat(r.value);
                    if (Number.isFinite(n) && n > 0) multiplier = n;
                }
            });
        } catch (_) {
            /* settings table optional — keep defaults */
        }

        // Current window: count + value of removals per cashier.
        const currentQ = await pool.query(
            `SELECT si.removed_by                       AS staff_id,
                    u.full_name                         AS staff_name,
                    COUNT(*)::int                       AS current_count,
                    COALESCE(SUM(si.line_total), 0)::float AS current_refunded
               FROM sale_items si
               JOIN users u ON si.removed_by = u.user_id
              WHERE si.removed_at IS NOT NULL
                AND si.removed_by IS NOT NULL
                AND si.removed_at >= NOW() - ($1 || ' hours')::interval
              GROUP BY si.removed_by, u.full_name`,
            [String(windowHours)]
        );

        if (currentQ.rows.length === 0) {
            return res.json({
                window: { hours: windowHours, baselineDays },
                thresholds: { floor, multiplier },
                alerts: []
            });
        }

        // Rolling baseline: removals per cashier in the prior
        // `baselineDays` window, EXCLUDING the current alert window so a
        // single spike doesn't inflate its own baseline.
        const baselineQ = await pool.query(
            `SELECT si.removed_by                AS staff_id,
                    COUNT(*)::int                AS baseline_count
               FROM sale_items si
              WHERE si.removed_at IS NOT NULL
                AND si.removed_by IS NOT NULL
                AND si.removed_at <  NOW() - ($1 || ' hours')::interval
                AND si.removed_at >= NOW() - (($1)::int + ($2)::int * 24 || ' hours')::interval
              GROUP BY si.removed_by`,
            [String(windowHours), String(baselineDays)]
        );
        const baselineMap = {};
        baselineQ.rows.forEach(r => { baselineMap[r.staff_id] = r.baseline_count; });

        const alerts = [];
        for (const row of currentQ.rows) {
            if (row.current_count < floor) continue;

            const baselineCount = baselineMap[row.staff_id] || 0;
            const baselineDaily = baselineCount / baselineDays;
            // `multiple` is "how many times worse than usual" — compare
            // like-for-like by scaling the baseline daily average up to
            // the same window length as `current_count` (so a 48h window
            // is judged against 2× the daily average, not 1×). Guard
            // against divide-by-zero by treating no-history cashiers as
            // automatically flagged once they cross the floor.
            const baselineForWindow = baselineDaily * (windowHours / 24);
            const multiple = baselineForWindow > 0
                ? row.current_count / baselineForWindow
                : Infinity;

            if (multiple >= multiplier || baselineDaily === 0) {
                alerts.push({
                    staff_id: row.staff_id,
                    staff_name: row.staff_name,
                    current_count: row.current_count,
                    current_refunded: row.current_refunded,
                    baseline_daily_avg: Math.round(baselineDaily * 100) / 100,
                    multiple: Number.isFinite(multiple)
                        ? Math.round(multiple * 10) / 10
                        : null,
                    // High when both the volume and the multiple are large.
                    severity: (row.current_count >= floor * 2
                               && (multiple === Infinity || multiple >= multiplier * 2))
                        ? 'high' : 'medium'
                });
            }
        }

        // Worst offenders first — high severity, then by raw count.
        alerts.sort((a, b) => {
            if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1;
            return b.current_count - a.current_count;
        });

        res.json({
            window: { hours: windowHours, baselineDays },
            thresholds: { floor, multiplier },
            alerts
        });
    } catch (err) {
        console.error('Line removal alerts error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

module.exports = {
    dailyRevenue,
    dailyProfit,
    lowStock,
    topServices,
    productionStatus,
    salesSummary,
    serviceVsRetail,
    getSalesReports,
    getStockReports,
    getFinancials,
    getTaxReport,
    staffPerformance,
    customerInsights,
    categoryMargin,
    hourlyTrend,
    getAggregatedSales,
    getPdfReport,
    getProfitMarginReport,
    dashboardCharts,
    lineRemovals,
    lineRemovalAlerts
};

