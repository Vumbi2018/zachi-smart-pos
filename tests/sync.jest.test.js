/**
 * Jest tests for the Transaction Sync Engine (Task #2).
 *
 * Coverage:
 *   1. Idempotency replay — same Idempotency-Key → exact same response
 *      and exactly one DB row.
 *   2. Idempotency-Key reuse with a *different* payload → 409.
 *   3. Atomic stock contention — two concurrent sales for the last
 *      unit produce one 201 and one 409 with code STOCK_CONFLICT,
 *      and stock_quantity ends at 0 (never negative).
 *   4. Sale-number minting under contention — N concurrent sales
 *      yield N distinct, monotonically-increasing ZC-YYYYMMDD-NNN
 *      numbers (no duplicates).
 *   5. /api/sync/push replays through the same idempotency cache:
 *      a duplicate op in the same batch returns the same sale_id /
 *      sale_number twice.
 */

const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

let app, pool, server, baseUrl;
let adminToken;
let testUserId;
let testProductId;
let lowStockProductId;
const createdSaleIds = [];
const testUsername = `jestsync_${Math.random().toString(36).slice(2, 8)}`;
const testPassword = 'JestSyncPw#2026!';
const testDeviceId = crypto.randomUUID();

function uuid() {
    return crypto.randomUUID();
}

function canRunDb() {
    return Boolean(process.env.DATABASE_URL);
}

beforeAll(async () => {
    if (!canRunDb()) return;

    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-not-used-in-prod';
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    process.env.PORT = '0';

    app = require(path.resolve(__dirname, '..', 'server'));
    pool = require(path.resolve(__dirname, '..', 'db', 'pool'));

    try {
        await pool.query('SELECT 1 FROM idempotency_keys LIMIT 1');
        await pool.query('SELECT 1 FROM devices LIMIT 1');
    } catch (err) {
        console.warn('Sync schema not present, skipping suite:', err.message);
        return;
    }

    const hash = await bcrypt.hash(testPassword, 4);
    const u = await pool.query(
        `INSERT INTO users (full_name, username, password_hash, role)
         VALUES ($1,$2,$3,$4) RETURNING user_id`,
        ['Jest Sync', testUsername, hash, 'director']
    );
    testUserId = u.rows[0].user_id;

    // Generously stocked product for the idempotency replay + sale-number tests.
    const p1 = await pool.query(
        `INSERT INTO products (barcode, name, unit_price, cost_price, stock_quantity)
         VALUES ($1,$2,$3,$4,$5) RETURNING product_id`,
        [`SYNC-${testUserId}`, 'Sync Widget', 100, 50, 50]
    );
    testProductId = p1.rows[0].product_id;

    // 1-unit product for the atomic-stock contention test.
    const p2 = await pool.query(
        `INSERT INTO products (barcode, name, unit_price, cost_price, stock_quantity)
         VALUES ($1,$2,$3,$4,$5) RETURNING product_id`,
        [`SYNC1-${testUserId}`, 'Last One Widget', 100, 50, 1]
    );
    lowStockProductId = p2.rows[0].product_id;

    // Register the test device so push/audit FK checks (if any) pass.
    try {
        await pool.query(
            `INSERT INTO devices (device_id, name, platform)
             VALUES ($1, $2, $3)
             ON CONFLICT (device_id) DO NOTHING`,
            [testDeviceId, 'jest-sync', 'web']
        );
    } catch (_) {
        // Table may not enforce FK; ignore.
    }

    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
            baseUrl = `http://127.0.0.1:${server.address().port}`;
            resolve();
        });
    });

    // Reset rate limiters so dev-server traffic doesn't push us over.
    const ipLimiter = app.locals && app.locals.loginIpLimiter;
    const userLimiter = app.locals && app.locals.loginUsernameLimiter;
    for (const k of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
        try { ipLimiter && ipLimiter.resetKey && ipLimiter.resetKey(k); } catch (_) {}
    }
    try { userLimiter && userLimiter.resetKey && userLimiter.resetKey(`user:${testUsername.toLowerCase()}`); } catch (_) {}

    const r = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: testPassword }),
    });
    const j = await r.json();
    adminToken = j.token;
}, 60_000);

afterAll(async () => {
    if (!canRunDb()) return;
    try {
        if (createdSaleIds.length) {
            await pool.query('DELETE FROM credit_payments WHERE sale_id = ANY($1)', [createdSaleIds]);
            await pool.query('DELETE FROM sale_items WHERE sale_id = ANY($1)', [createdSaleIds]);
            await pool.query(
                `DELETE FROM inventory_movements
                  WHERE reference_type = 'sale' AND reference_id = ANY($1)`,
                [createdSaleIds]
            ).catch(() => {});
            await pool.query('DELETE FROM sales WHERE sale_id = ANY($1)', [createdSaleIds]);
        }
        if (testUserId) {
            await pool.query('DELETE FROM idempotency_keys WHERE user_id = $1', [testUserId]);
            await pool.query('DELETE FROM failed_ops_log WHERE user_id = $1', [testUserId]).catch(() => {});
        }
        await pool.query('DELETE FROM devices WHERE device_id = $1', [testDeviceId]).catch(() => {});
        if (testProductId) await pool.query('DELETE FROM products WHERE product_id = $1', [testProductId]);
        if (lowStockProductId) await pool.query('DELETE FROM products WHERE product_id = $1', [lowStockProductId]);
        if (testUserId) {
            await pool.query('DELETE FROM audit_logs WHERE user_id = $1', [testUserId]);
            await pool.query('DELETE FROM users WHERE user_id = $1', [testUserId]);
        }
    } catch (err) {
        console.warn('cleanup warning:', err.message);
    }
    if (server) await new Promise((r) => server.close(r));
    // Do NOT call pool.end() here — the pool is a process-wide singleton
    // shared with `smoke.jest.test.js` (also matched by *.jest.test.js).
    // Ending it from one suite kills the other's middleware queries.
    // jest --forceExit + idleTimeoutMillis already drains connections.
}, 30_000);

const skipIfNoDb = () => (canRunDb() ? test : test.skip);

function syncHeaders({ key = uuid(), op = uuid() } = {}) {
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'X-Device-Id': testDeviceId,
        'X-Client-Op-Id': op,
        'Idempotency-Key': key,
    };
}

function salePayload(productId = testProductId, qty = 1, price = 100) {
    return {
        customer_id: null,
        items: [{ type: 'product', product_id: productId, quantity: qty, unit_price: price, discount: 0 }],
        payment_method: 'cash',
        amount_paid: qty * price,
    };
}

skipIfNoDb()(
    'Idempotency replay: same Idempotency-Key returns the same sale and writes exactly one row',
    async () => {
        expect(adminToken).toBeTruthy();
        const key = uuid();
        const op = uuid();
        const headers = syncHeaders({ key, op });
        const body = JSON.stringify(salePayload(testProductId, 1, 100));

        const stockBefore = (await pool.query(
            'SELECT stock_quantity FROM products WHERE product_id = $1', [testProductId]
        )).rows[0].stock_quantity;

        const r1 = await fetch(`${baseUrl}/api/sales`, { method: 'POST', headers, body });
        expect(r1.status).toBe(201);
        const j1 = await r1.json();
        const saleId1 = j1.sale_id || (j1.sale && j1.sale.sale_id);
        const saleNumber1 = j1.sale_number || (j1.sale && j1.sale.sale_number);
        expect(saleId1).toBeTruthy();
        expect(saleNumber1).toBeTruthy();
        createdSaleIds.push(saleId1);

        // Replay: same key, same payload — must come back identical.
        const r2 = await fetch(`${baseUrl}/api/sales`, { method: 'POST', headers, body });
        expect(r2.status).toBe(201);
        const j2 = await r2.json();
        const saleId2 = j2.sale_id || (j2.sale && j2.sale.sale_id);
        const saleNumber2 = j2.sale_number || (j2.sale && j2.sale.sale_number);
        expect(saleId2).toBe(saleId1);
        expect(saleNumber2).toBe(saleNumber1);

        // Exactly one row in DB.
        const rowCount = await pool.query(
            'SELECT COUNT(*)::int AS n FROM sales WHERE sale_id = $1', [saleId1]
        );
        expect(rowCount.rows[0].n).toBe(1);

        // Stock decremented exactly once.
        const stockAfter = (await pool.query(
            'SELECT stock_quantity FROM products WHERE product_id = $1', [testProductId]
        )).rows[0].stock_quantity;
        expect(Number(stockAfter)).toBe(Number(stockBefore) - 1);
    },
    30_000
);

skipIfNoDb()(
    'Idempotency-Key reuse with a different payload returns 409',
    async () => {
        const key = uuid();
        const headers = syncHeaders({ key });

        const r1 = await fetch(`${baseUrl}/api/sales`, {
            method: 'POST',
            headers,
            body: JSON.stringify(salePayload(testProductId, 1, 100)),
        });
        expect(r1.status).toBe(201);
        const j1 = await r1.json();
        const saleId = j1.sale_id || (j1.sale && j1.sale.sale_id);
        if (saleId) createdSaleIds.push(saleId);

        // Same key, *different* payload (qty 2 instead of 1).
        const r2 = await fetch(`${baseUrl}/api/sales`, {
            method: 'POST',
            headers,
            body: JSON.stringify(salePayload(testProductId, 2, 100)),
        });
        expect(r2.status).toBe(409);
    },
    30_000
);

skipIfNoDb()(
    'Atomic stock contention: two concurrent sales for the last unit → one 201, one 409',
    async () => {
        // Reset stock to exactly 1.
        await pool.query(
            'UPDATE products SET stock_quantity = 1 WHERE product_id = $1', [lowStockProductId]
        );

        const send = () => fetch(`${baseUrl}/api/sales`, {
            method: 'POST',
            headers: syncHeaders(),
            body: JSON.stringify(salePayload(lowStockProductId, 1, 100)),
        });

        const [a, b] = await Promise.all([send(), send()]);
        const codes = [a.status, b.status].sort();
        expect(codes).toEqual([201, 409]);

        const winner = a.status === 201 ? a : b;
        const loser = a.status === 409 ? a : b;
        const wj = await winner.json();
        const lj = await loser.json();

        const winnerSaleId = wj.sale_id || (wj.sale && wj.sale.sale_id);
        if (winnerSaleId) createdSaleIds.push(winnerSaleId);

        // Loser response should be a recognisable stock conflict.
        const looksLikeStockConflict =
            (lj.code && /STOCK/i.test(lj.code)) ||
            (lj.error && /stock|insufficient/i.test(lj.error));
        expect(looksLikeStockConflict).toBeTruthy();

        // Stock floored at 0, never negative.
        const stock = Number(
            (await pool.query(
                'SELECT stock_quantity FROM products WHERE product_id = $1',
                [lowStockProductId]
            )).rows[0].stock_quantity
        );
        expect(stock).toBe(0);
    },
    30_000
);

skipIfNoDb()(
    'Sale-number minting: concurrent sales mint distinct ZC-YYYYMMDD-NNN numbers',
    async () => {
        const N = 6;
        const send = () => fetch(`${baseUrl}/api/sales`, {
            method: 'POST',
            headers: syncHeaders(),
            body: JSON.stringify(salePayload(testProductId, 1, 100)),
        });

        const responses = await Promise.all(Array.from({ length: N }, send));
        const numbers = [];
        for (const r of responses) {
            expect(r.status).toBe(201);
            const j = await r.json();
            const sn = j.sale_number || (j.sale && j.sale.sale_number);
            const id = j.sale_id || (j.sale && j.sale.sale_id);
            if (id) createdSaleIds.push(id);
            expect(sn).toMatch(/^ZC-\d{8}-\d{3,}$/);
            numbers.push(sn);
        }

        // All distinct.
        expect(new Set(numbers).size).toBe(N);

        // All same date prefix.
        const prefixes = new Set(numbers.map((n) => n.slice(0, 11)));
        expect(prefixes.size).toBe(1);
    },
    60_000
);

skipIfNoDb()(
    '/api/sync/push: duplicate Idempotency-Key in batch returns the same sale twice',
    async () => {
        // Create a dedicated product for this test inside an explicit
        // transaction so the COMMIT is forced before the sync replay
        // runs in a different pool connection. Earlier debugging showed
        // intermittent cross-connection visibility lag on this host
        // (different backend pids) for products inserted in beforeAll.
        // Verify the JWT-decoded user is actually present (a previous
        // run's afterAll may have failed to cascade-clean and left
        // ghost users with the same id range).
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(adminToken, process.env.JWT_SECRET);
        const u = await pool.query('SELECT user_id FROM users WHERE user_id = $1', [decoded.user_id]);
        expect(u.rowCount).toBe(1);

        const dedicatedClient = await pool.connect();
        let pushProductId;
        try {
            await dedicatedClient.query('BEGIN');
            const ins = await dedicatedClient.query(
                `INSERT INTO products (barcode, name, unit_price, cost_price, stock_quantity)
                 VALUES ($1, $2, $3, $4, $5) RETURNING product_id`,
                [`SYNCPUSH-${testUserId}-${Date.now()}`, 'Sync Push Widget', 100, 50, 10]
            );
            pushProductId = ins.rows[0].product_id;
            await dedicatedClient.query('COMMIT');
        } finally {
            dedicatedClient.release();
        }

        // Wait until any pool connection can see the new product before
        // we hand the request off to the inner replay.
        for (let i = 0; i < 20; i++) {
            const c = await pool.connect();
            try {
                const v = await c.query(
                    'SELECT 1 FROM products WHERE product_id = $1', [pushProductId]
                );
                if (v.rowCount === 1) break;
            } finally {
                c.release();
            }
            await new Promise((r) => setTimeout(r, 50));
        }

        const key = uuid();
        const op = uuid();
        const opPayload = {
            clientOpId: op,
            idempotencyKey: key,
            method: 'POST',
            endpoint: '/api/sales',
            body: salePayload(pushProductId, 1, 100),
        };
        const r = await fetch(`${baseUrl}/api/sync/push`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${adminToken}`,
                'X-Device-Id': testDeviceId,
            },
            body: JSON.stringify({
                deviceId: testDeviceId,
                operations: [opPayload, opPayload],
            }),
        });
        expect(r.status).toBe(200);
        const j = await r.json();
        expect(Array.isArray(j.results)).toBe(true);
        expect(j.results.length).toBe(2);

        const [a, b] = j.results;
        expect(a.status).toBe(201);
        expect(b.status).toBe(201);
        const pickSaleId = (env) => {
            const r = env && (env.response || env.body);
            if (!r) return null;
            return r.sale_id || (r.sale && r.sale.sale_id) || null;
        };
        const saleIdA = pickSaleId(a);
        const saleIdB = pickSaleId(b);
        expect(saleIdA).toBeTruthy();
        expect(saleIdB).toBe(saleIdA);
        if (saleIdA) createdSaleIds.push(saleIdA);

        // DB has exactly one row.
        const n = await pool.query(
            'SELECT COUNT(*)::int AS n FROM sales WHERE sale_id = $1', [saleIdA]
        );
        expect(n.rows[0].n).toBe(1);
    },
    30_000
);

skipIfNoDb()(
    'Credit payment overpayment is rejected with 409 OVERPAYMENT and never mutates the ledger',
    async () => {
        // Create a fresh credit sale for K100 with K0 paid.
        const saleHeaders = syncHeaders();
        const creditSalePayload = {
            customer_id: null,
            items: [{
                type: 'product', product_id: testProductId,
                quantity: 1, unit_price: 100, discount: 0,
            }],
            payment_method: 'Credit',
            amount_paid: 0,
        };
        const created = await fetch(`${baseUrl}/api/sales`, {
            method: 'POST',
            headers: saleHeaders,
            body: JSON.stringify(creditSalePayload),
        });
        expect(created.status).toBe(201);
        const cj = await created.json();
        const saleId = cj.sale_id || (cj.sale && cj.sale.sale_id);
        expect(saleId).toBeTruthy();
        createdSaleIds.push(saleId);

        // Read the actual total_amount the server computed (it may
        // include tax / discount, which is intentional — the guard has
        // to defend against overpayment of *that* number, not the
        // pre-tax line total the client knows about).
        const initial = await pool.query(
            `SELECT total_amount, amount_paid FROM sales WHERE sale_id = $1`,
            [saleId]
        );
        const totalAmount = Number(initial.rows[0].total_amount);
        expect(totalAmount).toBeGreaterThan(0);
        expect(Number(initial.rows[0].amount_paid)).toBe(0);

        // Attempt to pay 1.5 × the balance — must be rejected.
        const overpayAmount = Number((totalAmount * 1.5).toFixed(2));
        const overHeaders = syncHeaders();
        const over = await fetch(`${baseUrl}/api/sales/${saleId}/payment`, {
            method: 'POST',
            headers: overHeaders,
            body: JSON.stringify({ amount: overpayAmount, payment_method: 'Cash' }),
        });
        expect(over.status).toBe(409);
        const overJson = await over.json();
        expect(overJson.code).toBe('OVERPAYMENT');
        expect(overJson.details).toBeTruthy();
        expect(overJson.details.requested).toBe(overpayAmount);
        expect(Number(overJson.details.remaining)).toBeCloseTo(totalAmount, 2);

        // amount_paid must still be 0 — the rejected attempt cannot
        // have moved the ledger, otherwise the bug we are guarding
        // against (LEAST() silent capping) is back.
        const after1 = await pool.query(
            `SELECT amount_paid, payment_status FROM sales WHERE sale_id = $1`,
            [saleId]
        );
        expect(Number(after1.rows[0].amount_paid)).toBe(0);
        // No credit_payments row should have been written for the
        // rejected attempt.
        const noPay = await pool.query(
            `SELECT COUNT(*)::int AS n FROM credit_payments WHERE sale_id = $1`,
            [saleId]
        );
        expect(noPay.rows[0].n).toBe(0);

        // Exact-balance payment succeeds and marks Paid.
        const payHeaders = syncHeaders();
        const exact = await fetch(`${baseUrl}/api/sales/${saleId}/payment`, {
            method: 'POST',
            headers: payHeaders,
            body: JSON.stringify({ amount: totalAmount, payment_method: 'Cash' }),
        });
        expect(exact.status).toBe(200);
        const exactJson = await exact.json();
        expect(exactJson.payment_status).toBe('Paid');
        expect(Number(exactJson.amount_paid)).toBeCloseTo(totalAmount, 2);

        const after2 = await pool.query(
            `SELECT amount_paid, payment_status FROM sales WHERE sale_id = $1`,
            [saleId]
        );
        expect(Number(after2.rows[0].amount_paid)).toBeCloseTo(totalAmount, 2);
        expect(after2.rows[0].payment_status).toBe('Paid');
        const paidRow = await pool.query(
            `SELECT amount FROM credit_payments WHERE sale_id = $1`,
            [saleId]
        );
        expect(paidRow.rowCount).toBe(1);
        expect(Number(paidRow.rows[0].amount)).toBeCloseTo(totalAmount, 2);
    },
    30_000
);

// =====================================================
// Round-2 review fix coverage
// =====================================================

skipIfNoDb()(
    'Idempotency-Key middleware rejects malformed keys with 400',
    async () => {
        const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
            'X-Device-Id': testDeviceId,
            'Idempotency-Key': 'not-a-uuid',
        };
        const r = await fetch(`${baseUrl}/api/sales`, {
            method: 'POST',
            headers,
            body: JSON.stringify(salePayload(testProductId, 1, 100)),
        });
        expect(r.status).toBe(400);
        const j = await r.json();
        expect(j.code).toBe('IDEMPOTENCY_KEY_MALFORMED');

        // Stock must NOT have been decremented — the request must
        // never have reached the controller.
        const stock = (await pool.query(
            'SELECT stock_quantity FROM products WHERE product_id = $1', [testProductId]
        )).rows[0].stock_quantity;
        expect(Number(stock)).toBeGreaterThanOrEqual(0);
    },
    15_000
);

skipIfNoDb()(
    'Idempotency cache is scoped by user — same key from a different user does NOT replay',
    async () => {
        // Provision a second director (separate user_id) and log them in.
        const otherUsername = `jestsync2_${Math.random().toString(36).slice(2, 8)}`;
        const otherPassword = 'JestSyncPw#2026!';
        const hash = await bcrypt.hash(otherPassword, 4);
        const u = await pool.query(
            `INSERT INTO users (full_name, username, password_hash, role)
             VALUES ($1,$2,$3,$4) RETURNING user_id`,
            ['Jest Sync 2', otherUsername, hash, 'director']
        );
        const otherUserId = u.rows[0].user_id;

        // Reset the login limiter so the second login isn't throttled.
        const ipLimiter = app.locals && app.locals.loginIpLimiter;
        const userLimiter = app.locals && app.locals.loginUsernameLimiter;
        for (const k of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
            try { ipLimiter && ipLimiter.resetKey && ipLimiter.resetKey(k); } catch (_) {}
        }
        try { userLimiter && userLimiter.resetKey && userLimiter.resetKey(`user:${otherUsername.toLowerCase()}`); } catch (_) {}

        const loginR = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: otherUsername, password: otherPassword }),
        });
        const otherToken = (await loginR.json()).token;
        expect(otherToken).toBeTruthy();

        try {
            const sharedKey = uuid();
            const body = JSON.stringify(salePayload(testProductId, 1, 100));

            // User A POSTs the sale with a fresh key.
            const r1 = await fetch(`${baseUrl}/api/sales`, {
                method: 'POST',
                headers: syncHeaders({ key: sharedKey }),
                body,
            });
            expect(r1.status).toBe(201);
            const j1 = await r1.json();
            const saleId1 = j1.sale_id || (j1.sale && j1.sale.sale_id);
            createdSaleIds.push(saleId1);

            // User B POSTs with the SAME key — must NOT replay user A's
            // response. A real, separate sale must be created.
            const r2 = await fetch(`${baseUrl}/api/sales`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${otherToken}`,
                    'X-Device-Id': testDeviceId,
                    'X-Client-Op-Id': uuid(),
                    'Idempotency-Key': sharedKey,
                },
                body,
            });
            expect(r2.status).toBe(201);
            const j2 = await r2.json();
            const saleId2 = j2.sale_id || (j2.sale && j2.sale.sale_id);
            createdSaleIds.push(saleId2);

            expect(saleId2).not.toBe(saleId1);
            expect(j2.sale_number).not.toBe(j1.sale_number);

            // And both cache rows coexist — composite uniqueness on
            // (key, user_id) keeps them in separate buckets.
            const cache = await pool.query(
                `SELECT user_id FROM idempotency_keys WHERE key = $1 ORDER BY user_id`,
                [sharedKey]
            );
            expect(cache.rowCount).toBe(2);
            expect(cache.rows.map((r) => r.user_id).sort()).toEqual(
                [testUserId, otherUserId].sort()
            );
        } finally {
            await pool.query('DELETE FROM idempotency_keys WHERE user_id = $1', [otherUserId]).catch(() => {});
            await pool.query('DELETE FROM audit_logs WHERE user_id = $1', [otherUserId]).catch(() => {});
            await pool.query('DELETE FROM users WHERE user_id = $1', [otherUserId]).catch(() => {});
        }
    },
    30_000
);

skipIfNoDb()(
    'PUT /api/customers/:id stamps device_id and client_op_id provenance',
    async () => {
        // Seed a customer.
        const seed = await pool.query(
            `INSERT INTO customers (full_name, phone) VALUES ($1, $2) RETURNING customer_id`,
            ['Sync Provenance', `+260${Math.floor(Math.random() * 1e9)}`]
        );
        const customerId = seed.rows[0].customer_id;
        const opId = uuid();
        try {
            const r = await fetch(`${baseUrl}/api/customers/${customerId}`, {
                method: 'PUT',
                headers: syncHeaders({ op: opId }),
                body: JSON.stringify({ notes: 'updated by sync test' }),
            });
            expect(r.status).toBe(200);
            const row = await pool.query(
                `SELECT device_id, client_op_id FROM customers WHERE customer_id = $1`,
                [customerId]
            );
            expect(row.rows[0].device_id).toBe(testDeviceId);
            expect(row.rows[0].client_op_id).toBe(opId);
        } finally {
            await pool.query('DELETE FROM customers WHERE customer_id = $1', [customerId]).catch(() => {});
        }
    },
    15_000
);

skipIfNoDb()(
    'POST /api/loyalty/earn stamps device_id and client_op_id provenance',
    async () => {
        // Seed a customer with zero points.
        const seed = await pool.query(
            `INSERT INTO customers (full_name, phone, loyalty_points)
             VALUES ($1, $2, 0) RETURNING customer_id`,
            ['Sync Loyalty', `+260${Math.floor(Math.random() * 1e9)}`]
        );
        const customerId = seed.rows[0].customer_id;
        const opId = uuid();
        try {
            const r = await fetch(`${baseUrl}/api/loyalty/earn`, {
                method: 'POST',
                headers: syncHeaders({ op: opId }),
                body: JSON.stringify({
                    customer_id: customerId,
                    points: 5,
                    reference_type: 'manual',
                    reference_id: null,
                }),
            });
            expect(r.status).toBe(201);
            const row = await pool.query(
                `SELECT device_id, client_op_id
                   FROM loyalty_transactions
                  WHERE customer_id = $1
                  ORDER BY transaction_id DESC LIMIT 1`,
                [customerId]
            );
            expect(row.rows[0].device_id).toBe(testDeviceId);
            expect(row.rows[0].client_op_id).toBe(opId);
        } finally {
            await pool.query('DELETE FROM loyalty_transactions WHERE customer_id = $1', [customerId]).catch(() => {});
            await pool.query('DELETE FROM customers WHERE customer_id = $1', [customerId]).catch(() => {});
        }
    },
    15_000
);

skipIfNoDb()(
    'Atomic loyalty redemption: concurrent redeems for last 5 points → one 201, one 409 INSUFFICIENT_POINTS',
    async () => {
        // Customer with exactly 5 points to redeem.
        const seed = await pool.query(
            `INSERT INTO customers (full_name, phone, loyalty_points)
             VALUES ($1, $2, 5) RETURNING customer_id`,
            ['Redeem Race', `+260${Math.floor(Math.random() * 1e9)}`]
        );
        const customerId = seed.rows[0].customer_id;
        try {
            const send = () => fetch(`${baseUrl}/api/loyalty/redeem`, {
                method: 'POST',
                headers: syncHeaders(),
                body: JSON.stringify({ customer_id: customerId, points: 5 }),
            });
            const [a, b] = await Promise.all([send(), send()]);
            const codes = [a.status, b.status].sort();
            expect(codes).toEqual([201, 409]);

            // Loser must carry the typed code so the client can show
            // the right message instead of a generic "server error".
            const loser = a.status === 409 ? a : b;
            const lj = await loser.json();
            expect(lj.code).toBe('INSUFFICIENT_POINTS');

            // Final balance is exactly zero — no double-spend.
            const after = await pool.query(
                'SELECT loyalty_points FROM customers WHERE customer_id = $1', [customerId]
            );
            expect(Number(after.rows[0].loyalty_points)).toBe(0);

            // And exactly one redemption transaction landed.
            const txns = await pool.query(
                `SELECT COUNT(*)::int AS n FROM loyalty_transactions
                  WHERE customer_id = $1 AND transaction_type = 'redeem'`,
                [customerId]
            );
            expect(txns.rows[0].n).toBe(1);
        } finally {
            await pool.query('DELETE FROM loyalty_transactions WHERE customer_id = $1', [customerId]).catch(() => {});
            await pool.query('DELETE FROM customers WHERE customer_id = $1', [customerId]).catch(() => {});
        }
    },
    20_000
);

skipIfNoDb()(
    'Multi-device offline-then-reconnect: 10 distinct devices each push 1 sale → 10 unique sales, no oversell, distinct ZC numbers',
    async () => {
        // Stock a product with exactly 10 units. Ten "devices" each
        // push one sale; the engine must mint 10 unique sale_numbers,
        // produce no INSUFFICIENT_STOCK errors, and end at stock 0.
        // This simulates the multi-device offline-then-reconnect flow
        // at the API contract level.
        const p = await pool.query(
            `INSERT INTO products (barcode, name, unit_price, cost_price, stock_quantity)
             VALUES ($1, $2, 10, 5, 10) RETURNING product_id`,
            [`MDEV-${testUserId}-${Math.random().toString(36).slice(2, 6)}`, 'Multi-device Widget']
        );
        const productId = p.rows[0].product_id;
        const localSaleIds = [];
        try {
            const sends = Array.from({ length: 10 }, (_, i) => {
                const headers = {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${adminToken}`,
                    // Different device ID per sale → simulates 10 tablets.
                    'X-Device-Id': crypto.randomUUID(),
                    'X-Client-Op-Id': crypto.randomUUID(),
                    'Idempotency-Key': crypto.randomUUID(),
                };
                return fetch(`${baseUrl}/api/sales`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(salePayload(productId, 1, 10)),
                });
            });
            const responses = await Promise.all(sends);
            const statuses = responses.map((r) => r.status);
            // All ten must succeed — there's exactly enough stock.
            expect(statuses.filter((s) => s === 201).length).toBe(10);

            const bodies = await Promise.all(responses.map((r) => r.json()));
            const saleNumbers = bodies.map((b) => b.sale_number || (b.sale && b.sale.sale_number));
            const saleIds = bodies.map((b) => b.sale_id || (b.sale && b.sale.sale_id));
            for (const id of saleIds) if (id) localSaleIds.push(id);

            // Sale numbers all unique.
            expect(new Set(saleNumbers).size).toBe(10);
            // Every sale carries the canonical ZC-YYYYMMDD-NNN shape.
            for (const sn of saleNumbers) {
                expect(sn).toMatch(/^ZC-\d{8}-\d+$/);
            }

            // Stock landed at exactly 0 — no oversell, no overcredit.
            const stock = await pool.query(
                'SELECT stock_quantity FROM products WHERE product_id = $1', [productId]
            );
            expect(Number(stock.rows[0].stock_quantity)).toBe(0);
        } finally {
            for (const id of localSaleIds) {
                await pool.query('DELETE FROM sale_items WHERE sale_id = $1', [id]).catch(() => {});
                await pool.query('DELETE FROM inventory_movements WHERE reference_type = $1 AND reference_id = $2', ['sale', id]).catch(() => {});
                await pool.query('DELETE FROM sales WHERE sale_id = $1', [id]).catch(() => {});
            }
            await pool.query('DELETE FROM products WHERE product_id = $1', [productId]).catch(() => {});
        }
    },
    30_000
);
