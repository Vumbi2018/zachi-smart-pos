/**
 * Zachi Smart-POS — Supplier Controller
 * CRUD for supplier management
 */
const pool = require('../db/pool');

/** GET /api/suppliers — List all suppliers */
async function listSuppliers(req, res) {
    try {
        const result = await pool.query(
            'SELECT * FROM suppliers WHERE is_active = TRUE ORDER BY company_name ASC'
        );
        res.json(result.rows);
    } catch (err) {
        console.error('List suppliers error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** GET /api/suppliers/:id — Get supplier detail */
async function getSupplier(req, res) {
    try {
        const result = await pool.query('SELECT * FROM suppliers WHERE supplier_id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found.' });

        // Get supplier price list
        const prices = await pool.query(`
            SELECT sp.*, p.name AS product_name, p.barcode 
            FROM supplier_prices sp
            JOIN products p ON sp.product_id = p.product_id
            WHERE sp.supplier_id = $1
            ORDER BY p.name
        `, [req.params.id]);

        // Get recent POs
        const pos = await pool.query(
            'SELECT po_id, po_number, status, total_amount, order_date FROM purchase_orders WHERE supplier_id = $1 ORDER BY created_at DESC LIMIT 10',
            [req.params.id]
        );

        res.json({ ...result.rows[0], price_list: prices.rows, recent_orders: pos.rows });
    } catch (err) {
        console.error('Get supplier error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** POST /api/suppliers — Create supplier */
async function createSupplier(req, res) {
    try {
        const { company_name, contact_person, phone, email, address, payment_terms, tax_id, notes } = req.body;
        const result = await pool.query(`
            INSERT INTO suppliers (company_name, contact_person, phone, email, address, payment_terms, tax_id, notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
        `, [company_name, contact_person, phone, email, address, payment_terms || 'Net 30', tax_id, notes]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Create supplier error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** PUT /api/suppliers/:id — Update supplier */
async function updateSupplier(req, res) {
    try {
        const { company_name, contact_person, phone, email, address, payment_terms, tax_id, notes, is_active } = req.body;
        const result = await pool.query(`
            UPDATE suppliers SET 
                company_name = COALESCE($1, company_name), contact_person = COALESCE($2, contact_person),
                phone = COALESCE($3, phone), email = COALESCE($4, email), address = COALESCE($5, address),
                payment_terms = COALESCE($6, payment_terms), tax_id = COALESCE($7, tax_id),
                notes = COALESCE($8, notes), is_active = COALESCE($9, is_active), updated_at = NOW()
            WHERE supplier_id = $10 RETURNING *
        `, [company_name, contact_person, phone, email, address, payment_terms, tax_id, notes, is_active, req.params.id]);

        if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found.' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Update supplier error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** DELETE /api/suppliers/:id — Soft delete supplier */
async function deleteSupplier(req, res) {
    try {
        const result = await pool.query(
            'UPDATE suppliers SET is_active = FALSE, updated_at = NOW() WHERE supplier_id = $1 RETURNING supplier_id',
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found.' });
        res.json({ message: 'Supplier deactivated.' });
    } catch (err) {
        console.error('Delete supplier error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** POST /api/suppliers/:id/prices — Add product to supplier price list */
async function addPriceList(req, res) {
    try {
        const { product_id, supplier_sku, price, minimum_order_qty, lead_time_days } = req.body;

        // Upsert logic
        const result = await pool.query(`
            INSERT INTO supplier_prices (supplier_id, product_id, supplier_sku, price, minimum_order_qty, lead_time_days, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6, NOW())
            ON CONFLICT (supplier_id, product_id) 
            DO UPDATE SET supplier_sku=$3, price=$4, minimum_order_qty=$5, lead_time_days=$6, updated_at=NOW()
            RETURNING *
        `, [req.params.id, product_id, supplier_sku, price, minimum_order_qty, lead_time_days]);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Add price list error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** DELETE /api/suppliers/:id/prices/:productId — Remove product from price list */
async function removePriceList(req, res) {
    try {
        await pool.query('DELETE FROM supplier_prices WHERE supplier_id = $1 AND product_id = $2', [req.params.id, req.params.productId]);
        res.json({ message: 'Item removed from price list.' });
    } catch (err) {
        console.error('Remove price list error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

module.exports = { listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier, addPriceList, removePriceList };
