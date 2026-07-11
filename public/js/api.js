/**
 * Zachi Smart-POS — API client.
 *
 * Responsibilities
 * ----------------
 *   • Bearer-token auth.
 *   • Stamp every mutating request with X-Device-Id (registered once
 *     in localStorage) and X-Client-Op-Id + Idempotency-Key (UUIDs
 *     generated on the spot).
 *   • Cache GET responses for offline reads.
 *   • Queue mutating requests when offline, returning an "offline
 *     receipt" so the cashier can keep ringing up sales without
 *     blocking on the network.
 *
 * The actual flushing of the queue lives in sync.js (Sync.flush /
 * Sync.refresh) — keeps this file focused on a single request.
 */
const API = {
    // Default base URL — used when running as a same-origin PWA. In a
    // Capacitor wrapper (Android / desktop) the bridge persists a
    // different host into `localStorage.zspos_backend_url`, which
    // `_resolveBaseUrl()` reads on every request. See
    // `js/native/capacitor-bridge.js`.
    baseUrl: '/api',
    token: sessionStorage.getItem('zspos_token'),

    /**
     * Resolve the active API base URL at request time. The Settings
     * screen lets a director change this; the bridge mirrors it from
     * Capacitor Preferences into localStorage on cold start so this
     * lookup is always synchronous.
     */
    _resolveBaseUrl() {
        try {
            const u = localStorage.getItem('zspos_backend_url');
            if (u) {
                const trimmed = String(u).trim().replace(/\/+$/, '');
                if (trimmed) return `${trimmed}/api`;
            }
        } catch (_) { /* storage disabled */ }
        return this.baseUrl;
    },

    // ── Token plumbing ─────────────────────────────────────────────
    setToken(token) {
        this.token = token;
        sessionStorage.setItem('zspos_token', token);
    },

    clearToken() {
        this.token = null;
        sessionStorage.removeItem('zspos_token');
        sessionStorage.removeItem('zspos_user');
    },

    // ── Device identity (one per install, stored in localStorage) ──
    DEVICE_KEY: 'zspos_device_id',

    getDeviceId() {
        return localStorage.getItem(this.DEVICE_KEY) || null;
    },

    setDeviceId(id) {
        if (id) localStorage.setItem(this.DEVICE_KEY, id);
    },

    /**
     * Ensure this install is registered with the server. Called once
     * after a successful login. Idempotent — server upserts on the
     * device_id key, so calling repeatedly is safe.
     */
    async ensureDeviceRegistered() {
        if (!navigator.onLine) return null;
        try {
            const existing = this.getDeviceId();
            const data = await this.request('/devices/register', {
                method: 'POST',
                body: JSON.stringify({
                    deviceId: existing || undefined,
                    platform: this._guessPlatform(),
                    label: this._guessLabel(),
                }),
                _skipQueue: true, // never queue device registration
            });
            if (data && data.deviceId) this.setDeviceId(data.deviceId);
            return data;
        } catch (err) {
            console.warn('[API] device registration failed:', err.message);
            return null;
        }
    },

    _guessPlatform() {
        const ua = navigator.userAgent || '';
        if (/Android/i.test(ua)) return 'android';
        if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
        if (/Windows/i.test(ua)) return 'windows';
        if (/Macintosh|Mac OS/i.test(ua)) return 'desktop';
        return 'web';
    },

    _guessLabel() {
        // Best-effort short tag for the back-office device list.
        const ua = navigator.userAgent || '';
        const m = ua.match(/\(([^)]+)\)/);
        return m ? m[1].slice(0, 60) : null;
    },

    // ── Header building ────────────────────────────────────────────
    _baseHeaders(extra) {
        const headers = { 'Content-Type': 'application/json' };
        if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
        const dev = this.getDeviceId();
        if (dev) headers['X-Device-Id'] = dev;
        // The Capacitor bridge sets a stable client-id string so server
        // logs can attribute traffic to the Android wrapper. In a
        // browser this is undefined and the header is omitted.
        if (typeof window !== 'undefined' && window.__ZSPOS_NATIVE_UA__) {
            headers['X-Client-Agent'] = window.__ZSPOS_NATIVE_UA__;
        }
        if (extra) Object.assign(headers, extra);
        return headers;
    },

    // True for any request that mutates server state.
    _isMutating(method) {
        return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || '').toUpperCase());
    },

    /**
     * Internal: perform the actual HTTP request, handling auth, caching
     * and queueing. `options._skipQueue` disables offline fallback for
     * cases where queueing makes no sense (login, device register).
     */
    async request(endpoint, options = {}) {
        // Desktop-only: hold the very first call until the Tauri
        // bridge has resolved baseUrl and the device id from the
        // store. Subsequent calls hit an already-resolved promise so
        // there's no measurable overhead. (Capacitor's bridge sets
        // localStorage.zspos_backend_url synchronously, so the
        // Capacitor path doesn't need an analogous await.)
        if (window.IS_TAURI_DESKTOP && window.__ZACHI_DESKTOP_READY) {
            try { await window.__ZACHI_DESKTOP_READY; } catch (_) { /* fall through */ }
        }
        const url = `${this._resolveBaseUrl()}${endpoint}`;
        const method = (options.method || 'GET').toUpperCase();

        // Generate per-request UUIDs for mutating calls so the server
        // can deduplicate replays. We attach them to BOTH the headers
        // and the queued record so an offline retry uses the same key.
        let clientOpId = options._clientOpId;
        let idempotencyKey = options._idempotencyKey;
        if (this._isMutating(method)) {
            clientOpId = clientOpId || (window.uuidv4 ? window.uuidv4() : null);
            idempotencyKey = idempotencyKey || (window.uuidv4 ? window.uuidv4() : null);
        }

        const headers = this._baseHeaders(options.headers);
        if (clientOpId) headers['X-Client-Op-Id'] = clientOpId;
        if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

        // ── Offline path ──────────────────────────────────────────
        if (!navigator.onLine && !options._skipQueue) {
            return this._handleOffline(endpoint, method, options, {
                clientOpId,
                idempotencyKey,
            });
        }

        try {
            const response = await fetch(url, { ...options, method, headers });

            if (response.status === 401 && !url.includes('/auth/login')) {
                this.clearToken();
                if (typeof App !== 'undefined' && App.showLogin) App.showLogin();
                else window.location.hash = '#/login';
                throw new Error('Unauthorized');
            }

            // 204 No Content shortcut
            const contentType = response.headers.get('content-type') || '';
            const data = contentType.includes('application/json') && response.status !== 204
                ? await response.json()
                : null;

            if (!response.ok) {
                const err = new Error((data && data.error) || `Request failed (${response.status})`);
                err.status = response.status;
                err.code = data && data.code;
                err.details = data && data.details;
                err.responseBody = data;
                throw err;
            }

            // Cache select GET responses.
            if (method === 'GET' && CACHEABLE_GET_RE.test(endpoint)) {
                DB.cacheData(endpoint, data).catch((e) => console.warn('Cache write failed', e));
            }

            return data;
        } catch (err) {
            // Network failures while we *thought* we were online: fall
            // back to cache for GETs, queue for mutations.
            const isNetworkErr =
                err instanceof TypeError ||
                (err.message && (err.message.includes('Failed to fetch') ||
                                 err.message.includes('NetworkError') ||
                                 err.message.includes('ERR_INTERNET_DISCONNECTED')));

            if (isNetworkErr && !options._skipQueue) {
                if (method === 'GET') {
                    const cached = await DB.getCachedData(endpoint);
                    if (cached) {
                        console.log(`[API] cached fallback for ${endpoint}`);
                        return cached;
                    }
                }
                if (this._isMutating(method)) {
                    return this._handleOffline(endpoint, method, options, {
                        clientOpId,
                        idempotencyKey,
                    });
                }
            }
            console.error(`API Error [${endpoint}]:`, err);
            throw err;
        }
    },

    /**
     * Queue a mutating request and return an offline-shaped response so
     * downstream UI code can keep working as if the call had succeeded.
     */
    async _handleOffline(endpoint, method, options, meta) {
        const body = options.body ? JSON.parse(options.body) : null;
        const deviceId = this.getDeviceId();

        if (method === 'POST' && endpoint === '/sales') {
            const tempId = Date.now();
            try {
                await DB.queueSale(body, { ...meta, deviceId });
            } catch (e) {
                console.error('Offline sale queue error:', e);
                throw new Error('Failed to save offline sale.');
            }
            if (typeof Utils !== 'undefined') {
                Utils.toast('Offline: sale queued — will sync when online.', 'info');
            }
            // The offline sale number follows the spec's
            // `ZC-OFF-<deviceId>-<n>` shape — `ZC-OFF-` makes it
            // obvious on the printed receipt that the canonical
            // number will come down later from the server during
            // reconciliation, and `<deviceId>-<n>` keeps it globally
            // unique across all tablets even before a server round-trip.
            const offlineCountKey = 'zspos_offline_sale_counter';
            const nextN = (parseInt(localStorage.getItem(offlineCountKey) || '0', 10) || 0) + 1;
            try { localStorage.setItem(offlineCountKey, String(nextN)); } catch (_) {}
            const devId = deviceId || 'local';
            return {
                sale_id: tempId,
                sale_number: `ZC-OFF-${devId}-${nextN}`,
                client_op_id: meta.clientOpId,
                total_amount: body && body.amount_paid ? body.amount_paid : 0,
                items: body && body.items,
                payment_method: body && body.payment_method,
                is_offline: true,
                queued_at: new Date().toISOString(),
            };
        }

        if (this._isMutating(method)) {
            try {
                await DB.queueMutation(method, endpoint, body, { ...meta, deviceId });
            } catch (e) {
                console.error('Offline mutation queue error:', e);
                throw new Error('Failed to queue offline change.');
            }
            if (typeof Utils !== 'undefined') {
                Utils.toast('Offline: change queued — will sync when you reconnect.', 'info');
            }
            return { queued: true, offline: true, client_op_id: meta.clientOpId };
        }

        // Read with no cache hit — surface a clear error.
        if (method === 'GET') {
            const cached = await DB.getCachedData(endpoint);
            if (cached) return cached;
        }
        throw new Error('You are offline and no cached data is available.');
    },

    // ── Convenience verbs ──────────────────────────────────────────
    get(endpoint) {
        return this.request(endpoint, { method: 'GET' });
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
    },

    // ── Legacy shims kept so older callers (app.js online listener,
    //    inventory.js, etc.) keep working. They simply delegate to the
    //    new Sync engine. ────────────────────────────────────────────
    async syncOfflineSales() {
        if (typeof Sync !== 'undefined' && Sync && typeof Sync.flush === 'function') {
            return Sync.flush();
        }
    },
    async syncOfflineMutations() {
        if (typeof Sync !== 'undefined' && Sync && typeof Sync.flush === 'function') {
            return Sync.flush();
        }
    },
};

// Endpoints whose GET responses are worth caching for offline reads.
const CACHEABLE_GET_RE = /\/(products|services|settings|payments|customers|dashboard|reports|users|suppliers|inventory|loyalty|currency|auth\/me|notifications|jobs|quotes|invoices|promotions|cash|purchases|returns|stock|approvals|audit|ai)/;
