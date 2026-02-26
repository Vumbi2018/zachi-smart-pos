/**
 * Zachi Smart-POS — Loyalty Controller
 * Points earn/redeem, tiers, store credits
 */
const pool = require('../db/pool');

/** GET /api/loyalty/customer/:id — Get customer loyalty info */
async function getCustomerLoyalty(req, res) {
    try {
        const customer = await pool.query('SELECT customer_id, full_name, loyalty_points FROM customers WHERE customer_id = $1', [req.params.id]);
        if (customer.rows.length === 0) return res.status(404).json({ error: 'Customer not found.' });

        // Determine tier
        const tier = await pool.query('SELECT * FROM loyalty_tiers WHERE min_points <= $1 ORDER BY min_points DESC LIMIT 1', [customer.rows[0].loyalty_points]);

        // Recent transactions
        const transactions = await pool.query('SELECT * FROM loyalty_transactions WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20', [req.params.id]);

        // Store credits
        const credits = await pool.query('SELECT * FROM store_credits WHERE customer_id = $1 AND balance > 0 ORDER BY created_at DESC', [req.params.id]);

        res.json({
            ...customer.rows[0],
            tier: tier.rows[0] || null,
            transactions: transactions.rows,
            store_credits: credits.rows,
            total_credit_balance: credits.rows.reduce((sum, c) => sum + parseFloat(c.balance), 0)
        });
    } catch (err) {
        console.error('Get loyalty error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** POST /api/loyalty/earn — Award points */
async function earnPoints(req, res) {
    try {
        const { customer_id, points, reference_type, reference_id } = req.body;
        const customer = await pool.query('SELECT loyalty_points FROM customers WHERE customer_id = $1', [customer_id]);
        if (customer.rows.length === 0) return res.status(404).json({ error: 'Customer not found.' });

        const newBalance = customer.rows[0].loyalty_points + points;
        await pool.query('UPDATE customers SET loyalty_points = $1, updated_at = NOW() WHERE customer_id = $2', [newBalance, customer_id]);
        await pool.query(`
            INSERT INTO loyalty_transactions (customer_id, transaction_type, points, reference_type, reference_id, balance_after, created_by)
            VALUES ($1, 'earn', $2, $3, $4, $5, $6)
        `, [customer_id, points, reference_type, reference_id, newBalance, req.user.user_id]);

        res.status(201).json({ message: `${points} points awarded.`, balance: newBalance });
    } catch (err) {
        console.error('Earn points error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** POST /api/loyalty/redeem — Redeem points */
async function redeemPoints(req, res) {
    try {
        const { customer_id, points, notes } = req.body;
        const customer = await pool.query('SELECT loyalty_points FROM customers WHERE customer_id = $1', [customer_id]);
        if (customer.rows.length === 0) return res.status(404).json({ error: 'Customer not found.' });
        if (customer.rows[0].loyalty_points < points) return res.status(400).json({ error: 'Insufficient points.' });

        const newBalance = customer.rows[0].loyalty_points - points;
        await pool.query('UPDATE customers SET loyalty_points = $1, updated_at = NOW() WHERE customer_id = $2', [newBalance, customer_id]);
        await pool.query(`
            INSERT INTO loyalty_transactions (customer_id, transaction_type, points, reference_type, balance_after, notes, created_by)
            VALUES ($1, 'redeem', $2, 'manual', $3, $4, $5)
        `, [customer_id, -points, newBalance, notes, req.user.user_id]);

        res.status(201).json({ message: `${points} points redeemed.`, balance: newBalance });
    } catch (err) {
        console.error('Redeem points error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** GET /api/loyalty/tiers — List loyalty tiers */
async function listTiers(req, res) {
    try {
        const result = await pool.query('SELECT * FROM loyalty_tiers ORDER BY min_points ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('List tiers error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** GET /api/loyalty/credits/:customerId — Get store credits */
async function getStoreCredits(req, res) {
    try {
        const result = await pool.query('SELECT * FROM store_credits WHERE customer_id = $1 ORDER BY created_at DESC', [req.params.customerId]);
        const total = result.rows.reduce((sum, c) => sum + parseFloat(c.balance), 0);
        res.json({ credits: result.rows, total_balance: total });
    } catch (err) {
        console.error('Get store credits error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/**
 * POST /api/loyalty/tiers
 * Update loyalty tiers
 */
async function manageTiers(req, res) {
    try {
        const { tiers } = req.body; // Array of { tier_id, name, min_points, discount_pct, points_multiplier }

        for (const t of tiers) {
            if (t.tier_id) {
                await pool.query(
                    'UPDATE loyalty_tiers SET name=$1, min_points=$2, discount_pct=$3, points_multiplier=$4 WHERE tier_id=$5',
                    [t.name, t.min_points, t.discount_pct, t.points_multiplier, t.tier_id]
                );
            } else {
                await pool.query(
                    'INSERT INTO loyalty_tiers (name, min_points, discount_pct, points_multiplier) VALUES ($1, $2, $3, $4)',
                    [t.name, t.min_points, t.discount_pct, t.points_multiplier]
                );
            }
        }
        res.json({ message: 'Tiers updated successfully' });
    } catch (err) {
        console.error('Manage tiers error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

module.exports = { getCustomerLoyalty, earnPoints, redeemPoints, listTiers, getStoreCredits, manageTiers };
