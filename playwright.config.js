/**
 * Playwright config for the Zachi POS e2e smoke suite.
 *
 * Spawns `npm start` on a free port (PORT=5055 by default) and
 * waits for /api/health before the spec runs. Skipped automatically
 * when DATABASE_URL is unset — see tests/e2e/override-badges.spec.js.
 */
const { defineConfig, devices } = require('@playwright/test');

const PORT = process.env.E2E_PORT || '5055';
const BASE_URL = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
    testDir: './tests/e2e',
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['github']] : 'list',
    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
        },
    ],
    // Skip starting the server entirely when DATABASE_URL isn't set —
    // the spec self-skips, and there's nothing useful for the server
    // to do without a database.
    webServer: process.env.DATABASE_URL
        ? {
              command: `PORT=${PORT} JWT_SECRET=${process.env.JWT_SECRET || 'e2e-test-secret'} node server.js`,
              url: `${BASE_URL}/api/health`,
              reuseExistingServer: !process.env.CI,
              timeout: 60_000,
              stdout: 'pipe',
              stderr: 'pipe',
          }
        : undefined,
});
