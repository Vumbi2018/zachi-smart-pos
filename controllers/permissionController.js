const pool = require('../db/pool');

// role_permissions.role is VARCHAR(50); guard against typos.
const ALLOWED_ROLES = new Set(['director', 'manager', 'cashier', 'designer', 'consultant']);

// Accept either a positive integer or a canonical UUID string —
// permissions.id is INT in the migration but UUID in dev/prod DBs.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function normalisePermissionId(raw) {
    if (raw == null) return null;
    if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (UUID_RE.test(trimmed)) return trimmed.toLowerCase();
        if (/^\d+$/.test(trimmed)) {
            const n = Number(trimmed);
            if (Number.isInteger(n) && n > 0) return n;
        }
    }
    return null;
}

const PermissionController = {
    // Get all permissions. Aliases id → permission_id to match the
    // shape the matrix UI binds to.
    async getAllPermissions(req, res) {
        try {
            const result = await pool.query(
                'SELECT id AS permission_id, id, name, description, created_at FROM permissions ORDER BY name'
            );
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

            if (!ALLOWED_ROLES.has(String(role))) {
                return res.status(400).json({
                    error: `Unknown role "${role}".`,
                    allowed: Array.from(ALLOWED_ROLES),
                });
            }
            if (!Array.isArray(permissionIds)) {
                return res.status(400).json({ error: 'permissionIds must be an array' });
            }

            // Drop garbage ids; refuse if the caller sent N items but
            // every one was invalid (don't silently wipe the role).
            const cleanIds = [...new Set(
                permissionIds
                    .map(normalisePermissionId)
                    .filter((pid) => pid !== null)
            )];
            if (permissionIds.length > 0 && cleanIds.length === 0) {
                return res.status(400).json({
                    error: 'permissionIds contained no valid permission ids — refusing to wipe the role.',
                });
            }

            await client.query('BEGIN');

            // 1. Remove all existing permissions for this role
            await client.query('DELETE FROM role_permissions WHERE role = $1', [role]);

            // 2. Insert new permissions
            if (cleanIds.length > 0) {
                const values = cleanIds.map((_pid, index) => `($1, $${index + 2})`).join(',');
                const params = [role, ...cleanIds];
                await client.query(`INSERT INTO role_permissions (role, permission_id) VALUES ${values}`, params);
            }

            // SAVEPOINT so an audit_logs failure can't abort the outer
            // txn (PG state 25P02 would otherwise kill the COMMIT).
            await client.query('SAVEPOINT audit_log');
            try {
                await client.query(
                    'INSERT INTO audit_logs (user_id, action, table_name, old_value, new_value) VALUES ($1, $2, $3, $4, $5)',
                    [req.user.user_id, 'UPDATE_ROLE_PERMISSIONS', 'role_permissions', role, JSON.stringify(cleanIds)]
                );
                await client.query('RELEASE SAVEPOINT audit_log');
            } catch (auditErr) {
                console.error('[permissions] audit_logs insert failed (non-fatal):', auditErr.message);
                await client.query('ROLLBACK TO SAVEPOINT audit_log');
            }

            await client.query('COMMIT');
            res.json({ message: 'Permissions updated successfully', count: cleanIds.length });

        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        } finally {
            client.release();
        }
    }
};

module.exports = PermissionController;
