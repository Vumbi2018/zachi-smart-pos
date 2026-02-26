/**
 * Zachi Smart-POS — Service Worker v2.0
 *
 * Strategy:
 *   - Static assets (JS/CSS/HTML): Cache-first (serve instantly, update in background)
 *   - API GET endpoints: Network-first (live data, fallback to cache when offline)
 *   - API POST/PUT/DELETE: Never intercepted — handled by api.js offline queue
 */

const CACHE_VERSION = 'zachi-pos-v2.0';
const API_CACHE = 'zachi-api-v2.0';

const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/logo.jpg',
    '/css/styles.css',
    '/js/app.js',
    '/js/api.js',
    '/js/db.js',
    '/js/utils.js',
    '/js/utils/scanner.js',
    '/js/lib/html5-qrcode.min.js',
    '/js/pos.js',
    '/js/dashboard.js',
    '/js/inventory.js',
    '/js/customers.js',
    '/js/reports.js',
    '/js/reports_adv.js',
    '/js/users.js',
    '/js/audit.js',
    '/js/approvals.js',
    '/js/permissions.js',
    '/js/jobs.js',
    '/js/cash.js',
    '/js/suppliers.js',
    '/js/purchases.js',
    '/js/returns.js',
    '/js/quotes.js',
    '/js/loyalty.js',
    '/js/settings.js',
    '/js/payments.js',
    '/js/promotions.js',
    '/js/daily_sales.js'
];

// API endpoints to cache for offline browsing
const CACHEABLE_API = [
    '/api/products',
    '/api/services',
    '/api/customers',
    '/api/payments',
    '/api/settings',
    '/api/inventory'
];

// ── Install: Pre-cache all static assets ──────────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then(cache => {
                console.log('[SW] Pre-caching static assets...');
                // addAll fails if any asset 404s — use individual adds to be resilient
                return Promise.allSettled(
                    STATIC_ASSETS.map(url => cache.add(url).catch(e => console.warn(`[SW] Failed to cache: ${url}`, e)))
                );
            })
            .then(() => self.skipWaiting())
    );
});

// ── Activate: Clean up old caches ─────────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== CACHE_VERSION && key !== API_CACHE)
                    .map(key => {
                        console.log('[SW] Deleting old cache:', key);
                        return caches.delete(key);
                    })
            )
        ).then(() => self.clients.claim())
    );
});

// ── Fetch: Route requests to appropriate strategy ─────────────────────────────
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // Only handle same-origin requests
    if (url.origin !== location.origin) return;

    // BUG 3 FIX: Navigation requests (page loads / hard refresh) must NEVER be served from
    // cache. Serving a cached index.html would bypass the JWT check in init() because the
    // browser would load stale HTML even after logout. Always go to network for navigate.
    if (request.mode === 'navigate') {
        event.respondWith(fetch(request));
        return;
    }

    // API GET: Network-first with cache fallback (only for critical resources)
    const isCacheableAPI = CACHEABLE_API.some(ep => url.pathname.startsWith(ep));
    if (url.pathname.startsWith('/api/') && request.method === 'GET' && isCacheableAPI) {
        event.respondWith(networkFirstWithCache(request));
        return;
    }

    // Skip all other API requests — let api.js handle them
    if (url.pathname.startsWith('/api/')) return;

    // Static assets (JS, CSS, images): Cache-first
    event.respondWith(cacheFirstWithNetwork(request));
});

/**
 * Cache-first strategy: serve from cache, update in background
 * NOTE: This is NOT used for navigation requests (see fetch handler above).
 */
async function cacheFirstWithNetwork(request) {
    const cached = await caches.match(request);
    if (cached) {
        // Update in background (stale-while-revalidate)
        fetch(request).then(response => {
            if (response && response.ok) {
                caches.open(CACHE_VERSION).then(cache => cache.put(request, response.clone()));
            }
        }).catch(() => { });
        return cached;
    }

    try {
        const response = await fetch(request);
        if (response && response.ok) {
            const cache = await caches.open(CACHE_VERSION);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        // NOTE: Do NOT fall back to cached index.html for navigation — that would bypass auth.
        // Only throw for non-navigate asset failures.
        throw new Error('Offline and no cache available');
    }
}

/**
 * Network-first strategy: try network, fall back to cache (for API GETs)
 */
async function networkFirstWithCache(request) {
    try {
        const response = await fetch(request);
        if (response && response.ok) {
            const cache = await caches.open(API_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await caches.match(request, { cacheName: API_CACHE });
        if (cached) {
            console.log('[SW] Serving offline API cache:', request.url);
            return cached;
        }
        // Return empty JSON so app doesn't crash
        return new Response(JSON.stringify({ error: 'offline', data: [] }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
