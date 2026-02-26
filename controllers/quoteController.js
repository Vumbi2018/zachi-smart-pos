const pool = require('../db/pool');

/**
 * GET /api/quotes
 * List quotes with filters
 */
async function listQuotes(req, res) {
    try {
        const { status, search } = req.query;
        let query = `
            SELECT q.*, c.full_name as customer_name 
            FROM quotes q
            LEFT JOIN customers c ON q.customer_id = c.customer_id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            params.push(status);
            query += ` AND q.status = $${params.length}`;
        }

        if (search) {
            params.push(`%${search}%`);
            query += ` AND (q.quote_number ILIKE $${params.length} OR c.full_name ILIKE $${params.length})`;
        }

        query += ` ORDER BY q.created_at DESC LIMIT 50`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('List quotes error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * GET /api/quotes/:id
 * Get single quote details with items
 */
async function getQuote(req, res) {
    try {
        const { id } = req.params;
        const quote = await pool.query(`
            SELECT q.*, c.full_name as customer_name, c.email, c.phone 
            FROM quotes q
            LEFT JOIN customers c ON q.customer_id = c.customer_id
            WHERE q.quote_id = $1
        `, [id]);

        if (quote.rows.length === 0) return res.status(404).json({ error: 'Quote not found' });

        const items = await pool.query('SELECT * FROM quote_items WHERE quote_id = $1', [id]);

        res.json({ ...quote.rows[0], items: items.rows });
    } catch (err) {
        console.error('Get quote error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * POST /api/quotes
 * Create a new quote
 */
async function createQuote(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { customer_id, items, notes, valid_until } = req.body;
        // items: [{ type, product_id, service_id, description, quantity, unit_price, discount }]

        // Generate Quote Number
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const countRes = await client.query("SELECT COUNT(*) FROM quotes WHERE created_at::date = CURRENT_DATE");
        const count = parseInt(countRes.rows[0].count) + 1;
        const quoteNumber = `QTE-${dateStr}-${String(count).padStart(3, '0')}`;

        let subtotal = 0;
        let taxTotal = 0;
        let discountTotal = 0;

        // Create Quote Header
        const quoteRes = await client.query(`
            INSERT INTO quotes (quote_number, customer_id, notes, valid_until, created_by)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING quote_id
        `, [quoteNumber, customer_id, notes, valid_until, req.user.user_id]);

        const quoteId = quoteRes.rows[0].quote_id;

        // Process Items
        for (const item of items) {
            const qty = parseFloat(item.quantity) || 1;
            const price = parseFloat(item.unit_price) || 0;
            const discount = parseFloat(item.discount) || 0;
            const lineTotal = (price * qty) - discount;

            subtotal += lineTotal;
            // Assuming tax is excluded in unit_price for quotes calculation simplicity here, or handled by frontend.
            // Custom helper to get tax rate
            const taxRes = await client.query("SELECT setting_value FROM system_settings WHERE setting_key = 'tax.rate'");
            const taxRate = taxRes.rows.length > 0 ? parseFloat(taxRes.rows[0].setting_value) : 0.16;

            taxTotal += lineTotal * taxRate;
            discountTotal += discount;

            await client.query(`
                INSERT INTO quote_items (quote_id, item_type, product_id, service_id, description, quantity, unit_price, discount, line_total)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [quoteId, item.type, item.product_id || null, item.service_id || null, item.description, qty, price, discount, lineTotal]);
        }

        const totalAmount = subtotal + taxTotal;

        // Update Totals
        await client.query(`
            UPDATE quotes 
            SET subtotal = $1, tax_amount = $2, discount_amount = $3, total_amount = $4
            WHERE quote_id = $5
        `, [subtotal, taxTotal, discountTotal, totalAmount, quoteId]);

        await client.query('COMMIT');
        res.status(201).json({ message: 'Quote created', quote_id: quoteId, quote_number: quoteNumber });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Create quote error:', err);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
}

/**
 * PATCH /api/quotes/:id/status
 * Update status
 */
async function updateQuoteStatus(req, res) {
    try {
        const { id } = req.params;
        const { status } = req.body; // 'Sent', 'Accepted', 'Declined', 'Expired'
        await pool.query('UPDATE quotes SET status = $1, updated_at = NOW() WHERE quote_id = $2', [status, id]);
        res.json({ message: `Quote status updated to ${status}` });
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * POST /api/quotes/:id/convert
 * Convert Quote to Sale
 */
async function convertToSale(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;

        // 1. Get Quote
        const quoteRes = await client.query('SELECT * FROM quotes WHERE quote_id = $1', [id]);
        if (quoteRes.rows.length === 0) throw new Error('Quote not found');
        const quote = quoteRes.rows[0];

        if (quote.status === 'Converted') throw new Error('Quote already converted');

        // 2. Get Items
        const itemsRes = await client.query('SELECT * FROM quote_items WHERE quote_id = $1', [id]);
        const items = itemsRes.rows;

        // 3. Create Sale Header
        // Generate Sale Number
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const countRes = await client.query("SELECT COUNT(*) FROM sales WHERE transaction_date::date = CURRENT_DATE");
        const count = parseInt(countRes.rows[0].count) + 1;
        const saleNumber = `SALE-${dateStr}-${String(count).padStart(4, '0')}`;

        const saleRes = await client.query(`
            INSERT INTO sales (sale_number, customer_id, payment_method, subtotal, tax_amount, total_amount, amount_paid, change_due, payment_status, staff_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING sale_id
        `, [
            saleNumber,
            quote.customer_id,
            'Quote Conversion', // payment_method
            quote.subtotal,
            quote.tax_amount,
            quote.total_amount,
            0, // amount_paid
            0, // change_due
            'Pending', // payment_status
            req.user.user_id
        ]);
        const saleId = saleRes.rows[0].sale_id;

        // 4. Create Sale Items & Reduce Stock
        for (const item of items) {
            await client.query(`
                INSERT INTO sale_items (sale_id, item_type, product_id, service_id, quantity, unit_price, line_total)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [saleId, item.item_type, item.product_id, item.service_id, item.quantity, item.unit_price, item.line_total]);

            // Reduce Stock if Product
            if (item.product_id) {
                await client.query(`
                    UPDATE products SET stock_quantity = stock_quantity - $1 
                    WHERE product_id = $2
                `, [item.quantity, item.product_id]);

                // Log Movement
                await client.query(`
                    INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_type, reference_id, reason, performed_by)
                    VALUES ($1, 'SALE', $2, 'sale', $3, 'Quote Conversion', $4)
                `, [item.product_id, -item.quantity, saleId, req.user.user_id]);
            }
        }

        // 5. Update Quote
        await client.query('UPDATE quotes SET status = $1, converted_sale_id = $2, updated_at = NOW() WHERE quote_id = $3', ['Converted', saleId, id]);

        await client.query('COMMIT');
        res.json({ message: 'Quote converted to sale', sale_id: saleId, sale_number: saleNumber });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Convert quote error:', err);
        res.status(500).json({ error: err.message || 'Server error' });
    } finally {
        client.release();
    }
}

module.exports = { listQuotes, getQuote, createQuote, updateQuoteStatus, convertToSale };
