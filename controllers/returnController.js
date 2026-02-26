/**
 * Zachi Smart-POS — Return Controller
 * Returns, exchanges, and store credit
 */
const pool = require('../db/pool');

async function generateReturnNumber() {
    const today = new Date().toLocaleDateString('en-CA').replace(/-/g, '');
    const result = await pool.query("SELECT COUNT(*) AS count FROM returns WHERE return_number LIKE $1", [`RET-${today}-%`]);
    return `RET-${today}-${String(parseInt(result.rows[0].count) + 1).padStart(3, '0')}`;
}

/** GET /api/returns — List returns */
async function listReturns(req, res) {
    try {
        const { status } = req.query;
        let query = `
            SELECT r.*, c.full_name AS customer_name, s.sale_number
            FROM returns r
            LEFT JOIN customers c ON r.customer_id = c.customer_id
            JOIN sales s ON r.original_sale_id = s.sale_id
            WHERE 1=1
        `;
        const params = [];
        if (status) { params.push(status); query += ` AND r.status = $${params.length}`; }
        query += ' ORDER BY r.created_at DESC';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('List returns error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** GET /api/returns/:id — Get return detail */
async function getReturn(req, res) {
    try {
        const result = await pool.query(`
            SELECT r.*, c.full_name AS customer_name, s.sale_number
            FROM returns r
            LEFT JOIN customers c ON r.customer_id = c.customer_id
            JOIN sales s ON r.original_sale_id = s.sale_id
            WHERE r.return_id = $1
        `, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Return not found.' });

        const items = await pool.query(`
            SELECT ri.*, p.name AS product_name
            FROM return_items ri
            LEFT JOIN products p ON ri.product_id = p.product_id
            WHERE ri.return_id = $1
        `, [req.params.id]);

        res.json({ ...result.rows[0], items: items.rows });
    } catch (err) {
        console.error('Get return error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** POST /api/returns — Create return request */
async function createReturn(req, res) {
    try {
        const { original_sale_id, return_type, reason_code, notes, items } = req.body;
        const return_number = await generateReturnNumber();

        // Get customer from original sale
        const sale = await pool.query('SELECT customer_id FROM sales WHERE sale_id = $1', [original_sale_id]);
        const customer_id = sale.rows[0]?.customer_id || null;

        await pool.query('BEGIN');

        let refund_amount = 0;
        const ret = await pool.query(`
            INSERT INTO returns (return_number, original_sale_id, customer_id, return_type, reason_code, notes, processed_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
        `, [return_number, original_sale_id, customer_id, return_type, reason_code, notes, req.user.user_id]);

        for (const item of items) {
            const lineTotal = item.quantity * item.unit_price;
            refund_amount += lineTotal;
            await pool.query(`
                INSERT INTO return_items (return_id, original_item_id, product_id, quantity, unit_price, line_total, restock, condition)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            `, [ret.rows[0].return_id, item.original_item_id, item.product_id, item.quantity, item.unit_price, lineTotal, item.restock !== false, item.condition || 'Good']);
        }

        await pool.query('UPDATE returns SET refund_amount = $1 WHERE return_id = $2', [refund_amount, ret.rows[0].return_id]);

        await pool.query('COMMIT');
        res.status(201).json({ ...ret.rows[0], refund_amount });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Create return error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** PATCH /api/returns/:id/process — Approve and process return */
async function processReturn(req, res) {
    try {
        const { refund_method } = req.body;
        const ret = await pool.query('SELECT * FROM returns WHERE return_id = $1', [req.params.id]);
        if (ret.rows.length === 0) return res.status(404).json({ error: 'Return not found.' });
        if (ret.rows[0].status !== 'Pending') return res.status(400).json({ error: 'Return already processed.' });

        await pool.query('BEGIN');

        // Restock items where applicable
        const items = await pool.query('SELECT * FROM return_items WHERE return_id = $1 AND restock = TRUE', [req.params.id]);
        for (const item of items.rows) {
            await pool.query('UPDATE products SET stock_quantity = stock_quantity + $1, updated_at = NOW() WHERE product_id = $2', [item.quantity, item.product_id]);
            const balance = await pool.query('SELECT stock_quantity FROM products WHERE product_id = $1', [item.product_id]);
            await pool.query(`
                INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_type, reference_id, balance_after, performed_by)
                VALUES ($1, 'RETURN', $2, 'return', $3, $4, $5)
            `, [item.product_id, item.quantity, req.params.id, balance.rows[0].stock_quantity, req.user.user_id]);
        }

        // If store credit, create a store credit record
        if (ret.rows[0].return_type === 'store_credit' && ret.rows[0].customer_id) {
            await pool.query(`
                INSERT INTO store_credits (customer_id, amount, balance, source, source_id, created_by)
                VALUES ($1, $2, $2, 'return', $3, $4)
            `, [ret.rows[0].customer_id, ret.rows[0].refund_amount, req.params.id, req.user.user_id]);
        }

        await pool.query(`
            UPDATE returns SET status = 'Processed', refund_method = $1, approved_by = $2, processed_at = NOW()
            WHERE return_id = $3 RETURNING *
        `, [refund_method, req.user.user_id, req.params.id]);

        await pool.query('COMMIT');
        res.json({ message: 'Return processed successfully.' });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Process return error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** GET /api/returns/sales/search?term=... — Find sale for return */
async function findSale(req, res) {
    try {
        const { term } = req.query;
        if (!term) return res.json([]);

        // Search by Sale Number or Customer Name
        const sales = await pool.query(`
            SELECT s.*, c.full_name AS customer_name 
            FROM sales s 
            LEFT JOIN customers c ON s.customer_id = c.customer_id
            WHERE s.sale_number ILIKE $1 OR c.full_name ILIKE $1
            ORDER BY s.created_at DESC LIMIT 10
        `, [`%${term}%`]);

        res.json(sales.rows);
    } catch (err) {
        console.error('Find sale error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

module.exports = { listReturns, getReturn, createReturn, processReturn, findSale };
