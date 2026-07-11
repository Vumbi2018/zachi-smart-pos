/**
 * Jest is the canonical test runner for the hardened POS backend.
 * The test files keep their concise `node:assert/strict` style; the
 * `node:test` API is shimmed onto Jest globals via tests/_node-test-shim.js.
 */
module.exports = {
    testEnvironment: 'node',
    // Jest only runs the focused smoke suite (*.jest.test.js). The deeper
    // integration coverage in tests/api.test.js / server.test.js /
    // migrate.test.js boots the in-process server and is incompatible with
    // jest's worker model — those run under `node --test` via
    // `npm run test:node`.
    testMatch: ['<rootDir>/tests/**/*.jest.test.js'],
    testPathIgnorePatterns: ['/node_modules/', '/tests/_'],
    testTimeout: 30_000,
    // Single worker keeps the in-process server boot, the rate limiter
    // resets and the DB writes ordered. The npm script also passes
    // --maxWorkers=1 --forceExit defensively.
    maxWorkers: 1,
    verbose: false,
};
