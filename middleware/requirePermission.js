/**
 * requirePermission.js
 *
 * Express middleware factory: requirePermission('invoice.send')
 * checks the authenticated user's *effective* permission set
 * (role defaults ∪ grants − denies) and 403's if the named permission
 * isn't present. Director always passes.
 *
 * Falls back to a hard 403 on any resolver error so a database hiccup
 * never opens up access by accident. Resolution failures are logged.
 *
 * NOTE: existing routes intentionally remain role-based (`authorize`).
 * This middleware exists so new endpoints (and a few hand-picked old
 * ones) can opt in to per-user override-aware checks WITHOUT a
 * platform-wide migration.
 */
'use strict';

const { resolveEffectivePermissions } = require('../services/userPermissions');

function requirePermission(permName) {
    if (!permName || typeof permName !== 'string') {
        throw new Error('requirePermission(name) needs a non-empty permission name');
    }
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required.' });
        }
        // Director short-circuit. Lines up with the rest of the codebase:
        // the role is treated as a super-user.
        if (req.user.role === 'director') return next();

        try {
            const set = await resolveEffectivePermissions(null, req.user.user_id);
            if (set.has(permName)) return next();
            return res.status(403).json({
                error: 'Access denied. Missing required permission.',
                required: permName,
                your_role: req.user.role,
            });
        } catch (e) {
            console.error('[requirePermission] resolver failed:', e.message);
            return res.status(500).json({ error: 'Permission resolver error.' });
        }
    };
}

module.exports = requirePermission;
