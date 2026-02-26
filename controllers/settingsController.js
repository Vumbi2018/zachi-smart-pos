const pool = require('../db/pool');

// Get all settings as a key-value object
exports.getSettings = async (req, res) => {
    try {
        const result = await pool.query('SELECT setting_key, setting_value FROM system_settings');
        const settings = {};
        result.rows.forEach(row => {
            settings[row.setting_key] = row.setting_value;
        });
        res.json(settings);
    } catch (err) {
        console.error('Error fetching settings:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

// Update a specific setting
exports.updateSetting = async (req, res) => {
    const { key } = req.params;
    const { value } = req.body;

    try {
        const result = await pool.query(
            `INSERT INTO system_settings (setting_key, setting_value, updated_at, updated_by)
             VALUES ($1, $2, NOW(), $3)
             ON CONFLICT (setting_key) 
             DO UPDATE SET setting_value = $2, updated_at = NOW(), updated_by = $3
             RETURNING *`,
            [key, value, req.user.user_id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating setting:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

// Middleware helper to check if a module is enabled
// Usage: router.use(checkModule('modules.jobs'))
exports.checkModule = (moduleKey) => {
    return async (req, res, next) => {
        try {
            const result = await pool.query(
                'SELECT setting_value FROM system_settings WHERE setting_key = $1',
                [moduleKey]
            );

            // If setting doesn't exist, assume enabled (legacy behavior) or disabled?
            // Let's assume DISABLED if not found, for safety. 
            // BUT, our migration seeded them as true.

            if (result.rows.length === 0) {
                // Fallback: if not in DB, allow it? No, better to be explicit.
                // But for stability, maybe allow.
                // Actually, let's block if explicitly false.
                return next();
            }

            const isEnabled = result.rows[0].setting_value;
            if (isEnabled === true || isEnabled === 'true') {
                next();
            } else {
                res.status(403).json({ error: `Module ${moduleKey} is disabled.` });
            }
        } catch (err) {
            console.error('Module check error:', err);
            // Fail open or closed? Closed for security/stability.
            res.status(500).json({ error: 'Server error verifying module status' });
        }
    };
};
