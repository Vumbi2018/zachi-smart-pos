/**
 * Zachi Smart-POS — Cash Drawer Controller
 * Open/close shifts, paid-in/paid-out, EOD reconciliation
 */
const pool = require('../db/pool');

/** POST /api/cash/open — Open a new cash session */
async function openSession(req, res) {
    try {
        const { opening_float } = req.body;
        // Check if there's already an open session
        const existing = await pool.query("SELECT session_id FROM cash_sessions WHERE status = 'Open' LIMIT 1");
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'A cash session is already open. Close it first.' });
        }

        const result = await pool.query(
            `INSERT INTO cash_sessions (opened_by, opening_float, expected_cash)
             VALUES ($1, $2, $2) RETURNING *`,
            [req.user.user_id, opening_float || 0]
        );

        // Record float as first cash movement
        await pool.query(
            `INSERT INTO cash_movements (session_id, movement_type, amount, description, performed_by)
             VALUES ($1, 'float', $2, 'Opening float', $3)`,
            [result.rows[0].session_id, opening_float || 0, req.user.user_id]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Open session error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** POST /api/cash/close — Close current session */
async function closeSession(req, res) {
    try {
        const { actual_cash, variance_reason, notes } = req.body;
        const session = await pool.query("SELECT * FROM cash_sessions WHERE status = 'Open' ORDER BY opened_at DESC LIMIT 1");
        if (session.rows.length === 0) return res.status(400).json({ error: 'No open cash session.' });

        const s = session.rows[0];
        const variance = (actual_cash || 0) - s.expected_cash;

        const result = await pool.query(`
            UPDATE cash_sessions SET 
                status = 'Closed', actual_cash = $1, variance = $2,
                variance_reason = $3, notes = $4, closed_by = $5, closed_at = NOW()
            WHERE session_id = $6 RETURNING *
        `, [actual_cash, variance, variance_reason, notes, req.user.user_id, s.session_id]);

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Close session error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** GET /api/cash/current — Get current open session */
async function getCurrentSession(req, res) {
    try {
        const result = await pool.query(`
            SELECT cs.*, u.full_name AS opened_by_name
            FROM cash_sessions cs
            JOIN users u ON cs.opened_by = u.user_id
            WHERE cs.status = 'Open'
            ORDER BY cs.opened_at DESC LIMIT 1
        `);
        if (result.rows.length === 0) return res.json(null);

        // Get today's movements for this session
        const movements = await pool.query(
            'SELECT * FROM cash_movements WHERE session_id = $1 ORDER BY created_at DESC',
            [result.rows[0].session_id]
        );

        res.json({ ...result.rows[0], movements: movements.rows });
    } catch (err) {
        console.error('Get session error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** POST /api/cash/paid-in — Record paid-in */
async function paidIn(req, res) {
    try {
        const { amount, description } = req.body;
        const session = await pool.query("SELECT session_id, expected_cash FROM cash_sessions WHERE status = 'Open' LIMIT 1");
        if (session.rows.length === 0) return res.status(400).json({ error: 'No open cash session.' });

        const s = session.rows[0];
        await pool.query(
            `INSERT INTO cash_movements (session_id, movement_type, amount, description, performed_by)
             VALUES ($1, 'paid_in', $2, $3, $4)`,
            [s.session_id, amount, description, req.user.user_id]
        );
        await pool.query('UPDATE cash_sessions SET expected_cash = expected_cash + $1 WHERE session_id = $2', [amount, s.session_id]);

        res.status(201).json({ message: 'Paid-in recorded.' });
    } catch (err) {
        console.error('Paid-in error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** POST /api/cash/paid-out — Record paid-out */
async function paidOut(req, res) {
    try {
        const { amount, description } = req.body;
        const session = await pool.query("SELECT session_id, expected_cash FROM cash_sessions WHERE status = 'Open' LIMIT 1");
        if (session.rows.length === 0) return res.status(400).json({ error: 'No open cash session.' });

        const s = session.rows[0];
        await pool.query(
            `INSERT INTO cash_movements (session_id, movement_type, amount, description, performed_by)
             VALUES ($1, 'paid_out', $2, $3, $4)`,
            [s.session_id, amount, description, req.user.user_id]
        );
        await pool.query('UPDATE cash_sessions SET expected_cash = expected_cash - $1 WHERE session_id = $2', [amount, s.session_id]);

        res.status(201).json({ message: 'Paid-out recorded.' });
    } catch (err) {
        console.error('Paid-out error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** GET /api/cash/history — List past sessions */
async function sessionHistory(req, res) {
    try {
        const result = await pool.query(`
            SELECT cs.*, 
                   u1.full_name AS opened_by_name,
                   u2.full_name AS closed_by_name
            FROM cash_sessions cs
            JOIN users u1 ON cs.opened_by = u1.user_id
            LEFT JOIN users u2 ON cs.closed_by = u2.user_id
            ORDER BY cs.opened_at DESC
            LIMIT 30
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Session history error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** GET /api/cash/history/:id — Get movements for a specific session */
async function getSessionMovements(req, res) {
    try {
        const session = await pool.query(`
            SELECT cs.*, u1.full_name AS opened_by_name, u2.full_name AS closed_by_name
            FROM cash_sessions cs
            JOIN users u1 ON cs.opened_by = u1.user_id
            LEFT JOIN users u2 ON cs.closed_by = u2.user_id
            WHERE cs.session_id = $1
        `, [req.params.id]);
        if (session.rows.length === 0) return res.status(404).json({ error: 'Session not found.' });

        const movements = await pool.query(
            `SELECT cm.*, u.full_name AS performed_by_name
             FROM cash_movements cm
             LEFT JOIN users u ON cm.performed_by = u.user_id
             WHERE cm.session_id = $1 ORDER BY cm.created_at ASC`,
            [req.params.id]
        );

        res.json({ ...session.rows[0], movements: movements.rows });
    } catch (err) {
        console.error('Session movements error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

/** GET /api/cash/eod/:id — EOD reconciliation report for a session */
async function getEodReport(req, res) {
    try {
        const session = await pool.query(`
            SELECT cs.*, u1.full_name AS opened_by_name, u2.full_name AS closed_by_name
            FROM cash_sessions cs
            JOIN users u1 ON cs.opened_by = u1.user_id
            LEFT JOIN users u2 ON cs.closed_by = u2.user_id
            WHERE cs.session_id = $1
        `, [req.params.id]);
        if (session.rows.length === 0) return res.status(404).json({ error: 'Session not found.' });

        const s = session.rows[0];

        // Movement aggregates
        const movements = await pool.query(`
            SELECT movement_type, 
                   COUNT(*) AS count, 
                   COALESCE(SUM(amount), 0) AS total
            FROM cash_movements
            WHERE session_id = $1
            GROUP BY movement_type
        `, [req.params.id]);

        const movementSummary = {};
        movements.rows.forEach(m => { movementSummary[m.movement_type] = { count: parseInt(m.count), total: parseFloat(m.total) }; });

        // Sales for this session date (approximate: between open and close)
        const salesQuery = await pool.query(`
            SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS total
            FROM sales
            WHERE created_at >= $1 AND created_at <= COALESCE($2, NOW())
        `, [s.opened_at, s.closed_at]);

        res.json({
            session: s,
            movements: movementSummary,
            sales: salesQuery.rows[0],
            summary: {
                opening_float: parseFloat(s.opening_float) || 0,
                total_paid_in: (movementSummary.paid_in?.total || 0),
                total_paid_out: (movementSummary.paid_out?.total || 0),
                total_sales_cash: (movementSummary.sale?.total || 0),
                total_refunds: (movementSummary.refund?.total || 0),
                expected_cash: parseFloat(s.expected_cash) || 0,
                actual_cash: parseFloat(s.actual_cash) || 0,
                variance: parseFloat(s.variance) || 0,
                variance_reason: s.variance_reason
            }
        });
    } catch (err) {
        console.error('EOD report error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

module.exports = { openSession, closeSession, getCurrentSession, paidIn, paidOut, sessionHistory, getSessionMovements, getEodReport };
