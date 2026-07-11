'use strict';

const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const {
    resolveEffectivePermissions,
    reconcileUserPermissions,
} = require('../services/userPermissions');

// GET /api/users
async function getUsers(req, res) {
    try {
        const result = await pool.query(
            // v1.0.15 — suppress the auto-generated Jest Sync fixture
            // accounts (jestsync_* / jestsync2_*) from the operator UI.
            // The rows stay in the DB so the test suite can keep
            // creating + cleaning them up without races, but they no
            // longer pollute Settings → Users for the director.
            //
            // v1.0.17 — also surface a per-row override count so the
            // Users table can render a small "N overrides" pill next
            // to each user without a second roundtrip per row.
            // user_permissions is the only place explicit overrides
            // live; role defaults live in role_permissions and are
            // applied implicitly by resolveEffectivePermissions().
            `SELECT u.user_id, u.username, u.full_name, u.role, u.is_active,
                    u.created_at, u.email, u.phone,
                    COALESCE(op.override_count, 0)::int AS override_count
               FROM users u
               LEFT JOIN (
                   SELECT user_id, COUNT(*) AS override_count
                     FROM user_permissions
                    GROUP BY user_id
               ) op ON op.user_id = u.user_id
              WHERE u.username !~* '^jestsync2?_'
              ORDER BY u.user_id ASC`

        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: 'Server error fetching users.' });
    }
}

// GET /api/users/:id — single user (used by the Edit User modal).
// Now also returns the user's effective permission name list so the
// Edit modal can pre-check the right boxes.
async function getUserById(req, res) {
    try {
        const result = await pool.query(
            `SELECT user_id, username, full_name, role, is_active, created_at, email, phone
             FROM users WHERE user_id = $1`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }
        const user = result.rows[0];
        try {
            const set = await resolveEffectivePermissions(null, user.user_id);
            user.permissions = Array.from(set).sort();
        } catch (e) {
            console.error('[getUserById] permission resolver failed:', e.message);
            user.permissions = [];
        }
        res.json(user);
    } catch (err) {
        console.error('Error fetching user:', err);
        res.status(500).json({ error: 'Server error fetching user.' });
    }
}

// GET /api/users/:id/permissions — effective permission names only
async function getUserPermissions(req, res) {
    try {
        const u = await pool.query(
            'SELECT 1 FROM users WHERE user_id = $1',
            [req.params.id]
        );
        if (u.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
        const set = await resolveEffectivePermissions(null, req.params.id);
        res.json({ user_id: req.params.id, permissions: Array.from(set).sort() });
    } catch (err) {
        console.error('Error fetching user permissions:', err);
        res.status(500).json({ error: 'Server error.' });
    }
}

// POST /api/users
async function createUser(req, res) {
    const { username, password, full_name, role, email, phone } = req.body;

    if (!username || !password || !full_name || !role) {
        return res.status(400).json({ error: 'Username, password, full_name, and role are required.' });
    }

    try {
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

// PUT /api/users/:id — also reconciles per-user permission overrides
// when `permissions: [name, ...]` is included in the body. Director's
// permissions are NOT touched — the role short-circuit in
// requirePermission means overrides on a director are pointless.
async function updateUser(req, res) {
    const userId = req.params.id;
    const { full_name, role, email, phone, is_active, password, permissions } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const oldUser = await client.query('SELECT * FROM users WHERE user_id = $1', [userId]);
        if (oldUser.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'User not found.' });
        }

        let passwordHash = oldUser.rows[0].password_hash;
        if (password) {
            const salt = await bcrypt.genSalt(10);
            passwordHash = await bcrypt.hash(password, salt);
        }

        const result = await client.query(
            `UPDATE users
             SET full_name = $1, role = $2, email = $3, phone = $4, is_active = $5,
                 password_hash = $6, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $7
             RETURNING user_id, username, full_name, role, is_active`,
            [full_name, role, email, phone, is_active, passwordHash, userId]
        );

        let permResult = null;
        if (Array.isArray(permissions)) {
            const targetRole = result.rows[0].role;
            if (targetRole === 'director') {
                // Director is unconstrained. Wipe any stale overrides.
                await client.query('DELETE FROM user_permissions WHERE user_id = $1', [userId]);
                permResult = { skipped: 'director', removed: true };
            } else {
                permResult = await reconcileUserPermissions(
                    client, userId, req.user && req.user.user_id, permissions
                );
            }
        }

        await client.query(
            `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, new_value, ip_address)
             VALUES ($1, 'UPDATE_USER', 'users', $2, $3, $4, $5)`,
            [
                req.user.user_id,
                userId,
                JSON.stringify(oldUser.rows[0]),
                JSON.stringify({ ...result.rows[0], permissions_change: permResult }),
                req.ip
            ]
        );

        await client.query('COMMIT');

        // Return the up-to-date effective permission set so the
        // frontend doesn't need a second roundtrip.
        const set = await resolveEffectivePermissions(null, userId);
        res.json({ ...result.rows[0], permissions: Array.from(set).sort() });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Error updating user:', err);
        res.status(500).json({ error: err.message || 'Server error updating user.' });
    } finally {
        client.release();
    }
}

// DELETE /api/users/:id
async function deleteUser(req, res) {
    const userId = req.params.id;

    // Prevent self-deletion. Guard works for both UUID and integer ids
    // because we string-compare.
    if (String(userId) === String(req.user.user_id)) {
        return res.status(400).json({ error: 'Cannot delete your own account.' });
    }

    try {
        const user = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
        if (user.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        try {
            await pool.query('DELETE FROM users WHERE user_id = $1', [userId]);
            await pool.query(
                `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, ip_address)
                 VALUES ($1, 'DELETE_USER', 'users', $2, $3, $4)`,
                [req.user.user_id, userId, JSON.stringify(user.rows[0]), req.ip]
            );
            res.json({ message: 'User deleted successfully.' });
        } catch (fkErr) {
            if (fkErr.code === '23503') {
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

module.exports = {
    getUsers,
    getUserById,
    getUserPermissions,
    createUser,
    updateUser,
    deleteUser,
};
