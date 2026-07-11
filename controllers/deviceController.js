/**
 * Device registration & directory.
 *
 * Each install (web PWA tab, Android wrapper, Windows wrapper) calls
 * POST /api/devices/register exactly once and stores the returned
 * device_id in localStorage. The id is sent on every subsequent API
 * call as `X-Device-Id: <uuid>` so we can:
 *   - record provenance on every mutating row,
 *   - guarantee that two clients picking up the same Idempotency-Key
 *     are routed to the cached response,
 *   - light up "tablet hasn't synced in 2h" alerts in the back office.
 */

const crypto = require('crypto');
const pool = require('../db/pool');

const VALID_PLATFORMS = new Set(['web', 'android', 'windows', 'ios', 'desktop', 'unknown']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normaliseDeviceId(raw) {
    if (!raw) return null;
    const id = String(raw).trim().toLowerCase();
    return UUID_RE.test(id) ? id : null;
}

/**
 * POST /api/devices/register
 * Body: { deviceId?, platform?, label? }
 *
 * If the client already has a device_id (from a prior registration in
 * localStorage) it sends it back; we upsert. Otherwise we mint a new
 * UUID v4 and return it.
 */
async function register(req, res) {
    try {
        const incoming = normaliseDeviceId(req.body && req.body.deviceId)
            || normaliseDeviceId(req.headers['x-device-id']);
        const deviceId = incoming || crypto.randomUUID();

        const platformRaw = (req.body && req.body.platform) || 'web';
        const platform = VALID_PLATFORMS.has(String(platformRaw).toLowerCase())
            ? String(platformRaw).toLowerCase()
            : 'unknown';

        const label = req.body && req.body.label
            ? String(req.body.label).slice(0, 100)
            : null;

        const userAgent = (req.headers['user-agent'] || '').slice(0, 500);
        const userId = req.user && req.user.user_id ? req.user.user_id : null;

        await pool.query(
            `INSERT INTO devices (device_id, user_id, platform, label, user_agent, last_seen_at)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
             ON CONFLICT (device_id) DO UPDATE
                SET user_id      = EXCLUDED.user_id,
                    platform     = EXCLUDED.platform,
                    label        = COALESCE(EXCLUDED.label, devices.label),
                    user_agent   = EXCLUDED.user_agent,
                    last_seen_at = CURRENT_TIMESTAMP`,
            [deviceId, userId, platform, label, userAgent]
        );

        return res.status(200).json({
            deviceId,
            platform,
            label,
            registeredAt: new Date().toISOString(),
        });
    } catch (err) {
        console.error('[devices.register]', err);
        return res.status(500).json({ error: 'Failed to register device.' });
    }
}

/**
 * GET /api/devices  (Director only)
 * Lists all known devices for the back-office dashboard.
 */
async function list(req, res) {
    try {
        const r = await pool.query(
            `SELECT d.device_id, d.platform, d.label, d.user_agent,
                    d.last_seen_at, d.created_at,
                    u.user_id, u.username, u.full_name
               FROM devices d
               LEFT JOIN users u ON u.user_id = d.user_id
              ORDER BY d.last_seen_at DESC NULLS LAST
              LIMIT 200`
        );
        return res.json({ devices: r.rows });
    } catch (err) {
        console.error('[devices.list]', err);
        return res.status(500).json({ error: 'Failed to list devices.' });
    }
}

/**
 * Convenience for other controllers/middleware: bump last_seen_at on
 * every authenticated call. Fire-and-forget, never blocks the request.
 */
function touchLastSeen(deviceId) {
    if (!normaliseDeviceId(deviceId)) return;
    pool
        .query('UPDATE devices SET last_seen_at = CURRENT_TIMESTAMP WHERE device_id = $1', [
            deviceId,
        ])
        .catch((err) => console.warn('[devices.touch]', err.message));
}

module.exports = { register, list, touchLastSeen, normaliseDeviceId };
