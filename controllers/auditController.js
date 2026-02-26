
const pool = require('../db/pool');

// GET /api/audit
async function getLogs(req, res) {
    try {
        const { user_id, action, start_date, end_date, limit = 100 } = req.query;

        let query = `
            SELECT a.*, u.username, u.full_name 
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.user_id
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 1;

        if (user_id) {
            query += ` AND a.user_id = $${paramCount}`;
            params.push(user_id);
            paramCount++;
        }

        if (action) {
            query += ` AND a.action = $${paramCount}`;
            params.push(action);
            paramCount++;
        }

        if (start_date) {
            query += ` AND a.created_at >= $${paramCount}`;
            params.push(start_date);
            paramCount++;
        }

        if (end_date) {
            query += ` AND a.created_at <= $${paramCount}`;
            // Adjust end date to include the whole day
            params.push(end_date + ' 23:59:59');
            paramCount++;
        }

        query += ` ORDER BY a.created_at DESC LIMIT $${paramCount}`;
        params.push(limit);

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching audit logs:', err);
        res.status(500).json({ error: 'Server error fetching logs.' });
    }
}

module.exports = { getLogs };
