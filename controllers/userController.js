
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

// GET /api/users
async function getUsers(req, res) {
    try {
        const result = await pool.query(
            'SELECT user_id, username, full_name, role, is_active, created_at, email, phone FROM users ORDER BY user_id ASC'
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: 'Server error fetching users.' });
    }
}

// POST /api/users
async function createUser(req, res) {
    const { username, password, full_name, role, email, phone } = req.body;

    if (!username || !password || !full_name || !role) {
        return res.status(400).json({ error: 'Username, password, full_name, and role are required.' });
    }

    try {
        // Check duplicate
        const existing = await pool.query('SELECT user_id FROM users WHERE username = $1', [username]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Username already exists.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);

        const result = await pool.query(
            `INSERT INTO users (username, password_hash, full_name, role, email, phone)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING user_id, username, full_name, role, created_at`,
            [username, hash, full_name, role, email, phone]
        );

        // Audit log
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, table_name, record_id, new_value, ip_address)
             VALUES ($1, 'CREATE_USER', 'users', $2, $3, $4)`,
            [req.user.user_id, result.rows[0].user_id, JSON.stringify(result.rows[0]), req.ip]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating user:', err);
        res.status(500).json({ error: 'Server error creating user.' });
    }
}

// PUT /api/users/:id
async function updateUser(req, res) {
    const userId = req.params.id;
    const { full_name, role, email, phone, is_active, password } = req.body;

    try {
        const oldUser = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
        if (oldUser.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        let passwordHash = oldUser.rows[0].password_hash;
        if (password) {
            const salt = await bcrypt.genSalt(10);
            passwordHash = await bcrypt.hash(password, salt);
        }

        const result = await pool.query(
            `UPDATE users 
             SET full_name = $1, role = $2, email = $3, phone = $4, is_active = $5, password_hash = $6, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $7
             RETURNING user_id, username, full_name, role, is_active`,
            [full_name, role, email, phone, is_active, passwordHash, userId]
        );

        // Audit log
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, new_value, ip_address)
             VALUES ($1, 'UPDATE_USER', 'users', $2, $3, $4, $5)`,
            [
                req.user.user_id,
                userId,
                JSON.stringify(oldUser.rows[0]),
                JSON.stringify(result.rows[0]),
                req.ip
            ]
        );

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating user:', err);
        res.status(500).json({ error: 'Server error updating user.' });
    }
}

// DELETE /api/users/:id
async function deleteUser(req, res) {
    const userId = req.params.id;

    // Prevent self-deletion
    if (parseInt(userId) === req.user.user_id) {
        return res.status(400).json({ error: 'Cannot delete your own account.' });
    }

    try {
        const user = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
        if (user.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        // Hard delete or soft regarding constraints? 
        // Best practice: Soft delete usually, but here we might want to hard delete if no sales.
        // But for simplicity and data integrity (foreign keys in sales/audit_logs), use soft delete (deactivate).
        // Actually, let's allow hard delete but catch FK constraint errors.

        try {
            await pool.query('DELETE FROM users WHERE user_id = $1', [userId]);

            // Audit
            await pool.query(
                `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, ip_address)
                 VALUES ($1, 'DELETE_USER', 'users', $2, $3, $4)`,
                [req.user.user_id, userId, JSON.stringify(user.rows[0]), req.ip]
            );

            res.json({ message: 'User deleted successfully.' });
        } catch (fkErr) {
            // If linked to sales/logs, fallback to deactivation
            if (fkErr.code === '23503') { // foreign_key_violation
                await pool.query('UPDATE users SET is_active = FALSE WHERE user_id = $1', [userId]);
                res.json({ message: 'User deactivated (cannot delete due to existing records).' });
            } else {
                throw fkErr;
            }
        }

    } catch (err) {
        console.error('Error deleting user:', err);
        res.status(500).json({ error: 'Server error deleting user.' });
    }
}

module.exports = { getUsers, createUser, updateUser, deleteUser };
