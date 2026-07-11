/**
 * Zachi Smart-POS — Sync status badge & "Pending sync" panel.
 *
 * Renders into the existing #sync-status block in the top header:
 *   • a coloured dot (green = online + queue empty,
 *                    amber = pending,
 *                    red   = offline,
 *                    grey  = signed out / not initialised)
 *   • a label and a small pill with the queued count
 *   • a "Sync now" button that calls Sync.syncNow()
 *   • clicking the badge opens a modal listing queued + failed ops
 *     with a "Retry" / "Discard" action per failed entry.
 */
const SyncUI = {
    AUTO_SYNC_MS: 30_000,
    _autoTimer: null,

    init() {
        const dot = document.getElementById('sync-dot');
        const label = document.getElementById('sync-label');
        const pill = document.getElementById('sync-pending-pill');
        const btn = document.getElementById('sync-now-btn');
        const wrap = document.getElementById('sync-status');
        if (!dot || !label || !pill || !btn || !wrap) return;

        wrap.style.cursor = 'pointer';
        wrap.addEventListener('click', (e) => {
            // Avoid opening the panel when the user just hit "Sync now".
            if (e.target && e.target.id === 'sync-now-btn') return;
            this.showPanel();
        });

        btn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            btn.disabled = true;
            const orig = btn.textContent;
            btn.textContent = 'Syncing…';
            try {
                await Sync.syncNow();
            } finally {
                btn.disabled = false;
                btn.textContent = orig;
                this.refresh();
            }
        });

        window.addEventListener('online', () => this.refresh());
        window.addEventListener('offline', () => this.refresh());
        document.addEventListener('zspos:sync', () => this.refresh());

        // First paint and periodic auto-sync.
        this.refresh();
        if (this._autoTimer) clearInterval(this._autoTimer);
        this._autoTimer = setInterval(() => {
            if (navigator.onLine && sessionStorage.getItem('zspos_token')) {
                // Push first, then pull. Pulling on the same loop is
                // what propagates *inbound* changes from other devices
                // (price edits, customer updates, sales rung up on
                // another tablet) — without it the cross-device data
                // only refreshes on manual "Sync now" or reconnect.
                Sync.flush()
                    .catch(() => {})
                    .then(() => Sync.refresh().catch(() => {}));
            }
            this.refresh();
        }, this.AUTO_SYNC_MS);
    },

    async refresh() {
        const dot = document.getElementById('sync-dot');
        const label = document.getElementById('sync-label');
        const pill = document.getElementById('sync-pending-pill');
        if (!dot || !label || !pill) return;

        const counts = await Sync.pendingCount().catch(() => ({ total: 0, failed: 0 }));
        const online = navigator.onLine;

        if (!online) {
            dot.style.background = '#ef4444';
            dot.style.boxShadow = '0 0 6px rgba(239,68,68,0.8)';
            label.textContent = 'Offline';
        } else if (counts.total > 0) {
            dot.style.background = '#f59e0b';
            dot.style.boxShadow = '0 0 6px rgba(245,158,11,0.8)';
            label.textContent = 'Syncing…';
        } else if (counts.failed > 0) {
            dot.style.background = '#f59e0b';
            dot.style.boxShadow = '0 0 6px rgba(245,158,11,0.8)';
            label.textContent = 'Needs review';
        } else {
            dot.style.background = '#22c55e';
            dot.style.boxShadow = '0 0 6px rgba(34,197,94,0.8)';
            const last = Sync.lastPushAt();
            label.textContent = last
                ? 'Synced ' + relativeTime(last)
                : 'Online';
        }

        const pendingTotal = counts.total + counts.failed;
        if (pendingTotal > 0) {
            pill.style.display = 'inline-block';
            pill.textContent = String(pendingTotal);
        } else {
            pill.style.display = 'none';
        }
    },

    async showPanel() {
        const overlay = document.getElementById('modal-overlay');
        const content = document.getElementById('modal-content');
        if (!overlay || !content) return;

        const [sales, muts, failed] = await Promise.all([
            DB.getQueuedSales().catch(() => []),
            DB.getQueuedMutations().catch(() => []),
            DB.getFailedOps().catch(() => []),
        ]);

        const lastPush = Sync.lastPushAt();
        const lastPull = Sync.lastPullAt();
        const dev = API.getDeviceId();

        content.innerHTML = `
          <div class="modal-header" data-style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.1);">
            <h3 data-style="margin:0;color:#fff;">Pending sync</h3>
            <button class="modal-close" id="sync-panel-close" type="button" data-style="background:transparent;border:0;color:#fff;font-size:1.5rem;cursor:pointer;">&times;</button>
          </div>
          <div class="modal-body" data-style="padding:14px 18px;color:#fff;max-height:60vh;overflow:auto;">
            <p data-style="opacity:0.8;margin:0 0 10px;font-size:0.85rem;">
              Device: <code data-style="opacity:0.9;">${dev || '— not registered —'}</code><br>
              Last push: ${lastPush ? new Date(lastPush).toLocaleString() : '— never —'}<br>
              Last pull: ${lastPull ? new Date(lastPull).toLocaleString() : '— never —'}
            </p>

            <h4 data-style="margin:14px 0 6px;">Queued sales (${sales.length})</h4>
            ${renderList(sales, (s) => `
              <li data-style="margin:4px 0;">${escapeHtml(prettyOp({ method: 'POST', endpoint: '/sales', body: s }))}</li>
            `)}

            <h4 data-style="margin:14px 0 6px;">Queued mutations (${muts.length})</h4>
            ${renderList(muts, (m) => `
              <li data-style="margin:4px 0;">${escapeHtml(prettyOp(m))}</li>
            `)}

            <h4 data-style="margin:14px 0 6px;color:#fda4af;">Failed (server rejected) (${failed.length})</h4>
            ${renderList(failed, (f) => `
              <li data-style="margin:6px 0;">
                <div>${escapeHtml(prettyOp(f))}</div>
                <div data-style="font-size:0.8rem;color:#fda4af;opacity:0.9;">
                  ${escapeHtml((f.error && f.error.body && f.error.body.error) || 'Unknown error')}
                </div>
                <div data-style="margin-top:4px;display:flex;gap:6px;">
                  <button data-failed-id="${f.id}" data-action="retry"
                    data-style="background:#1f2937;color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:4px;padding:2px 8px;cursor:pointer;">Retry</button>
                  <button data-failed-id="${f.id}" data-action="discard"
                    data-style="background:#7f1d1d;color:#fff;border:0;border-radius:4px;padding:2px 8px;cursor:pointer;">Discard</button>
                </div>
              </li>
            `)}
          </div>
        `;
        overlay.classList.remove('hidden');
        document.getElementById('sync-panel-close').addEventListener('click', () => {
            overlay.classList.add('hidden');
        });
        content.querySelectorAll('[data-failed-id]').forEach((btn) => {
            btn.addEventListener('click', async (ev) => {
                const id = parseInt(ev.currentTarget.dataset.failedId, 10);
                const action = ev.currentTarget.dataset.action;
                const list = await DB.getFailedOps();
                const op = list.find((x) => x.id === id);
                if (!op) return;
                if (action === 'discard') {
                    await DB.removeFailedOp(id);
                } else if (action === 'retry') {
                    // Re-queue it. PRESERVE clientOpId so reconcile-by-
                    // pull on the next sync still ties the server row
                    // back to this logical operation. Only rotate the
                    // idempotency key — that's what the server keys its
                    // replay cache on, and we want a fresh attempt
                    // (the cached 4xx response shouldn't hijack us).
                    const preservedClientOp = op.clientOpId ||
                        (window.uuidv4 ? window.uuidv4() : null);
                    const freshIdemKey = window.uuidv4 ? window.uuidv4() : null;
                    if (op.endpoint === '/sales') {
                        await DB.queueSale(op.body, {
                            clientOpId: preservedClientOp,
                            idempotencyKey: freshIdemKey,
                            deviceId: API.getDeviceId(),
                        });
                    } else {
                        await DB.queueMutation(op.method, op.endpoint, op.body, {
                            clientOpId: preservedClientOp,
                            idempotencyKey: freshIdemKey,
                            deviceId: API.getDeviceId(),
                        });
                    }
                    await DB.removeFailedOp(id);
                    Sync.flush().catch(() => {});
                }
                this.showPanel();
                this.refresh();
            });
        });
    },
};

function renderList(arr, render) {
    if (!arr || arr.length === 0) {
        return '<p data-style="opacity:0.6;font-size:0.85rem;">— none —</p>';
    }
    return `<ul data-style="margin:0;padding-left:16px;font-size:0.85rem;">${arr.map(render).join('')}</ul>`;
}

function prettyOp(op) {
    const method = op.method || 'POST';
    const endpoint = op.endpoint || '/sales';
    return `${method} ${endpoint} (queued ${
        op.queuedAt ? new Date(op.queuedAt).toLocaleTimeString() : '—'
    })`;
}

function relativeTime(iso) {
    const t = new Date(iso).getTime();
    const diff = Date.now() - t;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' min ago';
    if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' h ago';
    return new Date(iso).toLocaleDateString();
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => SyncUI.init());
