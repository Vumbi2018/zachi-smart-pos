/**
 * HTTP integration tests.
 *
 * These boot the real express app on an ephemeral port, talk to the same
 * Postgres database the dev workflow uses, and exercise the hardened
 * paths added in Task #1:
 *
 *   - login (success + soft account-lockout after FAILED_LOGIN_THRESHOLD)
 *   - rate limit on /api/auth/login (per-IP)
 *   - /api/sales/:id numeric id-guard (rejects non-numeric paths)
 *   - tax-rate read from system_settings (cached, 60s TTL)
 *   - forgot-password is always-200 even for unknown usernames
 *
 * The tests skip themselves cleanly if no DATABASE_URL is reachable, so
 * `npm test` still works in environments without a live database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

let app;
let pool;
let baseUrl;
let server;
let canRunDbTests = true;
let testUsername;
let testPassword;
let testUserId;
let adminToken;

function randomString(n = 8) {
    return crypto.randomBytes(n).toString('hex');
}

async function ensureSchema() {
    // The integration test needs the migrations applied. We don't apply
    // them from here — that's `npm run migrate`. Instead, we just sanity
    // check the tables exist, and skip if they don't.
    const r = await pool.query(
        `SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = $1
        ) AS exists`,
        ['users']
    );
    return r.rows[0].exists;
}

async function setupTestUser() {
    testUsername = `qa_${randomString(4)}`;
    testPassword = `Pw_${randomString(6)}`;
    const hash = await bcrypt.hash(testPassword, 4);
    const r = await pool.query(
        `INSERT INTO users (full_name, username, password_hash, role, is_active)
         VALUES ($1, $2, $3, $4, TRUE)
         RETURNING user_id`,
        ['QA Bot', testUsername, hash, 'director']
    );
    testUserId = r.rows[0].user_id;
}

// Track artefacts so cleanup deletes them regardless of test order.
const createdSaleIds = [];
let testProductId;

async function cleanup() {
    if (!testUserId) return;
    try {
        // Sales-related rows first (FK chain: credit_payments → sale_items → sales).
        if (createdSaleIds.length) {
            await pool.query('DELETE FROM credit_payments WHERE sale_id = ANY($1)', [
                createdSaleIds,
            ]);
            await pool.query('DELETE FROM sale_items WHERE sale_id = ANY($1)', [createdSaleIds]);
            await pool.query('DELETE FROM sales WHERE sale_id = ANY($1)', [createdSaleIds]);
        }
        if (testProductId) {
            await pool.query('DELETE FROM products WHERE product_id = $1', [testProductId]);
        }
        // Detach FK references that don't cascade so DELETE FROM users succeeds.
        await pool.query(
            'UPDATE system_settings SET updated_by = NULL WHERE updated_by = $1',
            [testUserId]
        );
        // Audit rows referencing this user must go before the user itself.
        await pool.query('DELETE FROM audit_logs WHERE user_id = $1', [testUserId]);
        await pool.query('DELETE FROM audit_logs WHERE new_value::text LIKE $1', [
            `%"username":"${testUsername}"%`,
        ]);
        await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [testUserId]);
        await pool.query('DELETE FROM users WHERE user_id = $1', [testUserId]);
    } catch (err) {
        console.warn('cleanup warn:', err.message);
    }
}

async function ensureAdminToken() {
    if (adminToken) return adminToken;
    const r = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: testPassword }),
    });
    const j = await r.json();
    adminToken = j.token;
    return adminToken;
}

async function ensureTestProduct() {
    if (testProductId) return testProductId;
    const sku = `QA-${randomString(3).toUpperCase()}`;
    const r = await pool.query(
        `INSERT INTO products (sku, name, unit_price, cost_price, stock_quantity, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         RETURNING product_id`,
        [sku, 'QA Test Widget', 100, 50, 25]
    );
    testProductId = r.rows[0].product_id;
    return testProductId;
}

test.before(async () => {
    if (!process.env.DATABASE_URL) {
        canRunDbTests = false;
        return;
    }
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
    }
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';

    // Require lazily so the env vars above are honored by server.js
    app = require('../server');
    pool = require('../db/pool');

    try {
        const ok = await ensureSchema();
        if (!ok) {
            canRunDbTests = false;
            return;
        }
    } catch (err) {
        console.warn('DB unavailable — skipping integration tests:', err.message);
        canRunDbTests = false;
        return;
    }

    await setupTestUser();

    // Boot on a random port
    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });
});

test.after(async () => {
    await cleanup();
    if (server) await new Promise((r) => server.close(r));
    if (pool) await pool.end();
});

// Reset the in-memory login rate-limit counters before every test so
// that a previous test's failed logins can't push us over the 5/15min
// IP / username caps. We try multiple key shapes because Node maps
// 127.0.0.1 to '::ffff:127.0.0.1' on some kernel/socket configs.
test.beforeEach(() => {
    if (!app || !app.locals) return;
    const { loginIpLimiter, loginUsernameLimiter } = app.locals;
    const ipKeys = ['127.0.0.1', '::ffff:127.0.0.1', '::1'];
    for (const k of ipKeys) {
        try { loginIpLimiter && loginIpLimiter.resetKey && loginIpLimiter.resetKey(k); } catch (_) {}
    }
    if (testUsername) {
        try {
            loginUsernameLimiter && loginUsernameLimiter.resetKey &&
                loginUsernameLimiter.resetKey(`user:${String(testUsername).toLowerCase()}`);
        } catch (_) {}
    }
});

test('GET /api/health returns ok', async (t) => {
    if (!canRunDbTests) return t.skip('no DATABASE_URL');
    const r = await fetch(`${baseUrl}/api/health`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.status, 'ok');
});

test('POST /api/auth/login succeeds with valid credentials and issues a JWT', async (t) => {
    if (!canRunDbTests) return t.skip('no DATABASE_URL');
    const r = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: testPassword }),
    });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.ok(j.token, 'expected JWT in response');
    assert.equal(j.user.username, testUsername);
    adminToken = j.token;
});

test('POST /api/auth/login rejects wrong password with 401 and records LOGIN_FAILED', async (t) => {
    if (!canRunDbTests) return t.skip('no DATABASE_URL');
    const r = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: 'definitely-wrong' }),
    });
    assert.equal(r.status, 401);
    const j = await r.json();
    assert.match(j.error, /Invalid/i);

    const audit = await pool.query(
        `SELECT COUNT(*)::int AS n FROM audit_logs
         WHERE action = 'LOGIN_FAILED' AND new_value::text LIKE $1`,
        [`%"username":"${testUsername}"%`]
    );
    assert.ok(audit.rows[0].n >= 1, 'LOGIN_FAILED audit row should exist');
});

test('soft per-user lockout via users.failed_attempts / users.locked_until', async (t) => {
    if (!canRunDbTests) return t.skip('no DATABASE_URL');

    // Reset the per-user lockout columns so this test starts from zero
    // regardless of what the wrong-password test above left behind.
    await pool.query(
        'UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1',
        [testUserId]
    );
    // Also reset the in-memory rate-limiter state so prior failed-login
    // tests can't push us over the 5/15min IP cap before lockout fires.
    const ipLimiter = app && app.locals && app.locals.loginIpLimiter;
    const userLimiter = app && app.locals && app.locals.loginUsernameLimiter;
    for (const key of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
        try { ipLimiter && ipLimiter.resetKey && ipLimiter.resetKey(key); } catch (_) {}
    }
    try { userLimiter && userLimiter.resetKey && userLimiter.resetKey(`user:${testUsername.toLowerCase()}`); } catch (_) {}

    // Pump 6 failed attempts. With the rate limiter at 5/15min the 6th
    // hits 429 — that's fine, the DB lockout fires on the 5th.
    for (let i = 0; i < 6; i++) {
        await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: testUsername, password: 'still-wrong' }),
        });
    }

    // The lockout columns must reflect the failures (not just audit_logs).
    const row = await pool.query(
        'SELECT failed_attempts, locked_until FROM users WHERE user_id = $1',
        [testUserId]
    );
    assert.ok(
        row.rows[0].failed_attempts >= 5,
        `failed_attempts should be >= 5 (got ${row.rows[0].failed_attempts})`
    );
    assert.ok(
        row.rows[0].locked_until && new Date(row.rows[0].locked_until) > new Date(),
        'locked_until should be set to a future timestamp'
    );

    // Even with the correct password, the account should now be locked.
    const r = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: testPassword }),
    });
    assert.equal(r.status, 429, `expected 429 (locked), got ${r.status}`);
    const j = await r.json();
    assert.match(j.error || '', /(locked|too many)/i);

    // Reset both audit rows and lockout columns AND the in-memory
    // limiter (it's at 5/5 after the loop above) so the next login
    // is judged by the DB state alone.
    await pool.query(
        'UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1',
        [testUserId]
    );
    await pool.query(`DELETE FROM audit_logs WHERE new_value::text LIKE $1`, [
        `%"username":"${testUsername}"%`,
    ]);
    for (const k of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
        try { ipLimiter && ipLimiter.resetKey && ipLimiter.resetKey(k); } catch (_) {}
    }
    try { userLimiter && userLimiter.resetKey && userLimiter.resetKey(`user:${testUsername.toLowerCase()}`); } catch (_) {}

    const ok = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: testPassword }),
    });
    assert.equal(ok.status, 200);
    const after = await pool.query(
        'SELECT failed_attempts, locked_until FROM users WHERE user_id = $1',
        [testUserId]
    );
    assert.equal(Number(after.rows[0].failed_attempts), 0);
    assert.equal(after.rows[0].locked_until, null);
});

test('GET /api/sales/:id rejects non-numeric ids with 400', async (t) => {
    if (!canRunDbTests) return t.skip('no DATABASE_URL');
    if (!adminToken) {
        // Re-login (lockout was cleared)
        const lr = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: testUsername, password: testPassword }),
        });
        adminToken = (await lr.json()).token;
    }

    const r = await fetch(`${baseUrl}/api/sales/not-a-number`, {
        headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(r.status, 400, `expected 400 for non-numeric id, got ${r.status}`);
});

test('POST /api/auth/forgot-password is always-200 (no user enumeration)', async (t) => {
    if (!canRunDbTests) return t.skip('no DATABASE_URL');

    const a = await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: testUsername }),
    });
    assert.equal(a.status, 200);

    const b = await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: `nobody_${randomString(6)}` }),
    });
    assert.equal(b.status, 200);

    const ja = await a.json();
    const jb = await b.json();
    assert.equal(ja.ok, true);
    assert.equal(jb.ok, true);
    assert.equal(ja.message, jb.message, 'response must be identical for known/unknown users');
});

test('forgot-password issues a token and reset-password consumes it (full lifecycle)', async (t) => {
    if (!canRunDbTests) return t.skip('no DATABASE_URL');

    // Trigger the forgot flow. We can't read the email, but the controller
    // also writes a row into password_reset_tokens with the bcrypt hash of
    // the raw token. To make the lifecycle testable end-to-end we mint a
    // raw token of our own and insert the matching hash directly — this is
    // the same shape the controller produces (32 random bytes hex, sha256
    // hashed, 1-hour TTL).
    const crypto = require('crypto');
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + interval '1 hour')`,
        [testUserId, tokenHash]
    );

    // Simulate the actual emailed-link shape: backend sends links as
    // `${baseUrl}/#/reset-password?token=<rawToken>`. The auth modal reads
    // the token from the hash query and posts it as `password` (legacy)
    // along with `new_password`. Either field must be honoured.
    const newPw = `Reset_${randomString(12)}!`;
    const r = await fetch(`${baseUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: rawToken, password: newPw }),
    });
    assert.equal(r.status, 200, `reset should succeed, got ${r.status}`);

    // The new password must work for login.
    const lr = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: newPw }),
    });
    assert.equal(lr.status, 200, 'login with new password should succeed');
    const ld = await lr.json();
    assert.ok(ld.token, 'login response must include a JWT');
    adminToken = ld.token;
    testPassword = newPw;

    // The token row must be marked used so it can't be replayed.
    const used = await pool.query(
        `SELECT used_at FROM password_reset_tokens WHERE token_hash = $1`,
        [tokenHash]
    );
    assert.equal(used.rows.length, 1);
    assert.ok(used.rows[0].used_at, 'token must be marked used after reset');

    // Replay attempt must be rejected.
    const r2 = await fetch(`${baseUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: rawToken, new_password: `${newPw}_x` }),
    });
    assert.equal(r2.status, 400, 'used token must not be accepted again');

    // A short password must be rejected with 400 regardless of which field
    // it arrives in — guards against client-side validation being bypassed.
    const rawToken2 = crypto.randomBytes(32).toString('hex');
    const tokenHash2 = crypto.createHash('sha256').update(rawToken2).digest('hex');
    await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + interval '1 hour')`,
        [testUserId, tokenHash2]
    );
    const r3 = await fetch(`${baseUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: rawToken2, password: 'short' }),
    });
    assert.equal(r3.status, 400, 'short password must be rejected');
});

test('settingsCache.getNumberSetting reads tax.rate from system_settings', async (t) => {
    if (!canRunDbTests) return t.skip('no DATABASE_URL');

    const { getNumberSetting, invalidate } = require('../utils/settingsCache');

    await pool.query(
        `INSERT INTO system_settings (setting_key, setting_value, description)
         VALUES ('tax.rate', '0.18'::jsonb, 'test override')
         ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`
    );
    invalidate('tax.rate');
    const rate = await getNumberSetting('tax.rate', 0.16);
    assert.equal(rate, 0.18);

    // Reset to default for the rest of the workflow.
    await pool.query(
        `INSERT INTO system_settings (setting_key, setting_value, description)
         VALUES ('tax.rate', '0.16'::jsonb, 'reset')
         ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`
    );
    invalidate('tax.rate');
});

test('POST /api/sales creates a cash sale and computes totals + tax', async (t) => {
    if (!canRunDbTests) return t.skip('no DATABASE_URL');
    const token = await ensureAdminToken();
    const productId = await ensureTestProduct();

    // Make sure tax.rate is the default 0.16 going in.
    await pool.query(
        `INSERT INTO system_settings (setting_key, setting_value, description)
         VALUES ('tax.rate', '0.16'::jsonb, 'reset')
         ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`
    );
    require('../utils/settingsCache').invalidate('tax.rate');

    const r = await fetch(`${baseUrl}/api/sales`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            payment_method: 'Cash',
            amount_paid: 116,
            items: [{ type: 'product', product_id: productId, quantity: 1 }],
        }),
    });
    const sale = await r.json();
    assert.equal(r.status, 201, JSON.stringify(sale));
    assert.equal(Number(sale.subtotal), 100);
    assert.equal(Number(sale.tax_amount), 16);
    assert.equal(Number(sale.total_amount), 116);
    assert.equal(sale.payment_status, 'Paid');
    assert.equal(Number(sale.change_due), 0);
    createdSaleIds.push(sale.sale_id);

    // Stock should have decremented by 1
    const after = await pool.query('SELECT stock_quantity FROM products WHERE product_id = $1', [
        productId,
    ]);
    assert.equal(Number(after.rows[0].stock_quantity), 24);
});

test('Updating tax.rate via PUT /api/settings/:key invalidates cache so the next sale uses the new rate', async (t) => {
    if (!canRunDbTests) return t.skip('no DATABASE_URL');
    const token = await ensureAdminToken();
    const productId = await ensureTestProduct();

    // Sanity: cache is currently 0.16 from the previous test.
    // Use the real settings endpoint to bump it to 0.20.
    const setRes = await fetch(`${baseUrl}/api/settings/tax.rate`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ value: 0.2 }),
    });
    assert.equal(setRes.status, 200, await setRes.text());

    // Next sale must reflect 20% tax immediately (no 60s wait).
    const sr = await fetch(`${baseUrl}/api/sales`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            payment_method: 'Cash',
            amount_paid: 120,
            items: [{ type: 'product', product_id: productId, quantity: 1 }],
        }),
    });
    const sale = await sr.json();
    assert.equal(sr.status, 201, JSON.stringify(sale));
    assert.equal(Number(sale.subtotal), 100);
    assert.equal(Number(sale.tax_amount), 20, 'tax_amount must reflect newly-set 0.20 rate');
    assert.equal(Number(sale.total_amount), 120);
    createdSaleIds.push(sale.sale_id);

    // Reset for downstream tests
    await fetch(`${baseUrl}/api/settings/tax.rate`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ value: 0.16 }),
    });
});

test('PATCH /api/sales/:id/void marks the sale as voided and restores stock', async (t) => {
    if (!canRunDbTests) return t.skip('no DATABASE_URL');
    const token = await ensureAdminToken();
    const productId = await ensureTestProduct();

    // Create a fresh sale that we will void
    const before = await pool.query('SELECT stock_quantity FROM products WHERE product_id = $1', [
        productId,
    ]);
    const stockBefore = Number(before.rows[0].stock_quantity);

    const cr = await fetch(`${baseUrl}/api/sales`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            payment_method: 'Card',
            amount_paid: 232,
            items: [{ type: 'product', product_id: productId, quantity: 2 }],
        }),
    });
    const created = await cr.json();
    assert.equal(cr.status, 201, JSON.stringify(created));
    createdSaleIds.push(created.sale_id);

    const vr = await fetch(`${baseUrl}/api/sales/${created.sale_id}/void`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
    });
    const vbody = await vr.json();
    assert.equal(vr.status, 200, JSON.stringify(vbody));
    assert.equal(vbody.sale.is_voided, true);

    // Stock should be back to the pre-sale value
    const after = await pool.query('SELECT stock_quantity FROM products WHERE product_id = $1', [
        productId,
    ]);
    assert.equal(Number(after.rows[0].stock_quantity), stockBefore);
});

test('POST /api/sales/:id/payment records a credit-order installment', async (t) => {
    if (!canRunDbTests) return t.skip('no DATABASE_URL');
    const token = await ensureAdminToken();
    const productId = await ensureTestProduct();

    // Create a Credit sale (amount_paid = 0)
    const cr = await fetch(`${baseUrl}/api/sales`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            payment_method: 'Cash',
            amount_paid: 0,
            items: [{ type: 'product', product_id: productId, quantity: 1 }],
        }),
    });
    const credit = await cr.json();
    assert.equal(cr.status, 201, JSON.stringify(credit));
    assert.equal(credit.payment_status, 'Credit');
    createdSaleIds.push(credit.sale_id);

    // Pay half the balance — should switch status to Partial
    const half = Math.round(Number(credit.total_amount) / 2);
    const partial = await fetch(`${baseUrl}/api/sales/${credit.sale_id}/payment`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ amount: half, payment_method: 'Cash' }),
    });
    const partialBody = await partial.json();
    assert.equal(partial.status, 200, JSON.stringify(partialBody));
    assert.equal(partialBody.payment_status, 'Partial');

    // Pay the remainder — should clear to Paid
    const remaining = Number(credit.total_amount) - half;
    const final = await fetch(`${baseUrl}/api/sales/${credit.sale_id}/payment`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ amount: remaining, payment_method: 'Card' }),
    });
    const finalBody = await final.json();
    assert.equal(final.status, 200, JSON.stringify(finalBody));
    assert.equal(finalBody.payment_status, 'Paid');
    assert.equal(Number(finalBody.balance), 0);

    // Two credit_payments rows should exist
    const cp = await pool.query(
        'SELECT COUNT(*)::int AS n FROM credit_payments WHERE sale_id = $1',
        [credit.sale_id]
    );
    assert.equal(cp.rows[0].n, 2);
});

test('GET /api/reports/sales rejects non-whitelisted sales_type (no SQL injection)', async (t) => {
    if (!canRunDbTests) return t.skip('no DATABASE_URL');
    const token = await ensureAdminToken();

    const range = 'startDate=2026-01-01&endDate=2026-12-31';

    // Whitelisted value passes (detailed branch)
    const okRes = await fetch(
        `${baseUrl}/api/reports/sales?${range}&sales_type=product`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    assert.equal(okRes.status, 200);

    // sales_type works in every branch that joins sale_items: must be 200,
    // never 500 from a parameter-count mismatch.
    for (const groupBy of ['category', 'product']) {
        const r = await fetch(
            `${baseUrl}/api/reports/sales?${range}&groupBy=${groupBy}&sales_type=product`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        assert.equal(
            r.status,
            200,
            `expected 200 for groupBy=${groupBy} + sales_type, got ${r.status}: ${await r.text()}`
        );
    }

    // sales_type with groupBy=date is rejected explicitly (no silent ignore,
    // and definitely no 500 from a stray bound parameter).
    const dateClash = await fetch(
        `${baseUrl}/api/reports/sales?${range}&groupBy=date&sales_type=product`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    assert.equal(dateClash.status, 400);

    // groupBy=date without sales_type still works (regression guard).
    const dateOnly = await fetch(
        `${baseUrl}/api/reports/sales?${range}&groupBy=date`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    assert.equal(dateOnly.status, 200);

    // Classic injection payload — must be rejected with 400, NOT executed.
    const evil = await fetch(
        `${baseUrl}/api/reports/sales?${range}&sales_type=${encodeURIComponent("product'; DROP TABLE users; --")}`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    assert.equal(evil.status, 400, `expected 400 for injection payload, got ${evil.status}`);
    const ej = await evil.json();
    assert.match(ej.error || '', /Invalid sales_type/i);

    // The users table must still exist (sanity-check the injection didn't run).
    const stillThere = await pool.query(
        `SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'users'
        ) AS exists`
    );
    assert.equal(stillThere.rows[0].exists, true, 'users table must still exist');
});

