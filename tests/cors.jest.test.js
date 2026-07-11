/**
 * CORS allow-list regression tests.
 *
 * The login screen surfaced a "CORS blocked: …replit.dev:5000" error when
 * the SPA was opened through the Replit workspace preview. The dev/preview
 * hostname changes per Repl restart, so we allow-list the *.replit.dev /
 * *.replit.app / *.repl.co host pattern in non-prod rather than the exact
 * origin. Production deploys still rely on CORS_ORIGIN.
 */
const path = require('path');

let app;
let server;
let baseUrl;

beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-not-used-in-prod';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = process.env.DATABASE_URL
        || 'postgres://cors-test@127.0.0.1:5432/cors-test';
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

test('Replit dev preview origin is allowed in non-prod', async () => {
    const origin = 'https://e6e15dba-dd71-4723-9351-3efbdca9627e-00-1wbryprw3qwrg-fyv6h6ar.picard.replit.dev:5000';
    const res = await preflight(origin);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
});

test('Replit .app deploy origin is allowed in non-prod', async () => {
    const origin = 'https://my-pos.replit.app';
    const res = await preflight(origin);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
});

test('Capacitor and Tauri shell origins are allowed', async () => {
    for (const origin of ['capacitor://localhost', 'tauri://localhost']) {
        const res = await preflight(origin);
        expect(res.status).toBeLessThan(400);
        expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    }
});

test('Legacy *.repl.co dev origin is allowed in non-prod', async () => {
    const origin = 'https://my-pos.username.repl.co';
    const res = await preflight(origin);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
});

test.each([
    'https://evil.example.com',
    'https://attackerreplit.dev',           // missing the dot before "replit"
    'https://replit.dev.evil.com',          // replit.dev as a sub-label, not the suffix
    'https://x.repl.co.evil.com',           // repl.co as a sub-label
    'https://notreplit.app',                // missing the dot
])('Lookalike origin %s is rejected', async (origin) => {
    const res = await preflight(origin);
    // cors() rejection short-circuits with a 500 on this codebase; either
    // way the Access-Control-Allow-Origin header must NOT echo the origin.
    expect(res.headers.get('access-control-allow-origin')).not.toBe(origin);
});

test('Same-origin / no-Origin requests are allowed', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    // /api/health may 404 if the route doesn't exist, but it must NOT 500
    // from the CORS middleware.
    expect([200, 204, 404]).toContain(res.status);
});
