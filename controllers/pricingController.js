const pool = require('../db/pool');

/**
 * POST /api/pricing/promotions
 * Create a new promotion
 */
async function createPromotion(req, res) {
    try {
        const { name, description, discount_type, discount_value, min_purchase, applies_to, applies_to_id, start_date, end_date } = req.body;

        if (!name || !String(name).trim()) {
            return res.status(400).json({ error: 'Promotion name is required.' });
        }
        if (!discount_type || !['percentage', 'fixed_amount', 'buy_x_get_y'].includes(String(discount_type))) {
            return res.status(400).json({ error: 'discount_type must be one of percentage, fixed_amount, buy_x_get_y.' });
        }
        const dv = Number(discount_value);
        if (!Number.isFinite(dv) || dv < 0) {
            return res.status(400).json({ error: 'discount_value must be a non-negative number.' });
        }

        // Coerce blank values to NULL so empty/whitespace strings don't
        // hit typed columns (applies_to_id, dates).
        const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
        const cleanAppliesTo = isBlank(applies_to) ? 'all' : String(applies_to).trim();
        const cleanAppliesToId =
            cleanAppliesTo === 'all' || isBlank(applies_to_id)
                ? null
                : (typeof applies_to_id === 'string' ? applies_to_id.trim() : applies_to_id);
        const cleanStart = isBlank(start_date) ? null : String(start_date).trim();
        const cleanEnd   = isBlank(end_date)   ? null : String(end_date).trim();
        const cleanDesc  = isBlank(description) ? null : String(description).trim();
        const cleanMin   = isBlank(min_purchase) ? 0 : (Number(min_purchase) || 0);

        const result = await pool.query(
            `INSERT INTO promotions (name, description, discount_type, discount_value, min_purchase, applies_to, applies_to_id, start_date, end_date, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [String(name).trim(), cleanDesc, discount_type, dv, cleanMin, cleanAppliesTo, cleanAppliesToId, cleanStart, cleanEnd, req.user.user_id]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Create promotion error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * GET /api/pricing/promotions
 * Get all active promotions
 */
async function getActivePromotions(req, res) {
    try {
        const result = await pool.query(
            `SELECT * FROM promotions 
             WHERE is_active = TRUE 
             AND (start_date IS NULL OR start_date <= CURRENT_DATE)
             AND (end_date IS NULL OR end_date >= CURRENT_DATE)
             ORDER BY created_at DESC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Get promotions error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * POST /api/pricing/calculate
 * Calculate cart total with best applicable promotions
 */
async function calculateCart(req, res) {
    try {
        const { items } = req.body; // Array of { type, product_id, service_id, unit_price, quantity, category }

        // Fetch active promos
        const promosResult = await pool.query(
            `SELECT * FROM promotions 
             WHERE is_active = TRUE 
             AND (start_date IS NULL OR start_date <= CURRENT_DATE)
             AND (end_date IS NULL OR end_date >= CURRENT_DATE)`
        );
        const promos = promosResult.rows;

        let subtotal = 0;
        let totalDiscount = 0;
        let appliedPromos = [];

        // 1. Calculate base subtotal
        items.forEach(item => {
            item.line_total = parseFloat(item.unit_price) * parseInt(item.quantity);
            subtotal += item.line_total;
        });

        // 2. Apply promotions (Simple logic: apply all valid non-conflicting promos)
        // For MVP, we'll try to apply one best promo per item or global

        for (const promo of promos) {
            let discount = 0;
            let applicableAmount = 0;

            // Check min purchase
            if (subtotal < parseFloat(promo.min_purchase)) continue;

            if (promo.applies_to === 'all') {
                applicableAmount = subtotal;
            } else if (promo.applies_to === 'category') {
                // Sum items in this category
                // Note: Frontend must send category in payload or we verify against DB.
                // Trusting frontend payload for speed in this MVP step, but ideally fetch from DB.
                applicableAmount = items
                    .filter(i => i.category === promo.applies_to_id || i.category_id == promo.applies_to_id) // ambiguous linkage, assumes string match or ID match
                    .reduce((sum, i) => sum + i.line_total, 0);
            } else if (promo.applies_to === 'product') {
                applicableAmount = items
                    .filter(i => i.type === 'product' && i.product_id == promo.applies_to_id)
                    .reduce((sum, i) => sum + i.line_total, 0);
            }

            if (applicableAmount <= 0) continue;

            if (promo.discount_type === 'percentage') {
                discount = applicableAmount * (parseFloat(promo.discount_value) / 100);
            } else if (promo.discount_type === 'fixed_amount') {
                discount = parseFloat(promo.discount_value);
                // Cap fixed discount at applicable amount to avoid negative
                if (discount > applicableAmount) discount = applicableAmount;
            }

            if (discount > 0) {
                totalDiscount += discount;
                appliedPromos.push({ name: promo.name, amount: discount });
            }
        }

        // Cap total discount at subtotal
        if (totalDiscount > subtotal) totalDiscount = subtotal;

        res.json({
            subtotal,
            discount: totalDiscount,
            total: subtotal - totalDiscount,
            applied_promos: appliedPromos
        });

    } catch (err) {
        console.error('Calculate cart error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * DELETE /api/pricing/promotions/:id
 * Deactivate a promotion
 */
async function deletePromotion(req, res) {
    try {
        const { id } = req.params;
        await pool.query('UPDATE promotions SET is_active = FALSE WHERE promo_id = $1', [id]);
        res.json({ message: 'Promotion deactivated' });
    } catch (err) {
        res.status(500).json({ error: 'Server error.' });
    }
}

module.exports = { createPromotion, getActivePromotions, calculateCart, deletePromotion };
