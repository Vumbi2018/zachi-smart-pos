/**
 * Notifications page (v1.0.16) — full-screen list with detail modal.
 *
 * v1.0.15 was a flat list with a "Mark read" button per row. Operators
 * asked to be able to click a row and read the whole notification, so
 * this rewrite:
 *
 *   • Makes the entire row clickable; click → opens a detail modal
 *     with the full message, type icon, timestamp, related id, and
 *     auto-marks the notification as read.
 *   • Groups rows by date (Today / Yesterday / Earlier this week /
 *     Older) so triage is faster.
 *   • Picks a coloured icon per notification type (low_stock / void /
 *     approval / payment / system / …).
 *   • Keeps the All / Unread / Read filter tabs and bulk "Mark all
 *     read".
 *
 * Hash route: #/notifications
 * Backend:    GET /api/notifications?status=all|unread|read&limit=N
 *             PUT /api/notifications/:id/read
 *             PUT /api/notifications/read-all
 */
const Notifications = {
    _state: {
        filter: 'all',   // 'all' | 'unread' | 'read'
        items:  [],
        loading: false,
        openId: null,
    },

    /** Map notification.type → { icon, color, label }. Anything not
     *  here falls back to a generic info bubble — adding a new type on
     *  the backend won't break the UI. */
    _TYPE_META: {
        low_stock:    { icon: 'inventory_2',   color: '#f59e0b', label: 'Low stock' },
        void:         { icon: 'cancel',        color: '#f87171', label: 'Sale voided' },
        approval:     { icon: 'check_circle',  color: '#22c55e', label: 'Approval' },
        approval_request: { icon: 'pending',   color: '#fbbf24', label: 'Approval needed' },
        credit_order: { icon: 'receipt_long',  color: '#60a5fa', label: 'Credit order' },
        payment:      { icon: 'payments',      color: '#22c55e', label: 'Payment' },
        refund:       { icon: 'undo',          color: '#fbbf24', label: 'Refund' },
        sync:         { icon: 'sync',          color: '#7dd3fc', label: 'Sync' },
        system:       { icon: 'settings',      color: '#94a3b8', label: 'System' },
        warning:      { icon: 'warning',       color: '#f59e0b', label: 'Warning' },
        error:        { icon: 'error',         color: '#f87171', label: 'Error' },
        info:         { icon: 'info',          color: '#7dd3fc', label: 'Information' },
        general:      { icon: 'notifications', color: '#94a3b8', label: 'General' },
    },

    _typeMeta(t) {
        const key = String(t || 'general').toLowerCase();
        return this._TYPE_META[key] || { icon: 'notifications', color: '#94a3b8', label: key.replace(/_/g, ' ') || 'general' };
    },

    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <h2 class="page-title">
                    <span class="material-icons-outlined" data-style="vertical-align:middle;">notifications</span>
                    Notifications
                </h2>
                <div class="header-actions" data-style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
                    <div class="btn-group" role="group" id="notif-filter-tabs">
                        <button type="button" class="btn btn-outline-secondary btn-sm" data-on-click="Notifications.setFilter('all')"   data-filter="all">All</button>
                        <button type="button" class="btn btn-outline-secondary btn-sm" data-on-click="Notifications.setFilter('unread')" data-filter="unread">Unread</button>
                        <button type="button" class="btn btn-outline-secondary btn-sm" data-on-click="Notifications.setFilter('read')"   data-filter="read">Read</button>
                    </div>
                    <button class="btn btn-secondary btn-sm" data-on-click="Notifications.refresh()">
                        <span class="material-icons-outlined" data-style="font-size:16px;vertical-align:middle;">refresh</span>
                        Refresh
                    </button>
                    <button class="btn btn-primary btn-sm" data-on-click="Notifications.markAllRead()">
                        Mark all read
                    </button>
                </div>
            </div>

            <div class="card">
                <div id="notifications-body">
                    <div class="p-4 text-center notif-loading">Loading…</div>
                </div>
            </div>

            <!-- Detail modal — populated by openNotification(). -->
            <div id="notif-detail-modal" class="modal-overlay hidden" data-on-click="Notifications._modalBackdrop($event)">
                <div class="modal max-w-xl">
                    <div class="modal-header">
                        <h2 class="text-xl font-bold flex items-center gap-2">
                            <span id="notif-detail-icon" class="material-icons-outlined"></span>
                            <span id="notif-detail-title">Notification</span>
                        </h2>
                        <button data-on-click="Notifications.closeDetail()" class="notif-detail-close-x">
                            <span class="material-icons-outlined">close</span>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div id="notif-detail-meta" class="text-xs notif-detail-meta mb-3"></div>
                        <div id="notif-detail-message" class="text-sm notif-detail-message whitespace-pre-wrap break-words"></div>
                        <div id="notif-detail-related" class="mt-4"></div>
                        <div class="flex justify-end gap-2 mt-6 pt-4 notif-detail-footer">
                            <button data-on-click="Notifications.closeDetail()" class="btn btn-secondary">Close</button>
                        </div>
                    </div>
                </div>
            </div>

            <style>
                .notif-row {
                    display: flex; align-items: flex-start; gap: 0.75rem;
                    padding: 0.85rem 1rem;
                    cursor: pointer;
                    transition: background 0.12s;
                    border-left: 3px solid transparent;
                }
                .notif-row:hover { background: rgba(15,36,64,0.04); }
                .notif-row.unread { border-left-color: var(--primary, #1B3A5C); background: rgba(46,107,138,0.08); }
                .notif-row.unread .notif-row-msg { color: var(--text-primary); font-weight: 600; }
                .notif-row .notif-row-msg { color: var(--text-primary); font-size: 0.875rem; }
                .notif-row-icon-wrap {
                    flex-shrink: 0; width: 36px; height: 36px; border-radius: 999px;
                    display:flex;align-items:center;justify-content:center;
                    background: rgba(15,36,64,0.06);
                }
                .notif-row-meta { color: var(--text-secondary); font-size: 0.75rem; }
                .notif-row-chevron { color: var(--text-muted); }
                .notif-day-header {
                    padding: 0.5rem 1rem; font-size: 0.7rem; text-transform: uppercase;
                    letter-spacing: 0.05em; color: var(--text-secondary);
                    background: rgba(15,36,64,0.04);
                    font-weight: 600;
                }
                .notif-type-pill {
                    font-size: 0.7rem; padding: 0.1rem 0.5rem; border-radius: 4px;
                    background: rgba(15,36,64,0.06);
                    text-transform: capitalize;
                    font-weight: 500;
                }
                .notif-divider > * + * { border-top: 1px solid var(--border-light, #cbd5e1); }
                .notif-loading, .notif-empty { color: var(--text-secondary); }
                .notif-detail-meta { color: var(--text-secondary); }
                .notif-detail-message { color: var(--text-primary); }
                .notif-detail-related { color: var(--text-secondary); }
                .notif-detail-close-x { color: var(--text-secondary); }
                .notif-detail-close-x:hover { color: var(--text-primary); }
                .notif-detail-footer { border-top: 1px solid var(--border-light, #cbd5e1); }
            </style>
        `;

        this._highlightActiveFilter();
        await this.refresh();
    },

    setFilter(filter) {
        if (!['all', 'unread', 'read'].includes(filter)) return;
        this._state.filter = filter;
        this._highlightActiveFilter();
        this.refresh();
    },

    _highlightActiveFilter() {
        document.querySelectorAll('#notif-filter-tabs [data-filter]').forEach(btn => {
            const active = btn.dataset.filter === this._state.filter;
            btn.classList.toggle('btn-primary', active);
            btn.classList.toggle('btn-outline-secondary', !active);
        });
    },

    async refresh() {
        const body = document.getElementById('notifications-body');
        if (!body) return;
        if (this._state.loading) return;
        this._state.loading = true;
        body.innerHTML = '<div class="p-4 text-center notif-loading">Loading…</div>';

        try {
            const items = await API.get(`/notifications?status=${encodeURIComponent(this._state.filter)}&limit=200`);
            this._state.items = Array.isArray(items) ? items : [];
            this._renderList();
            // Refresh the bell badge so it reflects the latest server state.
            if (window.App && typeof App.checkNotifications === 'function') {
                App.checkNotifications();
            }
        } catch (err) {
            console.error('Notifications.refresh failed', err);
            body.innerHTML = `
                <div class="p-4 text-center text-red-500">
                    Could not load notifications. ${Utils.escapeHtml(err && err.message ? err.message : '')}
                </div>`;
        } finally {
            this._state.loading = false;
        }
    },

    /** Group helper — buckets a Date into a friendly label. */
    _bucketFor(date) {
        const now = new Date();
        const d = new Date(date);
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const dayKey = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const diffDays = Math.round((today - dayKey) / 86400000);
        if (diffDays <= 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7)   return 'Earlier this week';
        return 'Older';
    },

    _renderList() {
        const body = document.getElementById('notifications-body');
        if (!body) return;

        const items = this._state.items;
        if (!items.length) {
            const emptyMsg = this._state.filter === 'unread'
                ? 'No unread notifications. You\'re all caught up.'
                : (this._state.filter === 'read'
                    ? 'No read notifications yet.'
                    : 'No notifications yet.');
            body.innerHTML = `<div class="p-6 text-center notif-empty">${emptyMsg}</div>`;
            return;
        }

        const E = (s) => Utils.escapeHtml(s == null ? '' : String(s));
        const groups = new Map();
        for (const n of items) {
            const bucket = this._bucketFor(n.created_at);
            if (!groups.has(bucket)) groups.set(bucket, []);
            groups.get(bucket).push(n);
        }

        const html = Array.from(groups.entries()).map(([label, rows]) => {
            const renderedRows = rows.map((n) => {
                const meta = this._typeMeta(n.type);
                const time = new Date(n.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                const preview = String(n.message || '').slice(0, 160);
                const more = (n.message && n.message.length > 160) ? '…' : '';
                return `
                    <div class="notif-row ${n.is_read ? '' : 'unread'}" data-on-click="Notifications.openNotification('${n.id}')">
                        <div class="notif-row-icon-wrap" data-style="color:${meta.color};">
                            <span class="material-icons-outlined">${meta.icon}</span>
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="notif-row-msg">${E(preview)}${more}</div>
                            <div class="notif-row-meta mt-1 flex items-center gap-2">
                                <span class="notif-type-pill" data-style="color:${meta.color};">${E(meta.label)}</span>
                                <span>${time}</span>
                                ${n.is_read ? '' : '<span class="text-blue-600">●</span>'}
                            </div>
                        </div>
                        <div class="flex-shrink-0 notif-row-chevron self-center">
                            <span class="material-icons-outlined" data-style="font-size:18px;">chevron_right</span>
                        </div>
                    </div>`;
            }).join('');
            return `
                <div>
                    <div class="notif-day-header">${E(label)}</div>
                    <div class="notif-divider">${renderedRows}</div>
                </div>`;
        }).join('');
        body.innerHTML = html;
    },

    /** Open the detail modal for one notification and auto-mark it
     *  as read so opening counts as "read". */
    async openNotification(id) {
        const item = this._state.items.find((n) => String(n.id) === String(id));
        if (!item) return;
        this._state.openId = id;
        const meta = this._typeMeta(item.type);

        const iconEl  = document.getElementById('notif-detail-icon');
        const titleEl = document.getElementById('notif-detail-title');
        const metaEl  = document.getElementById('notif-detail-meta');
        const msgEl   = document.getElementById('notif-detail-message');
        const relEl   = document.getElementById('notif-detail-related');
        if (!iconEl || !titleEl || !msgEl) return;

        iconEl.textContent = meta.icon;
        iconEl.style.color = meta.color;
        titleEl.textContent = meta.label;
        metaEl.innerHTML = `
            <span class="notif-type-pill mr-2" data-style="color:${meta.color};">${Utils.escapeHtml(meta.label)}</span>
            <span>${new Date(item.created_at).toLocaleString()}</span>
            ${item.is_read ? '<span class="ml-2" data-style="color:var(--text-muted);">· read</span>' : '<span class="ml-2 text-blue-600">· unread</span>'}
        `;
        msgEl.textContent = item.message || '(No message body)';
        relEl.innerHTML = item.related_id
            ? `<div class="text-xs notif-detail-related">Related ID: <code data-style="color:var(--text-primary);">${Utils.escapeHtml(String(item.related_id))}</code></div>`
            : '';

        Utils.openModal('notif-detail-modal');

        // Auto-mark-read on open. We update local state and badge
        // immediately for snappy UX; if the PUT fails we silently log
        // and the next refresh will reconcile.
        if (!item.is_read) {
            item.is_read = true;
            this._renderList();
            try {
                await API.put(`/notifications/${id}/read`);
                if (window.App && typeof App.checkNotifications === 'function') {
                    App.checkNotifications();
                }
            } catch (err) {
                console.warn('openNotification: mark-read failed', err);
            }
        }
    },

    _modalBackdrop(ev) {
        // Close when the user clicks the dimmed backdrop (target is the
        // overlay itself, not its inner modal). The inner modal stops
        // propagation via the data-stop-propagation attribute.
        if (ev && ev.target && ev.target.id === 'notif-detail-modal') {
            this.closeDetail();
        }
    },

    closeDetail() {
        Utils.closeModal('notif-detail-modal');
        this._state.openId = null;
    },

    async markAllRead() {
        try {
            await API.put('/notifications/read-all');
            await this.refresh();
            Utils.toast('All notifications marked as read', 'success');
        } catch (err) {
            console.error('Notifications.markAllRead failed', err);
            Utils.toast('Could not mark all as read.', 'error');
        }
    },

    /** Kept for backwards compat — older code paths may call this. */
    async markRead(id) {
        try {
            await API.put(`/notifications/${id}/read`);
            await this.refresh();
        } catch (err) {
            console.error('Notifications.markRead failed', err);
        }
    },
};

window.Notifications = Notifications;
