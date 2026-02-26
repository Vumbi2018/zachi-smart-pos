const pool = require('../db/pool');

/**
 * Audit Logging Middleware
 * Logs critical actions (CREATE, UPDATE, DELETE, VOID) to audit_logs table
 */
function auditLog(action, tableName) {
    return async (req, res, next) => {
        // Store original json method to intercept response
        const originalJson = res.json.bind(res);

        res.json = function (data) {
            // Only log successful operations
            if (res.statusCode >= 200 && res.statusCode < 300) {
                // Sanitize sensitive fields
                const sanitize = (obj) => {
                    if (!obj || typeof obj !== 'object') return obj;
                    const sensitiveFields = ['password', 'token', 'secret', 'key', 'credit_card', 'pin'];
                    const clean = { ...obj };
                    Object.keys(clean).forEach(k => {
                        if (sensitiveFields.some(f => k.toLowerCase().includes(f))) {
                            clean[k] = '********';
                        }
                    });
                    return clean;
                };

                const logEntry = {
                    user_id: req.user ? req.user.user_id : null,
                    action: action,
                    table_name: tableName,
                    record_id: data?.id || data?.sale_id || data?.product_id || req.params.id || null,
                    old_value: req._auditOldValue ? JSON.stringify(sanitize(req._auditOldValue)) : null,
                    new_value: JSON.stringify(sanitize(req.body || {})),
                    ip_address: req.ip || req.connection.remoteAddress
                };

                // Fire and forget — don't block response
                pool.query(
                    `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, new_value, ip_address)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [logEntry.user_id, logEntry.action, logEntry.table_name, logEntry.record_id,
                    logEntry.old_value, logEntry.new_value, logEntry.ip_address]
                ).catch(err => console.error('Audit log error:', err.message));
            }

            return originalJson(data);
        };

        next();
    };
}

module.exports = auditLog;
