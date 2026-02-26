/**
 * Zachi Smart-POS - IndexedDB Wrapper
 * Handles offline storage for products, services, and sales queue
 */
const DB = {
    db: null,
    DB_NAME: 'ZachiPOS_DB',
    DB_VERSION: 1,
    STORES: {
        DATA: 'data', // products, services, settings
        SALES_QUEUE: 'sales_queue' // offline sales to sync
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
                console.log('DB Opened successfully');
                resolve(this.db);
            };

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                // Store for general data (key-value)
                if (!db.objectStoreNames.contains(this.STORES.DATA)) {
                    db.createObjectStore(this.STORES.DATA, { keyPath: 'key' });
                }
                // Store for offline sales queue (auto-increment id)
                if (!db.objectStoreNames.contains(this.STORES.SALES_QUEUE)) {
                    db.createObjectStore(this.STORES.SALES_QUEUE, { keyPath: 'id', autoIncrement: true });
                }
            };
        });
    },

    async get(storeName, key) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result ? request.result.value : null);
            request.onerror = () => reject(request.error);
        });
    },

    async getAll(storeName) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async set(storeName, data) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async delete(storeName, key) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    // ── Helper Methods ──

    async cacheData(key, value) {
        await this.set(this.STORES.DATA, { key, value, timestamp: Date.now() });
    },

    async getCachedData(key) {
        const result = await this.get(this.STORES.DATA, key);
        return result ? result.value : null;
    },

    async queueSale(saleData) {
        const record = {
            ...saleData,
            queuedAt: Date.now()
        };
        return this.set(this.STORES.SALES_QUEUE, record);
    },

    async getQueuedSales() {
        return this.getAll(this.STORES.SALES_QUEUE);
    },

    async removeQueuedSale(id) {
        return this.delete(this.STORES.SALES_QUEUE, id);
    }
};
