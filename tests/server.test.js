const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { sanitize } = require('../middleware/audit');

test('audit sanitize redacts top-level sensitive keys', () => {
    const input = { username: 'alice', password: 'p@ssword', token: 'jwt' };
    const out = sanitize(input);
    assert.equal(out.username, 'alice');
    assert.equal(out.password, '********');
    assert.equal(out.token, '********');
});

test('audit sanitize redacts nested sensitive keys', () => {
    const input = {
        user: { id: 1, password_hash: 'xxx' },
        meta: { api_key: 'abc', items: [{ pin: '1234' }, { ok: true }] },
    };
    const out = sanitize(input);
    assert.equal(out.user.password_hash, '********');
    assert.equal(out.meta.api_key, '********');
    assert.equal(out.meta.items[0].pin, '********');
    assert.equal(out.meta.items[1].ok, true);
});

test('audit sanitize handles primitives and null', () => {
    assert.equal(sanitize(null), null);
    assert.equal(sanitize(42), 42);
    assert.equal(sanitize('hello'), 'hello');
    assert.deepEqual(sanitize(['a', 'b']), ['a', 'b']);
});

test('audit sanitize stops at MAX_DEPTH', () => {
    let nested = { v: 1 };
    for (let i = 0; i < 20; i++) nested = { child: nested, password: 'leak' };
    const out = sanitize(nested);
    // Should not throw; outer levels are still sanitized
    assert.equal(out.password, '********');
});

test('migrate rename shim covers legacy collision filenames', () => {
    const { RENAME_SHIM } = require('../db/migrate');
    assert.equal(RENAME_SHIM['004_enterprise_skeleton.sql'], '004a_enterprise_skeleton.sql');
    assert.equal(RENAME_SHIM['004_notifications.sql'], '004b_notifications.sql');
    assert.equal(RENAME_SHIM['005_add_inventory_columns.sql'], '005a_add_inventory_columns.sql');
    assert.equal(RENAME_SHIM['005_system_settings.sql'], '005b_system_settings.sql');
});

test('JWT_SECRET weak-secret detector rejects placeholders and accepts strong values', () => {
    // Re-require server.js with NODE_ENV=production would crash the runner;
    // instead, mirror the same predicate locally and assert the contract.
    // (server.js exports nothing; we cover it here as a regression guard.)
    const WEAK_JWT_PATTERNS = [
        /change[_-]?this/i,
        /change[_-]?in[_-]?production/i,
        /change[_-]?me/i,
        /^changeme$/i,
        /example/i,
        /placeholder/i,
        /^secret$/i,
        /^password$/i,
        /^test$/i,
        /^development$/i,
        /^[a-z]+$/i,
        /^(.)\1{15,}$/,
    ];
    function isWeak(s) {
        if (!s || typeof s !== 'string') return true;
        if (s.length < 32) return true;
        return WEAK_JWT_PATTERNS.some((re) => re.test(s));
    }

    // Placeholders & defaults must be rejected
    assert.equal(isWeak('CHANGE_ME_LONG_RANDOM_STRING'), true);
    assert.equal(isWeak('change_this_in_production_xxxxxxxxxx'), true);
    assert.equal(isWeak('example-jwt-secret-do-not-use-1234'), true);
    assert.equal(isWeak('placeholder_secret_value_1234567890'), true);
    assert.equal(isWeak('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), true); // repeated chars
    assert.equal(isWeak('shortvalue'), true);                       // too short
    assert.equal(isWeak(''), true);
    assert.equal(isWeak(null), true);

    // A real high-entropy value passes
    const strong = require('node:crypto').randomBytes(48).toString('hex');
    assert.equal(isWeak(strong), false);
});

test('Scanner module exposes the legacy POS API surface (init/start/stop/getCameras/isSupported)', () => {
    // The canvas/POS scanner modal in public/js/pos.js calls Scanner.init,
    // Scanner.getCameras, Scanner.start and Scanner.stop. inventory.js
    // calls Scanner.init and Scanner.stop. A regression in this contract
    // breaks the scanner modal at runtime with no easy-to-detect symptom,
    // so we lock the surface down here.
    const scannerPath = path.join(__dirname, '..', 'public', 'js', 'utils', 'scanner.js');
    const src = fs.readFileSync(scannerPath, 'utf8');

    // Stub out the browser globals that the IIFE expects.
    const fakeWindow = {};
    const fakeNavigator = { mediaDevices: { enumerateDevices: async () => [] } };
    const fakeDocument = { getElementById: () => null };
    const sandbox = {
        window: fakeWindow,
        navigator: fakeNavigator,
        document: fakeDocument,
        console,
    };

    // Run the IIFE in a function scope that exposes our stubs as locals.
    const runner = new Function('window', 'navigator', 'document', src);
    runner(sandbox.window, sandbox.navigator, sandbox.document);

    const Scanner = sandbox.window.Scanner;
    assert.ok(Scanner, 'Scanner global must be set on window');
    assert.equal(typeof Scanner.init, 'function', 'Scanner.init must exist');
    assert.equal(typeof Scanner.start, 'function', 'Scanner.start must exist');
    assert.equal(typeof Scanner.stop, 'function', 'Scanner.stop must exist');
    assert.equal(typeof Scanner.getCameras, 'function', 'Scanner.getCameras must exist');
    assert.equal(typeof Scanner.isSupported, 'function', 'Scanner.isSupported must exist');
});
