/**
 * Zachi Smart-POS - API Client
 * Handles all HTTP requests with JWT authentication
 */
const API = {
    baseUrl: '/api',
    token: localStorage.getItem('zspos_token'),

    setToken(token) {
        this.token = token;
        localStorage.setItem('zspos_token', token);
    },

    clearToken() {
        this.token = null;
        localStorage.removeItem('zspos_token');
        localStorage.removeItem('zspos_user');
    },

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = { 'Content-Type': 'application/json' };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        // Offline Handling
        if (!navigator.onLine) {
            // 1. Try to serve from DB cache for GET requests
            if (!options.method || options.method === 'GET') {
                try {
                    const cached = await DB.getCachedData(endpoint);
                    if (cached) {
                        console.log(`[Offline] Serving cached: ${endpoint}`);
                        return cached.value;
                    }
                } catch (e) {
                    console.warn('DB Cache Error:', e);
                }
                throw new Error('You are offline and no cached data is available.');
            }

            // 2. Queue critical POST requests (Sales)
            if (options.method === 'POST' && endpoint === '/sales') {
                const body = JSON.parse(options.body);
                // Assign a temp ID and mark as offline
                const offlineSale = {
                    ...body,
                    isOffline: true,
                    tempId: Date.now()
                };

                try {
                    await DB.queueSale(offlineSale);
                    Utils.toast('Offline: Sale saved to queue.', 'info');
                    // Return a fake success response to keep POS happy
                    return {
                        sale_id: offlineSale.tempId,
                        sale_number: `OFF-${offlineSale.tempId}`,
                        total_amount: body.amount_paid || 0,
                        items: body.items,
                        is_offline: true,
                        // Add name/total_price for receipt modal structure
                        payment_method: body.payment_method
                    };
                } catch (e) {
                    console.error('Offline Queue Error:', e);
                    throw new Error('Failed to save offline sale.');
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

            const data = await response.json();

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
            // If fetch fails (network error), try DB cache as fallback 
            // Broadened to catch "Failed to fetch" (browser) and generic "Offline" errors
            if (!options.method || options.method === 'GET') {
                const isNetworkError = err.message.includes('Failed to fetch') ||
                    err.message.includes('Offline') ||
                    err instanceof TypeError;

                if (isNetworkError) {
                    const cached = await DB.getCachedData(endpoint);
                    if (cached) {
                        console.log(`[Offline Fallback] Serving cached items for: ${endpoint}`);
                        return cached.value;
                    }
                }
            }
            throw err;
        }
    },

    // Sync Offline Sales
    async syncOfflineSales() {
        if (!navigator.onLine) return;

        const queue = await DB.getQueuedSales();
        if (queue.length === 0) return;

        Utils.toast(`Syncing ${queue.length} offline sales...`, 'info');

        let syncedCount = 0;
        for (const sale of queue) {
            try {
                // Remove offline-specific fields
                const { isOffline, tempId, queuedAt, ...payload } = sale;

                await this.post('/sales', payload);
                await DB.removeQueuedSale(sale.id); // 'id' from IDB autoIncrement
                syncedCount++;
            } catch (err) {
                console.error('Sync failed for sale:', sale, err);
                // Keep in queue?
            }
        }

        if (syncedCount > 0) {
            Utils.toast(`Synced ${syncedCount} sales successfully!`, 'success');
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
