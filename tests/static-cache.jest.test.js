/**
 * Static-asset cache headers regression test (Task #18).
 *
 * Before this task, apps/zachi-pos/public/index.html cache-busted JS/CSS by
 * appending hand-maintained `?v=2.9` query strings. They were forgotten on
 * deploys, so some users saw stale JS while others didn't. With CSP now
 * strict, a stale data-style.js cached at `?v=1.0` could quietly break the
 * UI. We replaced the manual scheme with:
 *
 *   1. No `?v=…` query strings on any /js/ or /css/ asset in index.html
 *      (so there's nothing to forget to bump).
 *   2. `Cache-Control: no-cache, must-revalidate` on every /js/* and /css/*
 *      response, paired with the strong ETag express.static already emits.
 *      This makes every refresh issue a conditional GET — fast 304 on no
 *      change, fresh body on any change.
 *   3. The shell (index.html) and service-worker.js stay `no-store`.
 *
 * If any of these regress, contributors will start seeing "I edited the
 * file but the browser still runs the old code" again, which is exactly
 * what this task eliminated.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

// Node's built-in fetch (undici) silently injects `cache-control: no-cache`
// and `pragma: no-cache` on every request, which forces Express's freshness
// check to skip ETag matching and always return 200. Real browsers only
// send those headers on hard-reload, not on a normal refresh. Use raw http
// here so the test mirrors the normal-refresh code path we actually care
// about — that's the path users hit every day.
function rawGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = http.request(
            {
                method: 'GET',
                hostname: u.hostname,
                port: u.port,
                path: u.pathname + u.search,
                headers,
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () =>
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf8'),
                    })
                );
            }
        );
        req.on('error', reject);
        req.end();
    });
}

let app;
let server;
let baseUrl;

beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-not-used-in-prod';
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    process.env.DATABASE_URL = process.env.DATABASE_URL
        || 'postgres://cache-test@127.0.0.1:5432/cache-test';
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

test('index.html ships no manual ?v= cache-busting query strings on /js/ or /css/ assets', () => {
    const html = fs.readFileSync(
        path.join(__dirname, '..', 'public', 'index.html'),
        'utf8'
    );

    // Find every src=/href= that points at /js/ or /css/ and assert it has no
    // query string. Match both single and double quotes; allow attributes
    // before/after on the same tag.
    const re = /(?:src|href)\s*=\s*["'](\/(?:js|css)\/[^"']+)["']/g;
    const refs = [];
    let m;
    while ((m = re.exec(html)) !== null) refs.push(m[1]);

    expect(refs.length).toBeGreaterThan(0); // sanity: we did parse some assets
    const offenders = refs.filter((r) => r.includes('?'));
    expect(offenders).toEqual([]);
});

test('GET /js/app.js returns Cache-Control: no-cache, must-revalidate + ETag', async () => {
    const res = await rawGet(`${baseUrl}/js/app.js`);
    expect(res.status).toBe(200);

    const cc = res.headers['cache-control'] || '';
    expect(cc).toMatch(/no-cache/);
    expect(cc).toMatch(/must-revalidate/);
    // Crucially NOT `no-store` — we WANT the browser to keep a copy and
    // revalidate; no-store would force a full re-download every refresh,
    // which is the bug we just fixed in reverse.
    expect(cc).not.toMatch(/no-store/);

    expect(res.headers['etag']).toBeTruthy();
});

test('GET /css/styles.css returns Cache-Control: no-cache, must-revalidate + ETag', async () => {
    const res = await rawGet(`${baseUrl}/css/styles.css`);
    expect(res.status).toBe(200);

    const cc = res.headers['cache-control'] || '';
    expect(cc).toMatch(/no-cache/);
    expect(cc).toMatch(/must-revalidate/);
    expect(cc).not.toMatch(/no-store/);

    expect(res.headers['etag']).toBeTruthy();
});

test('Conditional GET with matching If-None-Match returns 304 (cheap revalidation)', async () => {
    const first = await rawGet(`${baseUrl}/js/app.js`);
    const etag = first.headers['etag'];
    expect(etag).toBeTruthy();

    const revalidate = await rawGet(`${baseUrl}/js/app.js`, { 'If-None-Match': etag });
    expect(revalidate.status).toBe(304);
    // 304 must NOT include a body — that's the whole point of cheap
    // revalidation (one round-trip, no payload).
    expect(revalidate.body).toBe('');
});

test('index.html and service-worker.js still ship no-store (the shell must always re-fetch)', async () => {
    for (const url of ['/index.html', '/service-worker.js']) {
        const res = await rawGet(`${baseUrl}${url}`);
        expect(res.status).toBe(200);
        const cc = res.headers['cache-control'] || '';
        expect(cc).toMatch(/no-store/);
    }
});

test('SPA deep-link fallback ships the same no-store shell headers', async () => {
    // Hit a path that does NOT exist as a static file — the catch-all
    // SPA fallback in server.js will sendFile('index.html'). Without
    // the explicit Cache-Control header, that path bypasses
    // express.static's setHeaders hook and would pin a stale shell.
    const res = await rawGet(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const cc = res.headers['cache-control'] || '';
    expect(cc).toMatch(/no-store/);
});
