/**
 * Zachi Smart-POS — Sync engine.
 *
 * Handles the round-trip between the on-device IndexedDB queues and
 * the server's /api/sync/push + /api/sync/pull endpoints.
 *
 * Concepts
 * --------
 *   • Each queued op carries a stable `clientOpId` and `idempotencyKey`
 *     so retries are safe — the server replays the cached response
 *     instead of re-executing the work.
 *
 *   • `Sync.flush()` drains every queue (sales first, then mutations)
 *     in a single batch call.
 *
 *   • `Sync.refresh()` pulls anything that changed on the server since
 *     the last successful flush so other devices' work is reflected
 *     locally.
 *
 *   • Server responses for queued sales contain the *real* sale_number
 *     ("ZC-YYYYMMDD-NNN") which we patch onto any printed offline
 *     receipts (reconciliation).
 */
const Sync = {
    LAST_PULL_KEY: 'zspos_last_pull',
    LAST_PUSH_KEY: 'zspos_last_push',
    BATCH_SIZE: 50,
    _running: false,
    _listeners: [],

    on(fn) {
        this._listeners.push(fn);
    },

    _emit(state) {
        for (const fn of this._listeners) {
            try { fn(state); } catch (e) { console.warn('sync listener:', e); }
        }
        document.dispatchEvent(new CustomEvent('zspos:sync', { detail: state }));
    },

    async pendingCount() {
        const [sales, muts, failed] = await Promise.all([
            DB.getQueuedSales().catch(() => []),
            DB.getQueuedMutations().catch(() => []),
            DB.getFailedOps().catch(() => []),
        ]);
        return {
            sales: sales.length,
            mutations: muts.length,
            failed: failed.length,
            total: sales.length + muts.length,
        };
    },

    /**
     * Build the `operations[]` payload for /api/sync/push.
     * Backfills clientOpId / idempotencyKey on legacy queue records
     * (those captured before the sync engine landed). The backfilled
     * IDs are PERSISTED back to IndexedDB before the push goes out so
     * a retry that arrives after a dropped response uses the same
     * key — otherwise the server would treat it as a brand-new write
     * and we could end up with two sales for one cashier action.
     */
    async _buildOps(queueRecords, endpoint, method) {
        const ops = [];
        const store = endpoint === '/sales' ? DB.STORES.SALES_QUEUE : DB.STORES.MUTATIONS_QUEUE;
        for (const rec of queueRecords) {
            let { clientOpId, idempotencyKey } = rec;
            const needsPersist = !clientOpId || !idempotencyKey;
            if (!clientOpId) clientOpId = window.uuidv4 ? window.uuidv4() : null;
            if (!idempotencyKey) idempotencyKey = window.uuidv4 ? window.uuidv4() : null;
            if (needsPersist) {
                // Write the IDs back to the queue row so the next
                // attempt — even after a process restart — replays
                // with the same idempotency identity.
                try {
                    await DB.set(store, { ...rec, clientOpId, idempotencyKey });
                } catch (e) {
                    console.warn('[Sync] backfill persist failed:', e && e.message);
                }
            }
            ops.push({
                _localId: rec.id,
                _store: store,
                clientOpId,
                idempotencyKey,
                endpoint: rec.endpoint || endpoint,
                method: rec.method || method,
                body: rec.body || stripQueueMeta(rec),
                queuedAt: rec.queuedAt ? new Date(rec.queuedAt).toISOString() : null,
            });
        }
        return ops;
    },

    /**
     * Drain the offline queues to the server. Call this on `online`
     * events, on a periodic timer, and from the manual "Sync now" button.
     */
    async flush() {
        if (this._running) return;
        if (!navigator.onLine) return;
        const token = sessionStorage.getItem('zspos_token');
        if (!token) return; // not signed in yet

        this._running = true;
        this._emit({ phase: 'flush:start' });

        try {
            const [sales, muts] = await Promise.all([
                DB.getQueuedSales().catch(() => []),
                DB.getQueuedMutations().catch(() => []),
            ]);

            // Sales have to push first because subsequent mutations
            // (e.g. credit payments) may reference a sale_id we're
            // about to mint server-side.
            const [salesOps, mutOps] = await Promise.all([
                this._buildOps(sales, '/sales', 'POST'),
                this._buildOps(muts, null, null),
            ]);
            const ops = [...salesOps, ...mutOps];
            if (ops.length === 0) {
                this._emit({ phase: 'flush:empty' });
                return { pushed: 0 };
            }

            let pushedOk = 0;
            let pushedFail = 0;

            for (let i = 0; i < ops.length; i += this.BATCH_SIZE) {
                const batch = ops.slice(i, i + this.BATCH_SIZE);
                const wireOps = batch.map(({ _localId, _store, ...rest }) => rest);

                let resp;
                try {
                    resp = await API.request('/sync/push', {
                        method: 'POST',
                        body: JSON.stringify({
                            deviceId: API.getDeviceId(),
                            operations: wireOps,
                        }),
                        _skipQueue: true, // never queue the queue-flushing call
                    });
                } catch (err) {
                    console.warn('[Sync] push batch failed:', err.message);
                    this._emit({ phase: 'flush:error', error: err.message });
                    return { pushed: pushedOk, failed: pushedFail, error: err.message };
                }

                const results = (resp && resp.results) || [];
                for (let j = 0; j < results.length; j++) {
                    const r = results[j];
                    const localOp = batch[j];
                    if (!localOp) continue;

                    if (r.status >= 200 && r.status < 300) {
                        await DB.delete(localOp._store, localOp._localId).catch(() => {});
                        pushedOk++;
                        // Receipt reconciliation: bridge ZC-OFF-* receipt
                        // numbers to the server-minted ZC-* numbers so
                        // the user can search later.
                        if (r.response && r.response.sale_number) {
                            this._emit({
                                phase: 'reconcile:sale',
                                clientOpId: localOp.clientOpId,
                                offlineId: localOp.body && localOp.body.tempId,
                                saleNumber: r.response.sale_number,
                                saleId: r.response.sale_id,
                            });
                        }
                    } else if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
                        // 4xx (except 408/429) means this op will never
                        // succeed without intervention — record it for
                        // the failed-ops UI and drop it from the queue.
                        await DB.recordFailedOp(localOp, {
                            status: r.status,
                            body: r.error,
                        }).catch(() => {});
                        await DB.delete(localOp._store, localOp._localId).catch(() => {});
                        pushedFail++;
                    } else {
                        // 5xx / network → leave in queue for next attempt.
                        console.warn('[Sync] op deferred for retry', r);
                    }
                }
            }

            localStorage.setItem(this.LAST_PUSH_KEY, new Date().toISOString());
            this._emit({ phase: 'flush:done', ok: pushedOk, failed: pushedFail });

            if (pushedOk > 0 && typeof Utils !== 'undefined') {
                Utils.toast(`Synced ${pushedOk} change(s).`, 'success');
                // Bust SPA caches so pages reload fresh server state.
                if (typeof App !== 'undefined' && App.state) {
                    App.state.inventory = null;
                    App.state.products = null;
                    App.state.services = null;
                }
            }
            if (pushedFail > 0 && typeof Utils !== 'undefined') {
                Utils.toast(`${pushedFail} change(s) were rejected — check Pending sync.`, 'warning');
            }

            return { pushed: pushedOk, failed: pushedFail };
        } finally {
            this._running = false;
        }
    },

    /**
     * Pull deltas (sales / products / customers) since the last cursor,
     * apply them to the local cache, and reconcile any pulled rows
     * back to in-flight client ops by `client_op_id`. This lets a
     * different cashier see this device's sales without a hard
     * reload, AND it lets THIS device confirm its own queued writes
     * landed even when the push response was lost on the network.
     */
    async refresh() {
        if (!navigator.onLine) return;
        const since = localStorage.getItem(this.LAST_PULL_KEY) ||
                      new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        try {
            const data = await API.request(`/sync/pull?since=${encodeURIComponent(since)}`, {
                method: 'GET',
                _skipQueue: true,
            });

            // Apply the delta to IndexedDB BEFORE moving the cursor —
            // otherwise a crash mid-apply would advance the cursor and
            // we'd lose the rows on the next pull.
            const counts = await this._applyPullDelta(data || {});

            if (data && data.cursor) {
                localStorage.setItem(this.LAST_PULL_KEY, data.cursor);
            }
            this._emit({
                phase: 'pull:done',
                counts,
                cursor: (data && data.cursor) || null,
                scope: (data && data.scope) || null,
            });
            return data;
        } catch (err) {
            console.warn('[Sync] pull failed:', err.message);
            this._emit({ phase: 'pull:error', error: err.message });
            return null;
        }
    },

    /**
     * Merge a /sync/pull response into IndexedDB and reconcile any
     * pulled sales back to queued offline ops. The cache write per
     * entity uses the same `data` KV store the API layer uses for
     * GET-response caching — listing pages will see fresh rows on the
     * next render without needing a network round-trip.
     */
    async _applyPullDelta(data) {
        const counts = {
            sales: (data.sales || []).length,
            products: (data.products || []).length,
            customers: (data.customers || []).length,
            reconciled: 0,
        };

        // Merge the entity slices into the same cache slots that
        // api.js writes to for `GET /products`, `GET /customers`, and
        // `GET /sales`. The API layer's offline-fallback path reads
        // `await DB.getCachedData(endpoint)` keyed by the bare
        // endpoint string (see api.js:160) — using a different key
        // ("?delta") meant the next offline read missed our updates.
        try {
            await this._mergeIntoCache('/products', data.products, 'product_id');
            await this._mergeIntoCache('/customers', data.customers, 'customer_id');
            await this._mergeIntoCache('/sales', data.sales, 'sale_id');
        } catch (err) {
            console.warn('[Sync] delta cache write failed:', err && err.message);
        }

        // Reconcile pulled sales back to queued ops. If the network
        // dropped the push response but the server actually accepted
        // the sale, the row will reappear here with our client_op_id
        // and we can drop the queue entry + emit a reconcile event.
        try {
            const queued = await DB.getQueuedSales().catch(() => []);
            const byClientOp = new Map();
            for (const q of queued) {
                if (q.clientOpId) byClientOp.set(q.clientOpId, q);
            }
            for (const sale of (data.sales || [])) {
                if (!sale || !sale.client_op_id) continue;
                const match = byClientOp.get(sale.client_op_id);
                if (!match) continue;
                await DB.delete(DB.STORES.SALES_QUEUE, match.id).catch(() => {});
                this._emit({
                    phase: 'reconcile:sale',
                    via: 'pull',
                    clientOpId: sale.client_op_id,
                    saleNumber: sale.sale_number,
                    saleId: sale.sale_id,
                });
                counts.reconciled++;
            }
        } catch (err) {
            console.warn('[Sync] reconcile failed:', err.message);
        }

        // Bust in-memory SPA caches so the next page render reads the
        // fresh delta from IndexedDB / the network.
        if (typeof App !== 'undefined' && App.state) {
            if (counts.products) App.state.products = null;
            if (counts.customers) App.state.customers = null;
            if (counts.sales) App.state.sales = null;
            App.state.inventory = null;
        }

        return counts;
    },

    /**
     * Convenience: flush + refresh, used by the "Sync now" button.
     */
    async syncNow() {
        const f = await this.flush();
        const r = await this.refresh();
        return { flush: f, refresh: r };
    },

    lastPushAt() {
        return localStorage.getItem(this.LAST_PUSH_KEY);
    },
    lastPullAt() {
        return localStorage.getItem(this.LAST_PULL_KEY);
    },
};

/**
 * Merge a delta array into the existing cached list under `endpoint`.
 * The api.js cache stores the *full* GET response under the bare
 * endpoint string. To keep that consistent we read it, upsert each
 * delta row by its primary key, and write the merged list back. If
 * no cached list exists yet (first run, never visited the page) we
 * still seed it with the deltas so the next offline read has data.
 */
Sync._mergeIntoCache = async function _mergeIntoCache(endpoint, deltas, pk) {
    if (!deltas || deltas.length === 0) return;
    let current = [];
    try {
        const cached = await DB.getCachedData(endpoint);
        if (Array.isArray(cached)) current = cached;
        else if (cached && Array.isArray(cached.data)) current = cached.data;
    } catch (_) {
        current = [];
    }
    const byPk = new Map(current.map((row) => [row[pk], row]));
    for (const row of deltas) {
        if (row && row[pk] != null) byPk.set(row[pk], { ...byPk.get(row[pk]), ...row });
    }
    await DB.cacheData(endpoint, Array.from(byPk.values()));
};

/** Strip queue-only metadata fields when reconstructing a sale body. */
function stripQueueMeta(rec) {
    const { id, queuedAt, clientOpId, idempotencyKey, deviceId, ...rest } = rec;
    return rest;
}
