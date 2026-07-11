/**
 * Zachi Smart-POS — IndexedDB wrapper.
 *
 * Stores
 * ------
 *   data              key/value cache for GET responses (offline reads)
 *   sales_queue       offline sales waiting to be pushed
 *   mutations_queue   offline non-sale mutations (PUT/PATCH/DELETE/POST)
 *   failed_ops        ops the server rejected with a 4xx that need
 *                     human review (e.g. INSUFFICIENT_STOCK after a
 *                     race) — never re-tried automatically
 *
 * Versions
 * --------
 *   v1: data + sales_queue
 *   v2: + mutations_queue
 *   v3: + failed_ops; queue records gain { clientOpId, idempotencyKey }
 *       (legacy records without these fields still work because the
 *       sync engine fills them in on first replay)
 */
const DB = {
    db: null,
    DB_NAME: 'ZachiPOS_DB',
    DB_VERSION: 3,
    STORES: {
        DATA: 'data',
        SALES_QUEUE: 'sales_queue',
        MUTATIONS_QUEUE: 'mutations_queue',
        FAILED_OPS: 'failed_ops',
    },

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = (e) => {
                console.error('DB Error:', e.target.error);
                reject(e.target.error);
            };

            request.onsuccess = (e) => {
                this.db = e.target.result;
                console.log('DB Opened (v' + this.DB_VERSION + ')');
                resolve(this.db);
            };

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.STORES.DATA)) {
                    db.createObjectStore(this.STORES.DATA, { keyPath: 'key' });
                }
                if (!db.objectStoreNames.contains(this.STORES.SALES_QUEUE)) {
                    db.createObjectStore(this.STORES.SALES_QUEUE, {
                        keyPath: 'id',
                        autoIncrement: true,
                    });
                }
                if (!db.objectStoreNames.contains(this.STORES.MUTATIONS_QUEUE)) {
                    db.createObjectStore(this.STORES.MUTATIONS_QUEUE, {
                        keyPath: 'id',
                        autoIncrement: true,
                    });
                }
                if (!db.objectStoreNames.contains(this.STORES.FAILED_OPS)) {
                    db.createObjectStore(this.STORES.FAILED_OPS, {
                        keyPath: 'id',
                        autoIncrement: true,
                    });
                }
            };
        });
    },

    async _tx(storeName, mode, fn) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            const req = fn(store);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    get(storeName, key) {
        return this._tx(storeName, 'readonly', (s) => s.get(key)).then((r) =>
            r ? r.value : null
        );
    },

    getAll(storeName) {
        return this._tx(storeName, 'readonly', (s) => s.getAll());
    },

    set(storeName, data) {
        return this._tx(storeName, 'readwrite', (s) => s.put(data));
    },

    delete(storeName, key) {
        return this._tx(storeName, 'readwrite', (s) => s.delete(key));
    },

    async clearStore(storeName) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const req = tx.objectStore(storeName).clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },

    // ── KV cache helpers ───────────────────────────────────────────
    async cacheData(key, value) {
        await this.set(this.STORES.DATA, { key, value, timestamp: Date.now() });
    },

    async getCachedData(key) {
        return this.get(this.STORES.DATA, key);
    },

    // ── Sales queue ────────────────────────────────────────────────
    /**
     * Enqueue an offline sale.
     * @param {object} saleData      the POST /api/sales body
     * @param {object} meta          { clientOpId, idempotencyKey, deviceId }
     */
    async queueSale(saleData, meta) {
        const record = {
            ...saleData,
            queuedAt: Date.now(),
            clientOpId: meta && meta.clientOpId,
            idempotencyKey: meta && meta.idempotencyKey,
            deviceId: meta && meta.deviceId,
        };
        return this.set(this.STORES.SALES_QUEUE, record);
    },

    getQueuedSales() {
        return this.getAll(this.STORES.SALES_QUEUE);
    },

    removeQueuedSale(id) {
        return this.delete(this.STORES.SALES_QUEUE, id);
    },

    // ── Mutations queue ────────────────────────────────────────────
    /**
     * Enqueue any non-sale mutating call.
     * @param {string} method
     * @param {string} endpoint  e.g. "/customers" or "/customers/12"
     * @param {object|null} body
     * @param {object} meta      { clientOpId, idempotencyKey, deviceId }
     */
    async queueMutation(method, endpoint, body, meta) {
        const record = {
            method,
            endpoint,
            body,
            queuedAt: Date.now(),
            clientOpId: meta && meta.clientOpId,
            idempotencyKey: meta && meta.idempotencyKey,
            deviceId: meta && meta.deviceId,
        };
        return this.set(this.STORES.MUTATIONS_QUEUE, record);
    },

    getQueuedMutations() {
        return this.getAll(this.STORES.MUTATIONS_QUEUE);
    },

    removeQueuedMutation(id) {
        return this.delete(this.STORES.MUTATIONS_QUEUE, id);
    },

    // ── Failed ops (server rejected with 4xx) ──────────────────────
    async recordFailedOp(op, errorInfo) {
        const record = {
            ...op,
            failedAt: Date.now(),
            error: errorInfo,
        };
        return this.set(this.STORES.FAILED_OPS, record);
    },

    getFailedOps() {
        return this.getAll(this.STORES.FAILED_OPS);
    },

    removeFailedOp(id) {
        return this.delete(this.STORES.FAILED_OPS, id);
    },

    clearFailedOps() {
        return this.clearStore(this.STORES.FAILED_OPS);
    },
};

// ── UUID v4 helper used by api.js + sync.js ────────────────────────
// crypto.randomUUID is available in modern browsers; fall back to a
// quick rfc4122 v4 builder for older WebViews (some Android versions
// of WebView still ship without it).
if (typeof window !== 'undefined' && !window.uuidv4) {
    window.uuidv4 = function uuidv4() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        const b = new Uint8Array(16);
        (window.crypto || window.msCrypto).getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
        return (
            hex.slice(0, 4).join('') +
            '-' +
            hex.slice(4, 6).join('') +
            '-' +
            hex.slice(6, 8).join('') +
            '-' +
            hex.slice(8, 10).join('') +
            '-' +
            hex.slice(10, 16).join('')
        );
    };
}
