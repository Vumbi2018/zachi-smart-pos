/**
 * Transaction Sync Engine — push & pull endpoints.
 *
 * /api/sync/push
 *   Body: { deviceId, operations: [{ clientOpId, idempotencyKey,
 *                                    endpoint, method, body, queuedAt }] }
 *   Reply: { results: [{ clientOpId, status, response, error }] }
 *
 *   Each operation is replayed against the existing application
 *   handlers via an internal sub-request. We re-use the express app so
 *   every middleware (auth, idempotency, audit, atomic guards) fires
 *   exactly as if the request had come straight from `fetch`.
 *
 * /api/sync/pull?since=<ISO>&limit=N
 *   Returns the newest sales / customers / products that changed
 *   since the cursor so the client's IndexedDB cache stays fresh
 *   without having to refetch every list.
 */

const http = require('http');
const pool = require('../db/pool');
const deviceController = require('./deviceController');

const MAX_OPS_PER_PUSH = 100;
const DEFAULT_PULL_LIMIT = 200;
const MAX_PULL_LIMIT = 1000;

// Idempotency-key retention: 30 days. The cleanup runs lazily on each
// sync.push (rate-limited so we only hit the DB at most once per hour
// per process) so a deployment without a cron still stays bounded.
const IDEMPOTENCY_RETENTION_DAYS = 30;
const CLEANUP_MIN_INTERVAL_MS = 60 * 60 * 1000;
let lastCleanupAt = 0;

async function cleanupIdempotencyKeys() {
    const now = Date.now();
    if (now - lastCleanupAt < CLEANUP_MIN_INTERVAL_MS) return;
    lastCleanupAt = now;
    try {
        await pool.query(
            `DELETE FROM idempotency_keys
              WHERE created_at < NOW() - ($1 || ' days')::interval`,
            [String(IDEMPOTENCY_RETENTION_DAYS)]
        );
    } catch (err) {
        // Don't break sync just because the housekeeping failed; the
        // cron-driven scripts/cleanup-idempotency.js script will catch up.
        console.warn('[sync] idempotency cleanup failed:', err.message);
    }
}

function clampLimit(raw, def, max) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return def;
    return Math.min(n, max);
}

/**
 * Replay a single queued operation against the same Express server
 * via a real loopback HTTP request. We tried in-process app.handle()
 * with a Readable/IncomingMessage shim, but Express 5's body-parser
 * relies on stream events that the shim couldn't faithfully emit, so
 * the inner sales request would hang indefinitely. Loopback HTTP
 * costs ~1 ms locally and exercises the exact middleware stack the
 * client would hit.
 */
function replayOperation(baseReq, op) {
    return new Promise((resolve) => {
        const method = String(op.method || 'POST').toUpperCase();
        // Clients queue endpoints as the path the app code passes to
        // API.request() — e.g. "/customers" — because API.baseUrl ("/api")
        // is concatenated only at fetch time. Sync replays therefore arrive
        // here without the "/api/" prefix. Accept both forms and normalize
        // so the loopback request always hits the real router mount point.
        let endpoint = op.endpoint || '/';
        if (!endpoint.startsWith('/')) endpoint = `/${endpoint}`;
        if (!endpoint.startsWith('/api/')) {
            endpoint = `/api${endpoint}`;
        }

        // Disallow recursive sync calls — would loop forever.
        if (endpoint.startsWith('/api/sync/')) {
            return resolve({
                status: 400,
                error: { error: 'Cannot replay sync endpoints via push.' },
            });
        }

        const bodyJson = op.body == null ? '' : JSON.stringify(op.body);
        const bodyBuf = Buffer.from(bodyJson, 'utf8');

        // Forward the caller's auth header so the inner request runs
        // as the same operator. Strip hop-by-hop headers and override
        // the idempotency / client-op / device markers from the op.
        const baseHeaders = baseReq.headers || {};
        const headers = {
            'authorization': baseHeaders['authorization'] || '',
            'content-type': 'application/json; charset=utf-8',
            'content-length': String(bodyBuf.length),
            'accept': 'application/json',
        };
        if (op.idempotencyKey) headers['idempotency-key'] = op.idempotencyKey;
        if (op.clientOpId) headers['x-client-op-id'] = op.clientOpId;
        if (op.deviceId || baseHeaders['x-device-id']) {
            headers['x-device-id'] = op.deviceId || baseHeaders['x-device-id'];
        }
        for (const k of Object.keys(headers)) {
            if (!headers[k]) delete headers[k];
        }

        // The loopback target is whichever address/port the same
        // process is listening on. baseReq.socket exposes the local
        // bind address — that always works for both 127.0.0.1 in
        // tests and 0.0.0.0 in production.
        const sock = baseReq.socket || {};
        const host = sock.localAddress && sock.localAddress !== '::' ? sock.localAddress : '127.0.0.1';
        const port = sock.localPort;
        if (!port) {
            return resolve({
                status: 500,
                error: { error: 'Replay loopback: no local port on baseReq.' },
            });
        }

        const httpReq = http.request(
            {
                host: host.replace(/^::ffff:/, ''),
                port,
                method,
                path: endpoint,
                headers,
                timeout: 30_000,
            },
            (httpRes) => {
                const chunks = [];
                httpRes.on('data', (c) => chunks.push(c));
                httpRes.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    let parsed;
                    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
                    const code = httpRes.statusCode || 0;
                    if (code >= 200 && code < 300) {
                        resolve({ status: code, response: parsed });
                    } else {
                        resolve({ status: code, error: parsed });
                    }
                });
            }
        );
        httpReq.on('error', (err) => {
            resolve({
                status: 500,
                error: { error: err.message || 'Replay loopback failed' },
            });
        });
        httpReq.on('timeout', () => {
            httpReq.destroy(new Error('Replay loopback timed out'));
        });
        if (bodyBuf.length) httpReq.write(bodyBuf);
        httpReq.end();
    });
}

/**
 * POST /api/sync/push
 */
async function push(req, res) {
    const { deviceId, operations } = req.body || {};
    if (!Array.isArray(operations)) {
        return res.status(400).json({ error: 'operations[] is required.' });
    }
    if (operations.length === 0) {
        return res.json({ results: [] });
    }
    if (operations.length > MAX_OPS_PER_PUSH) {
        return res.status(400).json({
            error: `Too many operations in one batch. Max ${MAX_OPS_PER_PUSH}; received ${operations.length}.`,
        });
    }

    if (deviceId) deviceController.touchLastSeen(deviceId);

    // Lazy GC for the 30-day idempotency-key retention window. Runs at
    // most once per hour per process, so the bulk of pushes pay zero
    // overhead but the table never grows without bound.
    cleanupIdempotencyKeys();

    const results = [];

    for (const rawOp of operations) {
        const op = {
            clientOpId: rawOp && rawOp.clientOpId,
            idempotencyKey: rawOp && rawOp.idempotencyKey,
            endpoint: rawOp && rawOp.endpoint,
            method: rawOp && rawOp.method,
            body: rawOp && rawOp.body,
            queuedAt: rawOp && rawOp.queuedAt,
            deviceId: deviceId,
        };

        if (!op.endpoint || !op.method) {
            results.push({
                clientOpId: op.clientOpId,
                status: 400,
                error: { error: 'Each op needs endpoint + method.' },
            });
            continue;
        }

        let outcome;
        try {
            outcome = await replayOperation(req, op);
        } catch (err) {
            outcome = { status: 500, error: { error: err.message || 'replay error' } };
        }

        // Persist a server-side failed_ops_log row for any non-2xx so
        // the director can see what's stuck without reaching the device.
        if (outcome.status >= 400) {
            try {
                await pool.query(
                    `INSERT INTO failed_ops_log
                        (device_id, user_id, client_op_id, idempotency_key,
                         endpoint, method, request_body, error_code, error_message, queued_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                    [
                        deviceId || null,
                        req.user && req.user.user_id ? req.user.user_id : null,
                        op.clientOpId || null,
                        op.idempotencyKey || null,
                        op.endpoint.slice(0, 255),
                        op.method,
                        op.body == null ? null : op.body,
                        String(outcome.status),
                        outcome.error && outcome.error.error
                            ? String(outcome.error.error).slice(0, 500)
                            : null,
                        op.queuedAt ? new Date(op.queuedAt) : null,
                    ]
                );
            } catch (err) {
                console.warn('[sync.push] failed_ops_log write failed:', err.message);
            }
        }

        results.push({
            clientOpId: op.clientOpId,
            status: outcome.status,
            response: outcome.response,
            error: outcome.error,
        });
    }

    return res.json({
        serverTime: new Date().toISOString(),
        results,
    });
}

/**
 * GET /api/sync/pull?since=<ISO>
 * Returns deltas the client should refresh in its IndexedDB cache.
 *
 * Cursor: we filter by `updated_at`, NOT `transaction_date`. That
 * matters because voiding a sale, recording a credit-payment, or
 * importing a backdated receipt all leave `transaction_date` alone but
 * mutate the row. A cursor based on `transaction_date` would miss
 * those changes forever — once the sale was synced, the void could
 * never propagate. Migration 014b adds `sales.updated_at` with a touch
 * trigger so we get true "row-changed" semantics.
 *
 * Authorization scope:
 *   - director / manager        → see everything (back-office, reports)
 *   - cashier                   → only their own sales (privacy: a
 *                                  cashier on tablet A should not see
 *                                  what cashier B sold)
 *   - consultant                → no sales (catalog only — they don't
 *                                  ring transactions)
 *   Products and customers are returned to every signed-in role
 *   because every POS terminal needs the full catalog to operate.
 */
async function pull(req, res) {
    const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 24 * 3600 * 1000);
    if (Number.isNaN(since.getTime())) {
        return res.status(400).json({ error: 'Invalid `since` timestamp.' });
    }
    const limit = clampLimit(req.query.limit, DEFAULT_PULL_LIMIT, MAX_PULL_LIMIT);

    const deviceId = req.headers['x-device-id'];
    if (deviceId) deviceController.touchLastSeen(deviceId);

    const role = req.user && req.user.role ? String(req.user.role).toLowerCase() : '';
    const userId = req.user && req.user.user_id ? req.user.user_id : null;
    const seesAllSales = role === 'director' || role === 'manager';
    const seesNoSales = role === 'consultant';

    // Build the sales query / params dynamically so the scope is
    // applied as a SQL predicate (not a post-filter — a cashier with
    // 50k sales in the system shouldn't pay to ship them all over the
    // wire just so we can drop them client-side).
    let salesSql, salesParams;
    if (seesNoSales) {
        salesSql = null;
    } else if (seesAllSales) {
        salesSql = `SELECT sale_id, sale_number, customer_id, staff_id,
                        total_amount, payment_method, payment_status,
                        amount_paid, change_due, transaction_date,
                        is_voided, device_id, client_op_id, updated_at
                   FROM sales
                  WHERE updated_at > $1
                  ORDER BY updated_at ASC
                  LIMIT $2`;
        salesParams = [since, limit];
    } else {
        // cashier (or any other role): own sales only.
        salesSql = `SELECT sale_id, sale_number, customer_id, staff_id,
                        total_amount, payment_method, payment_status,
                        amount_paid, change_due, transaction_date,
                        is_voided, device_id, client_op_id, updated_at
                   FROM sales
                  WHERE updated_at > $1
                    AND staff_id = $2
                  ORDER BY updated_at ASC
                  LIMIT $3`;
        salesParams = [since, userId, limit];
    }

    try {
        const [salesR, productsR, customersR] = await Promise.all([
            salesSql ? pool.query(salesSql, salesParams) : Promise.resolve({ rows: [] }),
            pool.query(
                `SELECT product_id, name, sku, barcode, category,
                        unit_price, cost_price, stock_quantity,
                        reorder_level, is_active, updated_at
                   FROM products
                  WHERE updated_at > $1
                  ORDER BY updated_at ASC
                  LIMIT $2`,
                [since, limit]
            ),
            pool.query(
                `SELECT customer_id, full_name, phone, email,
                        company_name, customer_type, loyalty_points,
                        outstanding_balance, updated_at
                   FROM customers
                  WHERE updated_at > $1
                  ORDER BY updated_at ASC
                  LIMIT $2`,
                [since, limit]
            ),
        ]);

        // Compute next cursor as the most-recent updated_at we returned.
        const stamps = [
            ...salesR.rows.map((r) => r.updated_at),
            ...productsR.rows.map((r) => r.updated_at),
            ...customersR.rows.map((r) => r.updated_at),
        ].filter(Boolean);
        const cursor =
            stamps.length === 0
                ? since.toISOString()
                : new Date(Math.max.apply(null, stamps.map((d) => new Date(d).getTime()))).toISOString();

        return res.json({
            serverTime: new Date().toISOString(),
            cursor,
            scope: {
                role,
                sales: seesNoSales ? 'none' : seesAllSales ? 'all' : 'own',
            },
            sales: salesR.rows,
            products: productsR.rows,
            customers: customersR.rows,
        });
    } catch (err) {
        console.error('[sync.pull]', err);
        return res.status(500).json({ error: 'sync pull failed' });
    }
}

module.exports = { push, pull };
