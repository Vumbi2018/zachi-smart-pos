const pool = require('../db/pool');

const PermissionController = {
    // Get all permissions
    async getAllPermissions(req, res) {
        try {
            const result = await pool.query('SELECT * FROM permissions ORDER BY name');
            res.json(result.rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        }
    },

    // Get permissions for all roles (Matrix)
    async getRolePermissions(req, res) {
        try {
            // Return a map of role -> [permission_ids]
            const result = await pool.query('SELECT role, permission_id FROM role_permissions');

            const matrix = {};
            result.rows.forEach(row => {
                if (!matrix[row.role]) matrix[row.role] = [];
                matrix[row.role].push(row.permission_id);
            });

            res.json(matrix);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        }
    },

    // Update permissions for a specific role
    async updateRolePermissions(req, res) {
        const client = await pool.connect();
        try {
            const { role } = req.params; // 'manager', 'cashier', etc.
            const { permissionIds } = req.body; // Array of IDs

            if (!Array.isArray(permissionIds)) {
                return res.status(400).json({ error: 'permissionIds must be an array' });
            }

            await client.query('BEGIN');

            // 1. Remove all existing permissions for this role
            await client.query('DELETE FROM role_permissions WHERE role = $1', [role]);

            // 2. Insert new permissions
            if (permissionIds.length > 0) {
                const values = permissionIds.map((pid, index) => `($1, $${index + 2})`).join(',');
                const params = [role, ...permissionIds];
                await client.query(`INSERT INTO role_permissions (role, permission_id) VALUES ${values}`, params);
            }

            // Audit Log
            await client.query(
                'INSERT INTO audit_logs (user_id, action, table_name, old_value, new_value) VALUES ($1, $2, $3, $4, $5)',
                [req.user.user_id, 'UPDATE_ROLE_PERMISSIONS', 'role_permissions', role, JSON.stringify(permissionIds)]
            );

            await client.query('COMMIT');
            res.json({ message: 'Permissions updated successfully' });

        } catch (err) {
            await client.query('ROLLBACK');
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        } finally {
            client.release();
        }
    }
};

module.exports = PermissionController;
