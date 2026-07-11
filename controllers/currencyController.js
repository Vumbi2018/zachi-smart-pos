/**
 * Currency rates controller.
 *
 * Strategy (in priority order):
 *   1. If the director has saved manual rates under
 *      `currency.rates` in system_settings, those take precedence
 *      over the live feed. This lets stores in countries where the
 *      published rate doesn't match the bank/cash rate (very common
 *      in Zambia) lock in their own working rate without editing
 *      code.
 *   2. Otherwise fall back to the live exchangerate-api.com feed,
 *      cached for an hour to stay well within the free quota.
 *   3. If both fail, return whatever stale data we still have in
 *      memory rather than 502'ing — the POS can keep operating with
 *      yesterday's number.
 *
 * The `currency.rates` JSONB shape is `{ "ZMW": 27.5, "EUR": 0.92 }`
 * — same as the API response — so the frontend doesn't have to know
 * which source it came from.
 */
const axios = require('axios');
const pool = require('../db/pool');

let ratesCache = null;
let lastFetch = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

async function loadOverrides() {
    try {
        const r = await pool.query(
            `SELECT setting_value FROM system_settings WHERE setting_key = 'currency.rates'`
        );
        if (r.rows.length === 0) return null;
        const v = r.rows[0].setting_value;
        // node-pg returns JSONB pre-parsed. Accept either {rates:{...}} or
        // a flat {CODE:rate} map for forward compatibility.
        if (v && typeof v === 'object') {
            if (v.rates && typeof v.rates === 'object') return v.rates;
            return v;
        }
        return null;
    } catch (e) {
        console.error('[currency] override lookup failed:', e.message);
        return null;
    }
}

exports.getRates = async (req, res) => {
    try {
        const overrides = await loadOverrides();

        const now = Date.now();
        const force = req.query && (req.query.refresh === '1' || req.query.refresh === 'true');
        let liveRates = null;
        let sourceUsed = 'cache';
        if (!force && ratesCache && (now - lastFetch < CACHE_DURATION)) {
            liveRates = ratesCache;
            sourceUsed = 'cache';
        } else {
            try {
                const response = await axios.get(
                    'https://api.exchangerate-api.com/v4/latest/USD',
                    { timeout: 5000 }
                );
                liveRates = response.data && response.data.rates ? response.data.rates : null;
                if (liveRates) {
                    ratesCache = liveRates;
                    lastFetch = now;
                    sourceUsed = 'live';
                }
            } catch (e) {
                console.error('[currency] live fetch failed:', e.message);
                liveRates = ratesCache; // stale ok
                sourceUsed = ratesCache ? 'stale-cache' : 'unavailable';
            }
        }

        const merged = Object.assign({}, liveRates || {}, overrides || {});
        if (Object.keys(merged).length === 0) {
            return res.status(502).json({ error: 'Failed to fetch exchange rates' });
        }
        // _meta key is namespaced with an underscore so it cannot clash with
        // any ISO-4217 currency code (always 3 uppercase letters).
        const ageMs = lastFetch ? (now - lastFetch) : null;
        merged._meta = {
            source: sourceUsed,
            base: 'USD',
            last_updated: lastFetch ? new Date(lastFetch).toISOString() : null,
            age_seconds: ageMs != null ? Math.round(ageMs / 1000) : null,
            stale: ageMs != null ? ageMs > CACHE_DURATION : true,
            override_codes: overrides ? Object.keys(overrides) : []
        };
        res.json(merged);
    } catch (error) {
        console.error('[currency] getRates fatal:', error.message);
        if (ratesCache) return res.json(ratesCache);
        res.status(502).json({ error: 'Failed to fetch exchange rates' });
    }
};

/**
 * GET /api/currency/overrides — returns just the manual overrides
 * stored under `currency.rates` (used by the Settings UI).
 */
exports.getOverrides = async (req, res) => {
    const overrides = await loadOverrides();
    res.json({ rates: overrides || {} });
};

/**
 * PUT /api/currency/overrides — director-only. Body: { rates: {CODE: number, ...} }.
 * Replaces (not merges) the manual override set. Pass {} to clear.
 */
exports.saveOverrides = async (req, res) => {
    try {
        const body = req.body || {};
        if (body.rates == null || typeof body.rates !== 'object' || Array.isArray(body.rates)) {
            return res.status(400).json({ error: 'Body must be { "rates": { "USD": 1, ... } }.' });
        }
        const incoming = body.rates;

        // Normalize: uppercase 3-letter codes mapped to positive numbers.
        // Reject the whole payload on any malformed entry so directors get
        // immediate feedback instead of silently dropped rows.
        const clean = {};
        const errors = [];
        for (const [k, v] of Object.entries(incoming)) {
            const code = String(k || '').trim().toUpperCase();
            if (!/^[A-Z]{3}$/.test(code)) { errors.push(`'${k}' is not a 3-letter currency code`); continue; }
            // Strict type check: reject booleans (Number(true)===1), arrays
            // (Number([27.5])===27.5), and other coerce-y values. Only accept
            // a real numeric primitive so directors cannot accidentally save
            // garbage that "looked numeric" through JSON quirks.
            if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
                errors.push(`${code}: rate must be a positive number, got ${JSON.stringify(v)}`);
                continue;
            }
            clean[code] = v;
        }
        if (errors.length > 0) {
            return res.status(400).json({ error: `Invalid currency overrides: ${errors.join('; ')}` });
        }

        await pool.query(
            `INSERT INTO system_settings (setting_key, setting_value, description)
                 VALUES ('currency.rates', $1::jsonb, 'Manual override of USD-based exchange rates. Wins over the live feed.')
             ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
            [JSON.stringify(clean)]
        );

        res.json({ rates: clean });
    } catch (e) {
        console.error('[currency] saveOverrides failed:', e.message);
        res.status(500).json({ error: 'Failed to save currency rates.' });
    }
};
