/**
 * Idempotency middleware.
 *
 * If the request carries an `Idempotency-Key` header (a UUID generated
 * by the client at the moment the operation was queued):
 *
 *   1. Look the key up in `idempotency_keys`.
 *      - If present AND the request fingerprint matches, replay the
 *        cached status code and JSON response without re-executing.
 *      - If present BUT the request fingerprint differs, return 409
 *        (the client has reused a key for a different request, which
 *        is almost certainly a bug we want surfaced loudly).
 *
 *   2. Otherwise wrap `res.json` so that a successful (2xx) response
 *      is persisted alongside the key for at least 30 days.
 *
 * The middleware is a no-op when the header is absent so that legacy
 * callers (browser fetch from a freshly opened tab) keep working.
 *
 * Cleanup is the caller's responsibility — see scripts/cleanup-idempotency.js
 * which can be wired to a cron job.
 */

const crypto = require('crypto');
const pool = require('../db/pool');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fingerprint(req) {
    const body = req.body && Object.keys(req.body).length ? JSON.stringify(req.body) : '';
    return crypto
        .createHash('sha256')
        .update(`${req.method}|${req.originalUrl || req.url}|${body}`)
        .digest('hex');
}

function getKey(req) {
    const raw = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];
    if (!raw) return null;
    const k = String(raw).trim().toLowerCase();
    return UUID_RE.test(k) ? k : null;
}

function getDeviceId(req) {
    const raw = req.headers['x-device-id'];
    if (!raw) return null;
    const d = String(raw).trim().toLowerCase();
    return UUID_RE.test(d) ? d : null;
}

function idempotency() {
    return async function idempotencyMiddleware(req, res, next) {
        const rawKey = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];
        if (!rawKey) return next();

        // Spec: a malformed Idempotency-Key is a client bug — return
        // 400 immediately rather than silently falling through, which
        // would let a buggy client double-write thinking it had retry
        // protection.
        const key = String(rawKey).trim().toLowerCase();
        if (!UUID_RE.test(key)) {
            return res.status(400).json({
                error: 'Idempotency-Key must be a UUID.',
                code: 'IDEMPOTENCY_KEY_MALFORMED',
            });
        }

        const hash = fingerprint(req);
        const userId = req.user && req.user.user_id ? req.user.user_id : null;
        const deviceId = getDeviceId(req);

        try {
            // Tenant-safe lookup: scope by (key, user_id). Without
            // this, user A's cached response would be replayed to
            // user B if B happened to reuse the same UUID, leaking
            // data across accounts. Migration 014c enforces the
            // matching uniqueness constraint at the schema level.
            const existing = await pool.query(
                `SELECT request_hash, status_code, response_json
                   FROM idempotency_keys
                  WHERE key = $1
                    AND user_id IS NOT DISTINCT FROM $2`,
                [key, userId]
            );

            if (existing.rows.length > 0) {
                const row = existing.rows[0];
                if (row.request_hash !== hash) {
                    return res.status(409).json({
                        error:
                            'Idempotency-Key reused for a different request. Generate a new key per operation.',
                        code: 'IDEMPOTENCY_KEY_MISMATCH',
                    });
                }
                // Replay the original outcome.
                res.set('Idempotent-Replay', 'true');
                return res.status(row.status_code).json(row.response_json);
            }
        } catch (err) {
            // Log and fall through — better to risk a duplicate than to
            // refuse all writes when the cache table is unreachable.
            console.error('[idempotency] lookup failed:', err.message);
            return next();
        }

        // Patch res.json so we persist the response on success BEFORE
        // sending the bytes back. Persisting after the fact races with
        // a fast-following retry that may arrive before the INSERT
        // completes, defeating idempotency entirely.
        const originalJson = res.json.bind(res);
        res.json = function patchedJson(body) {
            const status = res.statusCode || 200;
            if (status < 200 || status >= 300) {
                return originalJson(body);
            }
            // Block the response until the cache row is committed so a
            // retry that arrives milliseconds later sees the cache hit.
            // ON CONFLICT targets the (key, COALESCE(user_id,0))
            // unique index from migration 014c.
            pool
                .query(
                    `INSERT INTO idempotency_keys
                        (key, endpoint, method, request_hash, status_code, response_json, user_id, device_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                     ON CONFLICT (key, COALESCE(user_id, 0)) DO NOTHING`,
                    [
                        key,
                        (req.originalUrl || req.url).slice(0, 255),
                        req.method,
                        hash,
                        status,
                        body == null ? {} : body,
                        userId,
                        deviceId,
                    ]
                )
                .catch((err) => console.error('[idempotency] persist failed:', err.message))
                .finally(() => originalJson(body));
            return res;
        };

        next();
    };
}

module.exports = idempotency;
module.exports.fingerprint = fingerprint;
module.exports.getDeviceId = getDeviceId;
