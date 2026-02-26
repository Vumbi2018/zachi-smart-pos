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
            // Logic for default handled in query or we calculate here
            // Let's calculate purely in SQL or pass explicit default dates?
            // Passing explicit is safer to keep logic consistent.
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

        if (groupBy === 'date') {
            query = `
                SELECT transaction_date::date as date, COUNT(*) as count, SUM(total_amount) as total, SUM(subtotal) as net
                FROM sales s
                ${whereClause}
                GROUP BY transaction_date::date ORDER BY date ASC
            `;
        } else if (groupBy === 'category') {
            query = `
                SELECT p.category, COUNT(si.item_id) as count, SUM(si.line_total) as total
                FROM sale_items si
                JOIN sales s ON si.sale_id = s.sale_id
                JOIN products p ON si.product_id = p.product_id
                ${whereClause}
                GROUP BY p.category ORDER BY total DESC
            `;
        } else if (groupBy === 'product') {
            query = `
                SELECT p.name, p.sku, COUNT(si.item_id) as count, SUM(si.line_total) as total
                FROM sale_items si
                JOIN sales s ON si.sale_id = s.sale_id
                JOIN products p ON si.product_id = p.product_id
                ${whereClause}
                GROUP BY p.name, p.sku ORDER BY total DESC ${format === 'csv' ? '' : 'LIMIT 20'}
            `;
        } else {
            // Detailed transaction list
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
                                'description', si.description,
                                'quantity', si.quantity,
                                'unit_price', si.unit_price,
                                'line_total', si.line_total,
                                'item_type', si.item_type
                            )
                        ) FILTER (WHERE si.item_id IS NOT NULL), 
                        '[]'
                    ) as items
                FROM sales s
                LEFT JOIN users u ON s.staff_id = u.user_id
                LEFT JOIN sale_items si ON s.sale_id = si.sale_id
                ${whereClause} ${req.query.sales_type ? `AND si.item_type = '${req.query.sales_type}'` : ''}
                GROUP BY s.sale_id, u.full_name
                ORDER BY s.transaction_date DESC
                ${format === 'csv' ? '' : 'LIMIT 100'}
            `;
        }

        const result = await pool.query(query, params);

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

        // 2. COGS (Cost of goods sold for those sales - complex, using approximations or linking to batches is better but valid for now)
        // Simple approximation: Sum of (unit_cost * qty) from sale_items
        // We need to join products to get historical cost? Ideally sale_items should store cost_at_sale_time. 
        // Checking schema... sale_items usually has price, but maybe not cost. 
        // If sale_items doesn't have cost, we use current product cost (imperfect).
        // Let's assume current cost for MVP or check if we added cost to sale_items.

        const cogs = await pool.query(`
            SELECT COALESCE(SUM(si.quantity * p.cost_price), 0) as cogs
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.sale_id
            JOIN products p ON si.product_id = p.product_id
            WHERE s.transaction_date >= $1 AND s.transaction_date <= $2 AND s.is_voided = FALSE
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
                SUM(si.quantity * p.cost_price) as cost,
                (SUM(si.line_total) - SUM(si.quantity * p.cost_price)) as gross_profit,
                CASE 
                    WHEN SUM(si.line_total) > 0 
                    THEN ((SUM(si.line_total) - SUM(si.quantity * p.cost_price)) / SUM(si.line_total)) * 100 
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
    getAggregatedSales
};
