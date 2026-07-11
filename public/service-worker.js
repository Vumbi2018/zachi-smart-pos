/**
 * Zachi Smart-POS — Service Worker (v6)
 *
 * Brings offline back without the v4 reload-loop. Key differences:
 *   - No clients.claim() and no client.navigate() in activate. The new
 *     SW only controls future page loads. Existing tabs keep working
 *     uninterrupted until they're naturally reloaded.
 *   - Same-origin only, GET only.
 *   - App shell (HTML/JS/CSS) → network-first with cache fallback so a
 *     code push still reaches the user on next load.
 *   - API GETs (/api/...) → pass-through. api.js already maintains its
 *     own IndexedDB cache for offline replay, so the SW must not double
 *     up (we'd serve stale JSON behind the API layer's back).
 *   - Static assets (images, fonts) → cache-first.
 *   - Navigation requests that fail → fall back to cached /index.html
 *     so deep-link refreshes work offline.
 */

const CACHE_NAME = 'zachipos-shell-v6';

const PRECACHE_URLS = [
    '/',
    '/index.html',
    '/css/styles.css',
    '/css/print-receipt.css',
    '/css/print-quote.css',
    '/css/print-eod.css',
    '/css/print-report.css',
    '/css/print-report-adv.css',
    '/js/ota-ready.js',
    '/js/ota-bridge.js',
    '/js/native/capacitor-bridge.js',
    '/js/tauri-bridge.js',
    '/js/db.js',
    '/js/api.js',
    '/js/sync.js',
    '/js/sync-ui.js',
    '/js/utils.js',
    '/js/utils/delegation.js',
    '/js/utils/scanner.js',
    '/js/lib/html5-qrcode.min.js',
    '/js/app.js',
    '/js/pos.js',
    '/js/inventory.js',
    '/js/customers.js',
    '/js/services.js',
    '/js/reports.js',
    '/js/users.js',
    '/js/audit.js',
    '/js/approvals.js',
    '/js/permissions.js',
    '/js/dashboard.js',
    '/js/jobs.js',
    '/js/cash.js',
    '/js/suppliers.js',
    '/js/purchases.js',
    '/js/returns.js',
    '/js/quotes.js',
    '/js/invoices.js',
    '/js/loyalty.js',
    '/js/settings.js',
    '/js/profile.js',
    '/js/payments.js',
    '/js/daily_sales.js',
    '/js/reports_adv.js',
    '/js/inventory_alerts.js',
    '/js/backlog_sales.js',
    '/js/credit_orders.js',
    '/js/promotions.js',
    '/js/stock_receiving.js',
    '/js/auth-modal.js',
    '/favicon.ico',
    '/logo.png',
    '/manifest.json',
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await Promise.allSettled(
            PRECACHE_URLS.map((url) =>
                cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
            )
        );
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        );
        // Intentionally NOT calling clients.claim() — that's what
        // caused the v4 multi-iframe navigate loop. New SW will take
        // control of pages on their next natural load.
    })());
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    let url;
    try { url = new URL(request.url); } catch (_) { return; }
    if (url.origin !== self.location.origin) return;

    // API requests pass through — api.js owns the offline cache for these.
    if (url.pathname.startsWith('/api/')) return;

    // OTA endpoints must always hit the network when reachable.
    if (url.pathname.startsWith('/ota/')) return;

    // Server-sent events and uploads must pass through.
    if (url.pathname.startsWith('/sse') || url.pathname.startsWith('/uploads/')) return;

    if (
        url.pathname === '/' ||
        url.pathname.endsWith('.html') ||
        url.pathname.startsWith('/js/') ||
        url.pathname.startsWith('/css/')
    ) {
        event.respondWith(networkFirst(request));
        return;
    }

    event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response && response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    } catch (_) {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
            const shell = await caches.match('/index.html');
            if (shell) return shell;
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
}

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) {
        fetch(request).then((resp) => {
            if (resp && resp.ok) {
                caches.open(CACHE_NAME).then((c) => c.put(request, resp).catch(() => {}));
            }
        }).catch(() => {});
        return cached;
    }
    try {
        const response = await fetch(request);
        if (response && response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    } catch (_) {
        return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
}
