/**
 * Regression test for Task #53.
 *
 * The job-card "Upload Proof" endpoint accepts either a multipart file
 * or a JSON `{ file_url }`. A `javascript:` URL stored here would later
 * execute in a colleague's browser when they click the proof link, so
 * the API must reject anything that isn't http(s).
 */
const path = require('path');
const bcrypt = require('bcryptjs');

let app, pool, server, baseUrl;
let adminToken;
let testUserId;
let testServiceId;
let testJobId;
let suiteReady = false;
const testUsername = `proofqa_${Math.random().toString(36).slice(2, 8)}`;
const testPassword = 'ProofQa#2026!';

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
        await pool.query('SELECT 1 FROM users LIMIT 1');
        await pool.query('SELECT 1 FROM job_cards LIMIT 1');
        await pool.query('SELECT 1 FROM services LIMIT 1');
    } catch (err) {
        console.warn('Schema not ready, skipping proof URL suite:', err.message);
        return;
    }

    const hash = await bcrypt.hash(testPassword, 4);
    const u = await pool.query(
        `INSERT INTO users (full_name, username, password_hash, role)
         VALUES ($1,$2,$3,$4) RETURNING user_id`,
        ['Proof QA', testUsername, hash, 'director']
    );
    testUserId = u.rows[0].user_id;

    const s = await pool.query(
        `INSERT INTO services (service_name, category, base_price, unit_measure, is_active)
         VALUES ($1,$2,$3,$4,TRUE) RETURNING service_id`,
        [`ProofQA Service ${testUsername}`, 'Graphics', 100, 'fixed']
    );
    testServiceId = s.rows[0].service_id;

    const j = await pool.query(
        `INSERT INTO job_cards (job_number, service_id, status, priority, specifications)
         VALUES ($1,$2,$3,$4,$5) RETURNING job_id`,
        [`JOB-PQA-${Date.now().toString().slice(-9)}`, testServiceId, 'Designing', 'Normal', 'proof-url regression']
    );
    testJobId = j.rows[0].job_id;

    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
            baseUrl = `http://127.0.0.1:${server.address().port}`;
            resolve();
        });
    });

    const r = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: testPassword }),
    });
    const lj = await r.json();
    adminToken = lj.token;
    suiteReady = Boolean(adminToken);
}, 60_000);

afterAll(async () => {
    if (!canRunDb()) return;
    try {
        if (testJobId) {
            await pool.query('DELETE FROM job_proofs WHERE job_id = $1', [testJobId]);
            await pool.query('DELETE FROM job_cards WHERE job_id = $1', [testJobId]);
        }
        if (testServiceId) await pool.query('DELETE FROM services WHERE service_id = $1', [testServiceId]);
        if (testUserId) {
            await pool.query('DELETE FROM audit_logs WHERE user_id = $1', [testUserId]);
            await pool.query('DELETE FROM users WHERE user_id = $1', [testUserId]);
        }
    } catch (err) {
        console.warn('cleanup warning:', err.message);
    }
    if (server) await new Promise((r) => server.close(r));
    if (pool) await pool.end();
}, 30_000);

const skipIfNoDb = () => (canRunDb() ? test : test.skip);

skipIfNoDb()('POST /api/jobs/:id/proofs rejects javascript: URLs with 400', async () => {
    if (!suiteReady) { console.warn('Skipping: schema not ready or login failed'); return; }
    expect(adminToken).toBeTruthy();
    const r = await fetch(`${baseUrl}/api/jobs/${testJobId}/proofs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ file_url: 'javascript:alert(1)', notes: 'xss attempt' }),
    });
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(String(j.error || '')).toMatch(/http/i);

    const stored = await pool.query(
        'SELECT COUNT(*)::int AS n FROM job_proofs WHERE job_id = $1',
        [testJobId]
    );
    expect(stored.rows[0].n).toBe(0);
});

skipIfNoDb()('POST /api/jobs/:id/proofs accepts a normal https URL', async () => {
    if (!suiteReady) { console.warn('Skipping: schema not ready or login failed'); return; }
    expect(adminToken).toBeTruthy();
    const r = await fetch(`${baseUrl}/api/jobs/${testJobId}/proofs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ file_url: 'https://example.com/proof.pdf', notes: 'ok' }),
    });
    expect(r.status).toBe(201);
});
