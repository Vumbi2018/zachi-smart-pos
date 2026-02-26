const pool = require('../db/pool');

// Middleware factory to check for a specific permission
const requirePermission = (permissionName) => {
    return async (req, res, next) => {
        try {
            // If user is Director, they bypass checks (optional, but good for superadmin)
            // Or we can just rely on the database having all permissions for 'director' role.
            // Let's rely on DB to keep it uniform, but ensure Director has all perms in migration.

            // However, for safety, if user.role === 'director', allow.
            if (req.user.role === 'director') return next();

            const { user_id, role } = req.user;

            // Check if the user's role has the required permission
            const result = await pool.query(`
        SELECT 1 
        FROM role_permissions rp
        JOIN permissions p ON rp.permission_id = p.id
        WHERE rp.role = $1 AND p.name = $2
      `, [role, permissionName]);

            if (result.rows.length > 0) {
                next();
            } else {
                res.status(403).json({ error: 'Access denied: Insufficient permissions' });
            }
        } catch (err) {
            console.error('Permission check error:', err);
            res.status(500).json({ error: 'Server error checking permissions' });
        }
    };
};

module.exports = requirePermission;
