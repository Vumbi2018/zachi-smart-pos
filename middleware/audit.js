const pool = require('../db/pool');

/**
 * Audit Logging Middleware
 * Logs critical actions (CREATE, UPDATE, DELETE, VOID) to audit_logs table.
 * Recursively scrubs sensitive fields anywhere in the payload tree.
 */
const SENSITIVE_KEY_RE = /(password|passcode|pwd|token|secret|api[_-]?key|jwt|bearer|auth(?!or)|credit[_-]?card|card[_-]?number|cvv|cvc|pin|otp|session)/i;
const MAX_DEPTH = 8;

function sanitize(value, depth = 0) {
    if (value == null || depth > MAX_DEPTH) return value;
    if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
    if (typeof value !== 'object') return value;
    if (value instanceof Date) return value;

    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (SENSITIVE_KEY_RE.test(k)) {
            out[k] = '********';
        } else {
            out[k] = sanitize(v, depth + 1);
        }
    }
    return out;
}

function safeStringify(value) {
    try {
        return JSON.stringify(sanitize(value));
    } catch {
        return null;
    }
}

function auditLog(action, tableName) {
    return function auditMiddleware(req, res, next) {
        const originalJson = res.json.bind(res);

        res.json = function (data) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const recordId =
                    (data && (data.id || data.sale_id || data.product_id || data.user_id)) ||
                    (req.params && req.params.id) ||
                    null;

                // device_id from the X-Device-Id header lets the
                // Director see in the audit trail which install (web,
                // tablet, Windows) ran each action.
                const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                const rawDevice = req.headers['x-device-id'];
                const deviceId = rawDevice && UUID_RE.test(String(rawDevice)) ? String(rawDevice).toLowerCase() : null;

                const entry = {
                    user_id: req.user ? req.user.user_id : null,
                    action,
                    table_name: tableName,
                    record_id: recordId,
                    old_value: req._auditOldValue ? safeStringify(req._auditOldValue) : null,
                    new_value: req.body ? safeStringify(req.body) : null,
                    ip_address: (req.ip || req.connection?.remoteAddress || '').slice(0, 64),
                    device_id: deviceId,
                };

                pool
                    .query(
                        `INSERT INTO audit_logs
                         (user_id, action, table_name, record_id, old_value, new_value, ip_address, device_id)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                        [
                            entry.user_id,
                            entry.action,
                            entry.table_name,
                            entry.record_id,
                            entry.old_value,
                            entry.new_value,
                            entry.ip_address,
                            entry.device_id,
                        ]
                    )
                    .catch((err) => console.error('Audit log error:', err.message));
            }

            return originalJson(data);
        };

        next();
    };
}

module.exports = auditLog;
module.exports.sanitize = sanitize;
