/**
 * CSP hardening regression test.
 *
 * Task #5 removed `script-src-attr 'unsafe-inline'` and Task #7 then
 * removed `'unsafe-inline'` from `style-src` itself. All ~390 legacy
 * `style="…"` attributes were migrated to `data-style="…"` and are
 * applied via the CSSOM by `public/js/utils/data-style.js`. This test
 * boots the express app on an ephemeral port, hits `/`, and asserts that:
 *
 *   1. A `Content-Security-Policy` header is sent.
 *   2. It does NOT include `script-src-attr 'unsafe-inline'`
 *      (i.e. inline event handlers are forbidden by the browser).
 *   3. `script-src` itself does NOT include `'unsafe-inline'`
 *      (already true, but locked in for regression).
 *   4. `style-src` does NOT include `'unsafe-inline'` — `style-src-attr`
 *      inherits from it and therefore blocks `style="…"` injection
 *      (the clickjacking / phishing-overlay vector this task targets).
 *
 * The test does not require a database connection — the helmet middleware
 * runs before any DB query.
 */
const path = require('path');

let app;
let server;
let baseUrl;

beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-not-used-in-prod';
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    // server.js requires DATABASE_URL even outside production — supply a
    // dummy value so the env-validation gate passes. We never query the DB.
    process.env.DATABASE_URL = process.env.DATABASE_URL
        || 'postgres://csp-test@127.0.0.1:5432/csp-test';
    process.env.PORT = '0';

    app = require(path.resolve(__dirname, '..', 'server'));

    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
            baseUrl = `http://127.0.0.1:${server.address().port}`;
            resolve();
        });
    });
}, 30_000);

afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
});

test('CSP header omits script-src-attr unsafe-inline', async () => {
    const res = await fetch(`${baseUrl}/`);
    const csp = res.headers.get('content-security-policy');
    expect(csp).toBeTruthy();

    // No script-src-attr directive at all (so it falls back to script-src,
    // which forbids inline event handlers).
    expect(csp).not.toMatch(/script-src-attr\s+[^;]*'unsafe-inline'/i);

    // Defence-in-depth: script-src must also be free of 'unsafe-inline'.
    const scriptSrc = csp.split(';').map(s => s.trim()).find(d => /^script-src\b/i.test(d));
    expect(scriptSrc).toBeTruthy();
    expect(scriptSrc).not.toMatch(/'unsafe-inline'/);
});

test("CSP header's style-src omits 'unsafe-inline' (Task #7)", async () => {
    const res = await fetch(`${baseUrl}/`);
    const csp = res.headers.get('content-security-policy');
    expect(csp).toBeTruthy();

    const directives = csp.split(';').map(s => s.trim()).filter(Boolean);

    // style-src must be present and must NOT contain 'unsafe-inline'. With
    // style-src-attr unset, it inherits from style-src and therefore blocks
    // any `style="…"` HTML attribute — the migration to `data-style="…"` +
    // CSSOM-based application makes this safe.
    const styleSrc = directives.find(d => /^style-src\b/i.test(d) && !/^style-src-/i.test(d));
    expect(styleSrc).toBeTruthy();
    expect(styleSrc).not.toMatch(/'unsafe-inline'/);

    // No explicit style-src-attr that re-allows inline (would silently
    // re-introduce the very vector this task removes).
    expect(csp).not.toMatch(/style-src-attr\s+[^;]*'unsafe-inline'/i);
});
