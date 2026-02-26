/**
 * Role-Based Access Control Middleware
 * Usage: authorize('director', 'cashier')
 */
function authorize(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required.' });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                error: 'Access denied. Insufficient permissions.',
                required: allowedRoles,
                your_role: req.user.role
            });
        }

        next();
    };
}

module.exports = authorize;
