const pool = require('../db/pool');
const settingsCache = require('../utils/settingsCache');

// GET /api/settings — return all key/value pairs
exports.getSettings = async (req, res) => {
    try {
        const result = await pool.query('SELECT setting_key, setting_value FROM system_settings');
        const settings = {};
        result.rows.forEach((row) => {
            settings[row.setting_key] = row.setting_value;
        });
        res.json(settings);
    } catch (err) {
        console.error('Error fetching settings:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

// PUT /api/settings/:key — upsert a single setting and invalidate the cache
exports.updateSetting = async (req, res) => {
    const { key } = req.params;
    const { value } = req.body;

    try {
        // setting_value is jsonb. node-pg serialises JS arrays as Postgres
        // text[] (`{a,b}`) which is invalid JSON, so we explicitly stringify
        // and cast. Scalars (string/number/boolean/null) round-trip cleanly
        // through JSON.stringify too.
        const jsonValue = JSON.stringify(value === undefined ? null : value);
        const result = await pool.query(
            `INSERT INTO system_settings (setting_key, setting_value, updated_at, updated_by)
             VALUES ($1, $2::jsonb, NOW(), $3)
             ON CONFLICT (setting_key)
             DO UPDATE SET setting_value = $2::jsonb, updated_at = NOW(), updated_by = $3
             RETURNING *`,
            [key, jsonValue, req.user.user_id]
        );

        // Invalidate the in-process settingsCache for this key so the next
        // sale (and every other consumer) picks up the new value
        // immediately instead of waiting for the 60-second TTL.
        settingsCache.invalidate(key);

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating setting:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

// Module-feature gate. Used as middleware: router.use(checkModule('modules.jobs'))
// Behaviour:
//   - Setting missing      → allow (back-compat with un-seeded databases).
//   - Setting === true/'true' → allow.
//   - Anything else         → 403 with a stable error payload.
exports.checkModule = (moduleKey) => {
    return async (req, res, next) => {
        try {
            const result = await pool.query(
                'SELECT setting_value FROM system_settings WHERE setting_key = $1',
                [moduleKey]
            );

            if (result.rows.length === 0) {
                return next();
            }

            const isEnabled = result.rows[0].setting_value;
            if (isEnabled === true || isEnabled === 'true') {
                return next();
            }
            return res.status(403).json({ error: `Module ${moduleKey} is disabled.` });
        } catch (err) {
            console.error('Module check error:', err);
            res.status(500).json({ error: 'Server error verifying module status' });
        }
    };
};
