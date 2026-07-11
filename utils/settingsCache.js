const pool = require('../db/pool');

/**
 * Tiny in-process cache for `system_settings` lookups.
 * Avoids hitting the DB on every sale just to read tax.rate.
 */
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // key -> { value, expires }

async function getSetting(key, fallback = null) {
    const cached = cache.get(key);
    const now = Date.now();
    if (cached && cached.expires > now) return cached.value;

    try {
        const r = await pool.query(
            'SELECT setting_value FROM system_settings WHERE setting_key = $1',
            [key]
        );
        let value = fallback;
        if (r.rows.length) {
            const raw = r.rows[0].setting_value;
            // setting_value is JSONB; pg may return a parsed value or string
            value = raw == null ? fallback : raw;
        }
        cache.set(key, { value, expires: now + CACHE_TTL_MS });
        return value;
    } catch (err) {
        console.error(`settingsCache: failed to read "${key}":`, err.message);
        return fallback;
    }
}

async function getNumberSetting(key, fallback = 0) {
    const v = await getSetting(key, fallback);
    if (v == null) return fallback;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/^"|"$/g, ''));
    return Number.isFinite(n) ? n : fallback;
}

function invalidate(key) {
    if (key) cache.delete(key);
    else cache.clear();
}

module.exports = { getSetting, getNumberSetting, invalidate };
