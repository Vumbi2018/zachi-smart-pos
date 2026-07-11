const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// =====================================================
// Environment validation — fail fast on missing secrets
// =====================================================
const IS_PROD = process.env.NODE_ENV === 'production';

// Replit deployments auto-provide SESSION_SECRET. If the operator hasn't set
// JWT_SECRET explicitly, fall back to it so the server can still boot with a
// strong, persistent secret instead of crashing.
if (IS_PROD && !process.env.JWT_SECRET && process.env.SESSION_SECRET) {
    process.env.JWT_SECRET = process.env.SESSION_SECRET;
    console.warn('ℹ️  JWT_SECRET not set — using SESSION_SECRET as fallback.');
}

// On Replit deployments, default CORS and APP_BASE_URL to the published
// .replit.app domain plus the Hostinger production domain. Operators can still
// override either via deployment secrets if needed.
const IS_REPLIT_DEPLOY = !!(process.env.REPLIT_DEPLOYMENT || process.env.REPL_DEPLOYMENT);
if (IS_PROD && IS_REPLIT_DEPLOY) {
    if (!process.env.CORS_ORIGIN) {
        process.env.CORS_ORIGIN =
            'https://zachi-computer-centre.replit.app,https://pos.zachicomputercentre.com';
    }
    if (!process.env.APP_BASE_URL) {
        process.env.APP_BASE_URL = 'https://zachi-computer-centre.replit.app';
    }
}

const REQUIRED_ENV = ['DATABASE_URL'];
if (IS_PROD) REQUIRED_ENV.push('JWT_SECRET', 'CORS_ORIGIN', 'APP_BASE_URL');
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
    console.error(`\n❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error('   Copy .env.example to .env and fill the values.\n');
    process.exit(1);
}

// Patterns that indicate a placeholder, example, or otherwise weak JWT_SECRET.
// Anything matching ANY of these in production is a fatal misconfiguration.
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
    /^[a-z]+$/i,                // single lowercase word, no entropy
    /^(.)\1{15,}$/,             // 16+ repeats of same char
];

function isWeakJwtSecret(s) {
    if (!s || typeof s !== 'string') return true;
    if (s.length < 32) return true;
    return WEAK_JWT_PATTERNS.some((re) => re.test(s));
}

if (IS_PROD) {
    if (isWeakJwtSecret(process.env.JWT_SECRET)) {
        console.error('\n❌ JWT_SECRET is weak, default, or a placeholder.');
        console.error('   It must be at least 32 chars, high-entropy, and not a known placeholder');
        console.error('   such as CHANGE_ME_LONG_RANDOM_STRING. Generate a strong secret:');
        console.error('   node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n');
        process.exit(1);
    }
} else if (!process.env.JWT_SECRET) {
    // Dev convenience: generate an ephemeral secret so the server can boot
    // locally without a committed value. Sessions will not survive restarts.
    process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
    console.warn(
        '⚠️  JWT_SECRET not set — generated ephemeral dev secret. Sessions will not survive restart.'
    );
}

const app = express();

// Trust reverse proxy (Nginx on Hostinger, Replit edge in cloud)
app.set('trust proxy', 1);

// =====================================================
// Security middleware
// =====================================================
// Notes on CSP:
//   * script-src has NO 'unsafe-inline' — all `<script>` blocks are external files
//     (verified: no inline `<script>...</script>` blocks remain in public/*.html).
//   * script-src-attr is NOT set (so it inherits from script-src and therefore
//     forbids inline event handlers). All ~400 `onclick="…"` style attributes
//     have been migrated to `data-on-<event>` attributes resolved by a single
//     delegated dispatcher in `public/js/utils/delegation.js`.
//   * style-src has NO 'unsafe-inline' (Task #7). All ~390 legacy `style="…"`
//     attributes have been migrated to `data-style="…"` attributes resolved by
//     `public/js/utils/data-style.js`, which copies the value onto
//     `element.style.cssText` via the CSSOM (which is NOT subject to style-src).
//     style-src-attr inherits from style-src and therefore forbids inline
//     style attributes — an attacker who injects HTML can no longer add
//     `style="…"` overlays for clickjacking or phishing.
//   * style-src-elem keeps 'unsafe-inline' so that ApexCharts (loaded from
//     jsdelivr) can inject its runtime <style> element for chart animations
//     and tooltips, and so that print popups (window.open + document.write)
//     can use <link rel="stylesheet" href="/css/print-*.css"> + <style> blocks.
//   * jsdelivr/cdnjs are vendored CDNs that ship ApexCharts and Font Awesome
//     and are explicitly allow-listed.
app.use(
    helmet({
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                'default-src': ["'self'"],
                'script-src': [
                    "'self'",
                    'https://cdn.jsdelivr.net',
                    'https://cdnjs.cloudflare.com',
                ],
                'style-src': [
                    "'self'",
                    'https://fonts.googleapis.com',
                    'https://cdn.jsdelivr.net',
                    'https://cdnjs.cloudflare.com',
                ],
                'style-src-elem': [
                    "'self'",
                    "'unsafe-inline'",
                    'https://fonts.googleapis.com',
                    'https://cdn.jsdelivr.net',
                    'https://cdnjs.cloudflare.com',
                ],
                'font-src': [
                    "'self'",
                    'https://fonts.gstatic.com',
                    'https://cdnjs.cloudflare.com',
                    'data:',
                ],
                'img-src': ["'self'", 'data:', 'blob:', 'https:'],
                'connect-src': ["'self'", 'https:'],
                // v1.0.42 — allow the Replit workspace preview pane to
                // embed the app in its dev iframe. Without this, the
                // workspace shows a blank preview because the browser
                // refuses to render the page inside a cross-origin
                // frame. Production deploys still self-host and the
                // explicit allow-list keeps third-party embedding blocked.
                'frame-ancestors': [
                    "'self'",
                    'https://*.replit.dev',
                    'https://*.replit.com',
                    'https://replit.com',
                ],
                'base-uri': ["'self'"],
                'object-src': ["'none'"],
            },
        },
        crossOriginEmbedderPolicy: false,
    })
);

// =====================================================
// CORS — strict allow-list, no localhost in production
// =====================================================
const envAllowed = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const devOrigins = IS_PROD
    ? []
    : ['http://localhost:5000', 'http://localhost:3000', 'http://127.0.0.1:5000'];

const allowedOrigins = [...new Set([...devOrigins, ...envAllowed])];

// Replit dev/preview hostnames change every restart for unauthenticated
// devs and per-Repl for authenticated devs, so we allow-list the patterns
// rather than the exact origins. Production deploys must still use
// CORS_ORIGIN env var to whitelist the real customer domain.
const REPLIT_DEV_ORIGIN = /^https?:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:replit\.dev|replit\.app|repl\.co)(?::\d+)?$/i;

app.use(
    cors({
        origin: (origin, callback) => {
            // Same-origin / curl / Postman / native shells (Capacitor, Tauri) send no Origin
            if (!origin) return callback(null, true);
            if (allowedOrigins.includes(origin)) return callback(null, true);
            // Allow capacitor:// and tauri:// custom schemes
            if (/^(capacitor|ionic|tauri|zachi|file):\/\//.test(origin)) return callback(null, true);
            // Allow native shell loopback origins:
            //   - Capacitor v3+ on Android uses https://localhost (because
            //     androidScheme: "https"), and on iOS uses capacitor://localhost.
            //   - Tauri v2 on Windows uses https://tauri.localhost (and
            //     http://tauri.localhost in some dev configs).
            //   - Tauri WebView2 / electron variants may use https://localhost.
            if (/^https?:\/\/(localhost|tauri\.localhost|capacitor\.localhost|ionic\.localhost|zachi\.localhost)(:\d+)?$/i.test(origin)) {
                return callback(null, true);
            }
            // Allow Replit dev/preview hosts in non-prod so the in-workspace
            // browser preview works without manually editing CORS_ORIGIN.
            if (!IS_PROD && REPLIT_DEV_ORIGIN.test(origin)) return callback(null, true);
            return callback(new Error(`CORS blocked: ${origin}`));
        },
        credentials: true,
    })
);

app.use(morgan(IS_PROD ? 'combined' : 'dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// =====================================================
// Rate limiting — protects auth and the API surface
// =====================================================
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/api/health',
});
app.use('/api/', apiLimiter);

// Login throttling — three layers, all required by the hardening spec:
//   1. per-IP limit on /api/auth/login          (5 failed attempts / 15min)
//   2. per-username limit on /api/auth/login    (5 failed attempts / 15min)
//   3. soft DB lockout in users.failed_attempts (handled in authController)
// Successful logins are skipped so a busy cashier on shared NAT isn't
// shut out by their own legitimate sign-ins.
const LOGIN_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT_MAX = 5;
const loginIpLimiter = rateLimit({
    windowMs: LOGIN_LIMIT_WINDOW_MS,
    max: LOGIN_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Too many login attempts from this network. Try again in 15 minutes.' },
});
const loginUsernameLimiter = rateLimit({
    windowMs: LOGIN_LIMIT_WINDOW_MS,
    max: LOGIN_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
        const u = (req.body && req.body.username) ? String(req.body.username).trim().toLowerCase() : '';
        return u ? `user:${u}` : `noUser:${req.ip}`;
    },
    message: { error: 'Too many login attempts for this account. Try again in 15 minutes.' },
});

// Forgot/reset use a softer 20/15min — they're idempotent and we want
// users locked out of password recovery to be rare.
const passwordRecoveryLimiter = rateLimit({
    windowMs: LOGIN_LIMIT_WINDOW_MS,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again in 15 minutes.' },
});

app.use('/api/auth/login', loginIpLimiter, loginUsernameLimiter);
app.use('/api/auth/forgot-password', passwordRecoveryLimiter);
app.use('/api/auth/reset-password', passwordRecoveryLimiter);

// ── OTA manifest: serve on both GET and POST ──────────────────────────
// The @capgo/capacitor-updater plugin POSTs device info to its
// configured updateUrl on every cold start. express.static only handles
// GET/HEAD, so a POST to /ota/android-latest.json was returning 404 —
// which the plugin treats as "no update available" and silently bails.
// That's why Android devices were stuck on whatever bundle the APK
// shipped with. Handle POST here (Express never reaches express.static
// because we respond first) and forward GET to the static layer.
app.post(['/ota/android-latest.json', '/ota/windows-latest.json'], (req, res) => {
    try {
        const file = path.join(__dirname, 'public', req.path);
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.type('application/json').sendFile(file);
    } catch (err) {
        console.warn('OTA manifest POST failed:', err.message);
        res.status(500).json({ error: 'manifest unavailable' });
    }
});

// Serve static frontend files.
//
// Cache strategy (Task #18 — replaces the manual `?v=2.9` query strings that
// used to litter index.html and were forgotten on every deploy):
//
//   * index.html and service-worker.js: hard no-store. The shell is the entry
//     point — it must always be re-fetched so users pick up new script tags
//     and a refreshed SW.
//
//   * /js/* and /css/*: `no-cache, must-revalidate`. Crucially this is NOT
//     `no-store` — the browser keeps the file but is required to revalidate
//     with the server on every load. express.static already emits a strong
//     `ETag` based on inode+mtime+size, so an unchanged file costs a single
//     conditional GET (304, no body); a changed file always reaches the user
//     on the next refresh with no manual cache-busting needed.
//
//   * Everything else (images, fonts, manifest): default behaviour — modest
//     cache with ETag revalidation, which is fine for binary assets.
app.use(
    express.static(path.join(__dirname, 'public'), {
        etag: true,
        lastModified: true,
        setHeaders: (res, p) => {
            if (p.endsWith('index.html') || p.endsWith('service-worker.js')) {
                res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
                return;
            }
            const ext = path.extname(p).toLowerCase();
            if (ext === '.js' || ext === '.css') {
                res.set('Cache-Control', 'no-cache, must-revalidate');
            }
        },
    })
);

// =====================================================
// API Routes
// =====================================================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/services', require('./routes/services'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/users', require('./routes/users'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/messaging', require('./routes/messaging'));
app.get('/api/currency', require('./controllers/currencyController').getRates);
// Director-only endpoints to manage manual override rates.
app.get(
    '/api/currency/overrides',
    require('./middleware/auth'),
    require('./middleware/rbac')('director'),
    require('./controllers/currencyController').getOverrides
);
app.put(
    '/api/currency/overrides',
    require('./middleware/auth'),
    require('./middleware/rbac')('director'),
    require('./controllers/currencyController').saveOverrides
);

// Enterprise modules
app.use('/api/jobs', require('./routes/jobCards'));
app.use('/api/cash', require('./routes/cash'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/returns', require('./routes/returns'));
app.use('/api/quotes', require('./routes/quotes'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/loyalty', require('./routes/loyalty'));
app.use('/api/pricing', require('./routes/pricing'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/approvals', require('./routes/approvals'));

// Sync engine — device registry + push/pull batch endpoints used by
// the offline-first PWA / Tauri / Capacitor wrappers.
app.use('/api/devices', require('./routes/devices'));
app.use('/api/sync', require('./routes/sync'));

// Customer-facing display (SSE) — second-screen support
app.use('/api/display', require('./routes/display'));

// =====================================================
// Health Check — actually pings the database so uptime
// monitors (UptimeRobot, etc.) catch DB outages, not just
// "the node process is alive".
// =====================================================
const healthPool = require('./db/pool');
const APP_VERSION = require('./package.json').version;
app.get('/api/health', async (req, res) => {
    const started = Date.now();
    try {
        await healthPool.query('SELECT 1');
        res.json({
            status: 'ok',
            name: 'Zachi Smart-POS',
            version: APP_VERSION,
            db: 'ok',
            db_latency_ms: Date.now() - started,
            uptime_s: Math.round(process.uptime()),
        });
    } catch (err) {
        console.error('Health check failed:', err.message);
        res.status(503).json({
            status: 'degraded',
            name: 'Zachi Smart-POS',
            version: APP_VERSION,
            db: 'error',
            error: err.message,
        });
    }
});

// =====================================================
// SPA Fallback — serve index.html for non-API GETs
// =====================================================
app.use((req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: `API Endpoint not found: ${req.method} ${req.path}` });
    }
    if (req.method === 'GET') {
        // SPA fallback bypasses express.static, so apply the same strict
        // shell cache headers here too — otherwise deep links would get
        // default caching and could pin a stale shell (Task #18).
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        return res.sendFile('index.html', { root: path.join(__dirname, 'public') }, (err) => {
            if (err) {
                console.error('Error sending file:', err.message);
                if (!res.headersSent) res.status(500).send('Internal server error.');
            }
        });
    }
    res.status(404).send('Not Found');
});

// =====================================================
// Error Handler — never leak stack traces
// =====================================================
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (res.headersSent) return;
    res.status(err.status || 500).json({
        error: IS_PROD ? 'Internal server error.' : err.message,
    });
});

// =====================================================
// Start Server
// =====================================================
const PORT = parseInt(process.env.PORT, 10) || 5000;
const HOST = process.env.HOST || '0.0.0.0';

if (require.main === module) {
    (async () => {
        // ── v1.0.34 — auto-run migrations on boot ────────────────────
        // Previously migrations only ran via the legacy `deploy.sh` SSH
        // path on the old VPS. Replit production runs `node server.js`
        // directly, so new migrations (e.g. 027_granular_permissions)
        // never applied even after redeploying — the user reported
        // "user permissions have not been effected" for exactly this
        // reason. migrate() is idempotent (checksum-tracked in the
        // `migrations` table), so running it on every boot is safe.
        try {
            const { migrate } = require('./db/migrate');
            await migrate();
        } catch (err) {
            console.error('\n❌ Migration failed on boot:', err.message);
            console.error('   Refusing to start HTTP server with an out-of-date schema.\n');
            process.exit(1);
        }

        // ── Stamp version.json with the actual boot time ─────────────
        // The user asked for a real timestamp on `released_at` so they
        // can tell at a glance whether today's deploy actually landed
        // on the till. We rewrite the static file on every boot using
        // the version from package.json (single source of truth).
        const releasedVersion = require('./package.json').version || '0.0.0';
        try {
            const fs = require('fs');
            const versionPath = path.join(__dirname, 'public', 'version.json');
            const payload = {
                version: releasedVersion,
                released_at: new Date().toISOString(),
                node_env: process.env.NODE_ENV || 'development',
            };
            fs.writeFileSync(versionPath, JSON.stringify(payload, null, 2) + '\n');
        } catch (err) {
            console.warn('  ⚠️  Could not stamp version.json:', err.message);
        }

        // ── v1.0.36 — OTA web-bundle for Windows + Android ──────────
        // Every boot regenerates the OTA zip + manifests so a simple
        // Replit redeploy is enough to push updates to the Tauri
        // (Windows) and Capacitor (Android) shells. The zip is keyed
        // by version + content fingerprint so unchanged content
        // doesn't trigger a rebuild. Tills check /ota/*-latest.json on
        // launch and pull the new bundle automatically.
        try {
            const { buildBundle } = require('./scripts/build-ota-bundle');
            buildBundle({ version: releasedVersion });
        } catch (err) {
            console.warn('  ⚠️  OTA bundle build failed:', err.message);
        }

        app.listen(PORT, HOST, () => {
            console.log(`\n  🏪 Zachi Smart-POS v${releasedVersion}`);
            console.log(`  Listening on http://${HOST}:${PORT}`);
            console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`  Booted at:   ${new Date().toISOString()}\n`);

            // Kick off the background scheduler (low-stock alerts + nightly backups).
            // Wrapped so a require failure can never prevent the HTTP server from
            // accepting requests.
            try {
                require('./jobs/scheduler').start();
            } catch (err) {
                console.error('Scheduler failed to start:', err.message);
            }
        });
    })().catch((err) => {
        console.error('Fatal boot error:', err);
        process.exit(1);
    });
}

// Expose the login limiters so the test suite can reset their in-memory
// counters between tests. Production code never reads these.
app.locals.loginIpLimiter = loginIpLimiter;
app.locals.loginUsernameLimiter = loginUsernameLimiter;

module.exports = app;
