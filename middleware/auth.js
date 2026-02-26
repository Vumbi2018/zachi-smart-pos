const jwt = require('jsonwebtoken');

/**
 * JWT Authentication Middleware
 * Verifies the token and attaches user info to req.user
 * Accepts: Authorization: Bearer <token> header ONLY
 * NOTE: Query-string token (?token=) is intentionally NOT supported (security risk).
 */
function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // { user_id, username, role, full_name }
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token.' });
    }
}

module.exports = authenticate;
