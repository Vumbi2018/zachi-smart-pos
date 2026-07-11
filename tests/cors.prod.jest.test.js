/**
 * Production CORS gating regression test.
 *
 * The Replit dev/preview wildcard allow-list is intentionally gated on
 * `!IS_PROD`. This test boots a fresh server.js with NODE_ENV=production
 * and asserts that a *.replit.dev origin is NOT silently accepted — only
 * the explicit `CORS_ORIGIN` env var should allow-list real customer
 * domains in prod.
 *
 * Lives in its own file (not cors.jest.test.js) because IS_PROD is fixed
 * at module-load time and we need a clean require.
 */
const path = require('path');

let app;
let server;
let baseUrl;

beforeAll(async () => {
    // Strong, high-entropy secret so server.js's prod weak-secret check passes.
    process.env.JWT_SECRET = require('crypto').randomBytes(48).toString('hex');
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = process.env.DATABASE_URL
        || 'postgres://cors-prod-test@127.0.0.1:5432/cors-prod-test';
    process.env.CORS_ORIGIN = 'https://pos.zachicomputercentre.com';
    process.env.APP_BASE_URL = 'https://pos.zachicomputercentre.com';
    process.env.PORT = '0';

    // Force a fresh require so module-load-time IS_PROD picks up our env.
    jest.isolateModules(() => {
        app = require(path.resolve(__dirname, '..', 'server'));
    });

    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
            baseUrl = `http://127.0.0.1:${server.address().port}`;
            resolve();
        });
    });
}, 30_000);

afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    delete process.env.CORS_ORIGIN;
    process.env.NODE_ENV = 'test';
});

async function preflight(origin) {
    return fetch(`${baseUrl}/api/auth/login`, {
        method: 'OPTIONS',
        headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type',
        },
    });
}

test('Replit dev wildcard is NOT honoured in production', async () => {
    const origin = 'https://e6e15dba.picard.replit.dev:5000';
    const res = await preflight(origin);
    expect(res.headers.get('access-control-allow-origin')).not.toBe(origin);
});

test('Explicit CORS_ORIGIN entry IS allowed in production', async () => {
    const origin = 'https://pos.zachicomputercentre.com';
    const res = await preflight(origin);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
});
