/**
 * Zachi Smart-POS - API Client
 * Handles all HTTP requests with JWT authentication
 *
 * Routing strategy:
 *  - Android / Mobile  → Master server (always online)
 *  - Web browser       → Relative /api (server-side)
 *  - Windows (Tauri)   → Master server PRIMARY, local sidecar FALLBACK
 */

const MASTER_API_URL = 'https://pos.zachicomputercentre.com/api';
const LOCAL_SIDECAR_URL = 'http://127.0.0.1:5000/api';

const API = {
    baseUrl: (function () {
        if (navigator.userAgent.includes('Android') || navigator.userAgent.includes('Mobile')) {
            console.log('[API] Mode: Android → Master');
            return MASTER_API_URL;
        }
        if (window.__TAURI__ || window.__TAURI_INTERNALS__ || window.location.origin.includes('tauri.localhost') || window.location.protocol === 'tauri:') {
            // Windows desktop: prefer master, fall back to local sidecar (handled in request())
            console.log('[API] Mode: Windows Tauri → Master (with local fallback)');
            return MASTER_API_URL;
        }
        console.log('[API] Mode: Web browser → Relative');
        return '/api';
    })(),
    // Flag so request() knows to attempt local fallback on network failure
    isTauri: !!(window.__TAURI__ || window.__TAURI_INTERNALS__ || window.location.origin.includes('tauri.localhost') || window.location.protocol === 'tauri:'),
    token: sessionStorage.getItem('zspos_token'),

    setToken(token) {
        this.token = token;
        sessionStorage.setItem('zspos_token', token);
    },

    clearToken() {
        this.token = null;
        sessionStorage.removeItem('zspos_token');
        sessionStorage.removeItem('zspos_user');
    },

    async checkConnectivity() {
        if (!navigator.onLine) return false;
        try {
            // Lightweight heartbeat to the current baseUrl (Master or Sidecar)
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000);
            const res = await fetch(`${this.baseUrl}/health`, { method: 'HEAD', signal: controller.signal });
            clearTimeout(timeout);
            return res.ok;
        } catch (e) {
            return false;
        }
    },

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = { 'Content-Type': 'application/json' };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        // Offline Handling
        const isActuallyOnline = await this.checkConnectivity();
        if (!isActuallyOnline) {
            // 1. Try to serve from DB cache for GET requests
            if (!options.method || options.method === 'GET') {
                try {
                    const cached = await DB.getCachedData(endpoint);
                    if (cached) {
                        console.log(`[Offline] Serving cached: ${endpoint}`);
                        return cached;
                    }
                } catch (e) {
                    console.warn('DB Cache Error:', e);
                }
                throw new Error('You are offline and no cached data is available.');
            }

            // 2. Queue SALE (POST /sales) — return fake receipt so POS stays happy
            if (options.method === 'POST' && endpoint === '/sales') {
                const body = JSON.parse(options.body);
                const offlineSale = { ...body, isOffline: true, tempId: Date.now() };
                try {
                    await DB.queueSale(offlineSale);
                    Utils.toast('Offline: Sale queued — will sync when online.', 'info');
                    return {
                        sale_id: offlineSale.tempId,
                        sale_number: `OFF-${offlineSale.tempId}`,
                        total_amount: body.amount_paid || 0,
                        items: body.items,
                        is_offline: true,
                        payment_method: body.payment_method
                    };
                } catch (e) {
                    console.error('Offline Sale Queue Error:', e);
                    throw new Error('Failed to save offline sale.');
                }
            }

            // 3. Queue any other mutation (PUT/PATCH/POST edits, etc.)
            const mutMethod = options.method || 'POST';
            if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(mutMethod)) {
                try {
                    const body = options.body ? JSON.parse(options.body) : null;
                    await DB.queueMutation(mutMethod, endpoint, body);
                    Utils.toast('Offline: Change queued — will sync when you reconnect.', 'info');
                    // Return a fake success so the caller doesn't throw
                    return { queued: true, offline: true };
                } catch (e) {
                    console.error('Offline Mutation Queue Error:', e);
                    throw new Error('Failed to queue offline change.');
                }
            }

            throw new Error('You are offline. This action requires an internet connection.');
        }

        try {
            const response = await fetch(url, { ...options, headers });

            if (response.status === 401 && !url.includes('/auth/login')) {
                this.clearToken();
                // BUG 4 FIX: also hide the app shell immediately on 401
                if (typeof App !== 'undefined' && App.showLogin) {
                    App.showLogin();
                } else {
                    window.location.hash = '#/login';
                }
                throw new Error('Unauthorized');
            }

            let data;
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                data = await response.json();
            } else {
                const text = await response.text();
                data = { error: text || 'Internal Server Error' };
                console.warn('[API] Non-JSON response received:', text);
            }

            if (!response.ok) {
                throw new Error(data.error || 'Request failed');
            }

            // Online: Cache successful GET responses for critical data
            if ((!options.method || options.method === 'GET') &&
                (endpoint.includes('/products') ||
                    endpoint.includes('/services') ||
                    endpoint.includes('/settings') ||
                    endpoint.includes('/payments') ||
                    endpoint.includes('/customers') ||
                    endpoint.includes('/dashboard') ||
                    endpoint.includes('/reports') ||
                    endpoint.includes('/users') ||
                    endpoint.includes('/suppliers') ||
                    endpoint.includes('/inventory'))) {
                DB.cacheData(endpoint, data).catch(e => console.warn('Cache write failed', e));
            }

            return data;
        } catch (err) {
            console.error(`API Error [${endpoint}]:`, err);

            const isNetworkError = err instanceof TypeError || err.message.includes('Failed to fetch') || err.message.includes('NetworkError');
            const errorMsg = isNetworkError ? `Failed to fetch [${url}]` : err.message;

            // === Windows Tauri Fallback: Retry on local sidecar if master is unreachable ===
            // Android has no local sidecar — it falls straight through to IndexedDB.
            if (isNetworkError && this.isTauri) {
                const localUrl = `${LOCAL_SIDECAR_URL}${endpoint}`;
                console.warn(`[API] Master unreachable, trying local sidecar: ${localUrl}`);
                try {
                    const localResponse = await fetch(localUrl, { ...options, headers });
                    const contentType = localResponse.headers.get('content-type');
                    let localData;
                    if (contentType && contentType.includes('application/json')) {
                        localData = await localResponse.json();
                    } else {
                        const text = await localResponse.text();
                        localData = { error: text || 'Local sidecar error' };
                    }
                    if (!localResponse.ok) throw new Error(localData.error || 'Local sidecar request failed');
                    console.log(`[API] Local sidecar responded OK for: ${endpoint}`);
                    return localData;
                } catch (localErr) {
                    console.warn(`[API] Local sidecar also failed: ${localErr.message}. Falling back to IndexedDB cache.`);
                }
            }
            // ==================================================================================

            // If fetch fails (network error), try DB cache as fallback
            if ((!options.method || options.method === 'GET') && isNetworkError) {
                let cached = await DB.getCachedData(endpoint);

                // Offline Search Interceptors (Simulate API filtering locally)
                if (!cached) {
                    try {
                        // Extract just the path and queries safely
                        const pathBase = endpoint.split('?')[0];
                        const queryStr = endpoint.split('?')[1] || '';
                        const searchParams = new URLSearchParams(queryStr);

                        if (pathBase === '/products' || pathBase.endsWith('/products')) {
                            const masterCatalog = await DB.getCachedData('/products?limit=100000');
                            if (masterCatalog && masterCatalog.value) {
                                const products = masterCatalog.value.products || masterCatalog.value;
                                const search = searchParams.get('search');
                                const barcode = searchParams.get('barcode');

                                let filtered = products;
                                if (barcode) {
                                    filtered = products.filter(p => p.barcode === barcode);
                                } else if (search) {
                                    const s = search.toLowerCase();
                                    filtered = products.filter(p =>
                                        p.name.toLowerCase().includes(s) ||
                                        (p.barcode && p.barcode.includes(s))
                                    );
                                }
                                console.log(`[Offline Intercept] Resolved ${filtered.length} products locally.`);
                                return { products: filtered, total: filtered.length, pages: 1, current_page: 1 };
                            }
                        }
                    } catch (e) {
                        console.warn('Offline parsing error:', e);
                    }
                }

                if (cached) {
                    console.log(`[Offline Fallback] Serving cached items for: ${endpoint}`);
                    return cached.value;
                }
            }
            throw err;
        }
    },

    // Sync Master Catalog for Offline Resilience
    async syncMasterCatalog() {
        if (!navigator.onLine) return;
        try {
            console.log('[Sync] Downloading Master Catalog for extended offline use...');
            // The API get() automatically caches these responses to IndexedDB via the standard loop!
            await this.get('/products?limit=100000');
            await this.get('/customers?limit=100000');
            await this.get('/services?limit=100000');
            await this.get('/settings');
            console.log('[Sync] Master Catalog cached successfully.');
        } catch (e) {
            console.warn('[Sync] Master Catalog sync failed.', e);
        }
    },

    // Trigger the Local Sidecar to sync its PostgreSQL data with the Cloud Master
    async triggerSidecarSync() {
        if (!this.isTauri || !navigator.onLine) return;
        try {
            console.log('[Sync] Triggering Sidecar -> Master PostgreSQL sync...');
            await fetch(`${LOCAL_SIDECAR_URL}/sync/sidecar-trigger`, { method: 'POST' });
            console.log('[Sync] Sidecar sync triggered successfully.');
        } catch (e) {
            console.warn('[Sync] Sidecar sync trigger failed.', e);
        }
    },

    // Sync Offline Sales
    async syncOfflineSales() {
        if (!navigator.onLine) return;

        const queue = await DB.getQueuedSales();
        if (queue.length === 0) return;

        Utils.toast(`Syncing ${queue.length} offline sale(s)...`, 'info');

        let syncedCount = 0;
        for (const sale of queue) {
            try {
                const { isOffline, tempId, queuedAt, id, ...payload } = sale;
                await this.post('/sales', payload);
                await DB.removeQueuedSale(sale.id);
                syncedCount++;
            } catch (err) {
                console.error('Sync failed for sale:', sale, err);
            }
        }

        if (syncedCount > 0) {
            Utils.toast(`Synced ${syncedCount} sale(s) successfully!`, 'success');
            // Bust inventory cache so stock counts refresh
            if (App.state) App.state.inventory = null;
        }
    },

    // Sync Offline Mutations (product edits, etc.)
    async syncOfflineMutations() {
        if (!navigator.onLine) return;

        let queue;
        try {
            queue = await DB.getQueuedMutations();
        } catch (e) {
            console.warn('[Sync] Could not read mutations queue:', e);
            return;
        }
        if (!queue || queue.length === 0) return;

        console.log(`[Sync] Replaying ${queue.length} queued mutation(s)...`);
        let synced = 0;

        for (const mut of queue) {
            try {
                await this.request(mut.endpoint, {
                    method: mut.method,
                    body: mut.body ? JSON.stringify(mut.body) : undefined
                });
                await DB.removeQueuedMutation(mut.id);
                synced++;
            } catch (err) {
                console.error('[Sync] Mutation replay failed:', mut, err);
                // Leave in queue for next attempt
            }
        }

        if (synced > 0) {
            Utils.toast(`Synced ${synced} offline edit(s).`, 'success');
            // Bust caches so pages reload fresh data
            if (App.state) {
                App.state.inventory = null;
                App.state.products = null;
                App.state.services = null;
            }
        }
    },

    get(endpoint) {
        return this.request(endpoint);
    },

    post(endpoint, body) {
        return this.request(endpoint, { method: 'POST', body: JSON.stringify(body) });
    },

    put(endpoint, body) {
        return this.request(endpoint, { method: 'PUT', body: JSON.stringify(body) });
    },

    patch(endpoint, body) {
        return this.request(endpoint, { method: 'PATCH', body: JSON.stringify(body) });
    },

    delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    }
};
