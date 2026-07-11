/**
 * Zachi Smart-POS — Loyalty Controller
 * Points earn/redeem, tiers, store credits
 */
const pool = require('../db/pool');
const { syncMeta } = require('../utils/syncMeta');


/** GET /api/loyalty - Compact loyalty dashboard summary */
async function getLoyaltySummary(req, res) {
    try {
        const [customers, points, credits, tiers] = await Promise.all([
            pool.query('SELECT COUNT(*)::int AS count FROM customers'),
            pool.query('SELECT COALESCE(SUM(loyalty_points), 0)::int AS total_points FROM customers'),
            pool.query('SELECT COALESCE(SUM(balance), 0)::numeric AS total_balance FROM store_credits WHERE balance > 0'),
            pool.query('SELECT * FROM loyalty_tiers ORDER BY min_points ASC')
        ]);

        res.json({
            customer_count: customers.rows[0]?.count || 0,
            total_points: points.rows[0]?.total_points || 0,
            total_credit_balance: Number(credits.rows[0]?.total_balance || 0),
            tiers: tiers.rows
        });
    } catch (err) {
        console.error('Loyalty summary error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

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

/**
 * POST /api/loyalty/earn — Award points (atomic).
 *
 * The previous read-modify-write loop was racy: two concurrent earns
 * could both read the same starting balance and overwrite each
 * other's write. The new implementation does the increment in a
 * single SQL statement and uses the RETURNING value for the audit
 * row, all inside a single transaction so the customer balance and
 * loyalty_transactions row commit (or roll back) together.
 */
async function earnPoints(req, res) {
    const { customer_id, points, reference_type, reference_id } = req.body;
    const meta = syncMeta(req);
    if (!Number.isFinite(Number(points)) || Number(points) <= 0) {
        return res.status(400).json({ error: 'points must be a positive number.' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const upd = await client.query(
            `UPDATE customers
                SET loyalty_points = loyalty_points + $1,
                    updated_at = NOW()
              WHERE customer_id = $2
              RETURNING loyalty_points`,
            [points, customer_id]
        );
        if (upd.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Customer not found.' });
        }
        const newBalance = upd.rows[0].loyalty_points;
        await client.query(
            `INSERT INTO loyalty_transactions (customer_id, transaction_type, points, reference_type, reference_id, balance_after, created_by, device_id, client_op_id)
             VALUES ($1, 'earn', $2, $3, $4, $5, $6, $7, $8)`,
            [customer_id, points, reference_type, reference_id, newBalance, req.user.user_id, meta.device_id, meta.client_op_id]
        );
        await client.query('COMMIT');
        res.status(201).json({ message: `${points} points awarded.`, balance: newBalance });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Earn points error:', err);
        res.status(500).json({ error: 'Server error.' });
    } finally {
        client.release();
    }
}

/**
 * POST /api/loyalty/redeem — Redeem points (atomic, race-safe).
 *
 * The UPDATE has a `loyalty_points >= $1` predicate baked in. If two
 * concurrent redemptions race, only one row updates; the other sees
 * `rowCount === 0` and gets a typed 409 INSUFFICIENT_POINTS instead
 * of silently double-spending. Mirrors the same pattern used by the
 * stock and credit-payment guards in `utils/atomicStock.js`.
 */
async function redeemPoints(req, res) {
    const { customer_id, points, notes } = req.body;
    const meta = syncMeta(req);
    if (!Number.isFinite(Number(points)) || Number(points) <= 0) {
        return res.status(400).json({ error: 'points must be a positive number.' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Existence check first so we can return 404 (not 409) when
        // the customer doesn't exist at all.
        const exists = await client.query(
            'SELECT 1 FROM customers WHERE customer_id = $1', [customer_id]
        );
        if (exists.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Customer not found.' });
        }
        const upd = await client.query(
            `UPDATE customers
                SET loyalty_points = loyalty_points - $1,
                    updated_at = NOW()
              WHERE customer_id = $2
                AND loyalty_points >= $1
              RETURNING loyalty_points`,
            [points, customer_id]
        );
        if (upd.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: 'Insufficient points.',
                code: 'INSUFFICIENT_POINTS',
            });
        }
        const newBalance = upd.rows[0].loyalty_points;
        await client.query(
            `INSERT INTO loyalty_transactions (customer_id, transaction_type, points, reference_type, balance_after, notes, created_by, device_id, client_op_id)
             VALUES ($1, 'redeem', $2, 'manual', $3, $4, $5, $6, $7)`,
            [customer_id, -points, newBalance, notes, req.user.user_id, meta.device_id, meta.client_op_id]
        );
        await client.query('COMMIT');
        res.status(201).json({ message: `${points} points redeemed.`, balance: newBalance });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Redeem points error:', err);
        res.status(500).json({ error: 'Server error.' });
    } finally {
        client.release();
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

module.exports = { getLoyaltySummary, getCustomerLoyalty, earnPoints, redeemPoints, listTiers, getStoreCredits, manageTiers };
