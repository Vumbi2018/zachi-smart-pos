/**
 * Audit Trail page (v1.0.16) — humanised view of `audit_logs`.
 *
 * Each backend row carries an action code (CREATE / UPDATE / VOID / …)
 * and a table_name (sales / users / …). The previous UI dumped both
 * raw plus a JSON pre-block, which non-technical operators struggled
 * to read. This module:
 *
 *   1. Translates (action × table_name) into a single sentence:
 *        "Lawrence Mukombo updated a customer at 14:23"
 *   2. Colour-codes the action badge (created=green, deleted=red, …).
 *   3. Lets the operator click any row to expand a structured
 *      key/value view of the captured payload — sensitive keys are
 *      already redacted by middleware/audit.js.
 *   4. Adds quick "Today / Yesterday / Last 7 days" date chips so the
 *      Director can triage without typing dates.
 *
 * Backend stays unchanged — we just re-render what `/api/audit`
 * already returns.
 */
const Audit = {
    _logs: [],
    _expanded: new Set(),
    _quickDate: '',   // '' | 'today' | 'yesterday' | 'week'

    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Audit Trail</h1>
                    <p class="text-secondary">Every important action is recorded here. Click any row to see the full details.</p>
                </div>
            </div>

            <div class="card p-4 mb-4">
                <div class="flex flex-wrap items-end gap-3">
                    <div class="form-group mb-0 flex-1 min-w-[180px]">
                        <label class="text-xs text-white/60">Person</label>
                        <select id="filter-user" class="form-select">
                            <option value="">Anyone</option>
                        </select>
                    </div>
                    <div class="form-group mb-0 flex-1 min-w-[160px]">
                        <label class="text-xs text-white/60">Action</label>
                        <select id="filter-action" class="form-select">
                            <option value="">Any action</option>
                            <option value="CREATE">Created</option>
                            <option value="UPDATE">Updated</option>
                            <option value="DELETE">Deleted</option>
                            <option value="VOID">Voided</option>
                            <option value="LOGIN">Logged in</option>
                            <option value="LOGOUT">Logged out</option>
                            <option value="APPROVE">Approved</option>
                            <option value="REJECT">Rejected</option>
                        </select>
                    </div>
                    <div class="form-group mb-0">
                        <label class="text-xs text-white/60">From date</label>
                        <input type="date" id="filter-date" class="form-input">
                    </div>
                    <div class="form-group mb-0 flex gap-2">
                        <button type="button" class="btn btn-primary" data-on-click="Audit.applyFilters()">Apply</button>
                        <button type="button" class="btn btn-secondary" data-on-click="Audit.clearFilters()">Clear</button>
                    </div>
                </div>
                <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-white/5" id="audit-quick-chips">
                    <span class="text-xs text-white/50 self-center mr-1">Quick range:</span>
                    <button type="button" class="audit-chip" data-on-click="Audit.setQuickDate('today')"      data-chip="today">Today</button>
                    <button type="button" class="audit-chip" data-on-click="Audit.setQuickDate('yesterday')"  data-chip="yesterday">Yesterday</button>
                    <button type="button" class="audit-chip" data-on-click="Audit.setQuickDate('week')"       data-chip="week">Last 7 days</button>
                    <button type="button" class="audit-chip" data-on-click="Audit.setQuickDate('')"           data-chip="">All time</button>
                </div>
            </div>

            <div class="card overflow-hidden">
                <div id="audit-list" class="divide-y divide-white/5">
                    <div class="p-8 text-center text-white/60">Loading activity…</div>
                </div>
            </div>

            <style>
                .audit-chip {
                    background: rgba(255,255,255,0.05);
                    color: rgba(255,255,255,0.75);
                    border: 1px solid rgba(255,255,255,0.10);
                    border-radius: 999px;
                    padding: 0.25rem 0.75rem;
                    font-size: 0.75rem;
                    cursor: pointer;
                    transition: all 0.15s;
                }
                .audit-chip:hover { background: rgba(255,255,255,0.10); color: #fff; }
                .audit-chip.active {
                    background: var(--color-primary, #3b82f6);
                    color: #fff;
                    border-color: var(--color-primary, #3b82f6);
                }
                .audit-row { cursor: pointer; transition: background 0.12s; }
                .audit-row:hover { background: rgba(255,255,255,0.04); }
                .audit-row.expanded { background: rgba(255,255,255,0.04); }
                .audit-action-badge {
                    display: inline-block;
                    padding: 0.15rem 0.6rem;
                    border-radius: 4px;
                    font-size: 0.7rem;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                }
                .audit-detail-grid { display: grid; grid-template-columns: max-content 1fr; gap: 0.35rem 1rem; font-size: 0.85rem; }
                .audit-detail-key   { color: rgba(255,255,255,0.55); white-space: nowrap; font-family: ui-monospace, monospace; }
                .audit-detail-val   { color: rgba(255,255,255,0.95); word-break: break-all; }
            </style>
        `;

        this.loadUsers();
        this.loadLogs();
    },

    async loadUsers() {
        try {
            const users = await API.get('/users');
            const select = document.getElementById('filter-user');
            if (!select) return;
            users.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.user_id;
                opt.textContent = u.full_name || u.username;
                select.appendChild(opt);
            });
        } catch (e) {
            console.warn('Audit: failed to load users for filter', e);
        }
    },

    setQuickDate(range) {
        this._quickDate = range;
        document.querySelectorAll('#audit-quick-chips [data-chip]').forEach((b) => {
            b.classList.toggle('active', b.dataset.chip === range);
        });
        // Translate the chip into a from-date input value.
        const dateInput = document.getElementById('filter-date');
        if (range === 'today') {
            dateInput.value = new Date().toISOString().slice(0, 10);
        } else if (range === 'yesterday') {
            const d = new Date(); d.setDate(d.getDate() - 1);
            dateInput.value = d.toISOString().slice(0, 10);
        } else if (range === 'week') {
            const d = new Date(); d.setDate(d.getDate() - 7);
            dateInput.value = d.toISOString().slice(0, 10);
        } else {
            dateInput.value = '';
        }
        this.loadLogs();
    },

    applyFilters() { this.loadLogs(); },

    clearFilters() {
        document.getElementById('filter-user').value = '';
        document.getElementById('filter-action').value = '';
        document.getElementById('filter-date').value = '';
        this._quickDate = '';
        document.querySelectorAll('#audit-quick-chips [data-chip]').forEach((b) => b.classList.remove('active'));
        this.loadLogs();
    },

    async loadLogs() {
        const user   = document.getElementById('filter-user')?.value || '';
        const action = document.getElementById('filter-action')?.value || '';
        const date   = document.getElementById('filter-date')?.value || '';

        const params = new URLSearchParams();
        if (user)   params.append('user_id', user);
        if (action) params.append('action', action);
        if (date)   params.append('start_date', date);
        params.append('limit', '200');

        const list = document.getElementById('audit-list');
        if (list) list.innerHTML = '<div class="p-8 text-center text-white/60">Loading activity…</div>';

        try {
            const logs = await API.get(`/audit?${params.toString()}`);
            this._logs = Array.isArray(logs) ? logs : [];
            this.renderLogs();
        } catch (err) {
            console.error(err);
            Utils.toast('Failed to load audit logs', 'error');
            if (list) list.innerHTML = '<div class="p-8 text-center text-red-400">Could not load activity.</div>';
        }
    },

    /* ── Verb / noun dictionaries ─────────────────────────────────
       Anything not listed falls back to a sensible default so new
       audit codes don't break the page. */
    _ACTION_VERBS: {
        CREATE: 'created', INSERT: 'created',
        UPDATE: 'updated', EDIT: 'updated', PATCH: 'updated',
        DELETE: 'deleted', REMOVE: 'deleted',
        VOID:   'voided',  CANCEL: 'voided',
        LOGIN:  'logged in',
        LOGOUT: 'logged out',
        LOGIN_FAILED: 'failed to log in',
        APPROVE: 'approved',
        REJECT:  'rejected',
        REFUND:  'refunded',
        PRINT:   'printed',
        EXPORT:  'exported',
        IMPORT:  'imported',
        SYNC:    'synced',
        VIEW:    'viewed', READ: 'viewed',
        PERMISSION_CHANGE: 'changed permissions for',
    },
    _TABLE_NOUNS: {
        sales: 'a sale', sale_items: 'sale items',
        products: 'a product',
        users: 'a user account',
        customers: 'a customer',
        quotes: 'a quote', quote_items: 'quote items',
        invoices: 'an invoice', invoice_items: 'invoice items',
        payments: 'a payment',
        jobs: 'a job card', job_cards: 'a job card',
        suppliers: 'a supplier',
        purchases: 'a purchase order', purchase_orders: 'a purchase order',
        stock_receiving: 'stock receiving',
        returns: 'a return',
        inventory: 'inventory',
        system_settings: 'system settings',
        permissions: 'a permission',
        role_permissions: 'role permissions',
        user_permissions: 'user permissions',
        notifications: 'a notification',
        cash_drawer: 'the cash drawer',
        cash_movements: 'a cash movement',
        services: 'a service',
        promotions: 'a promotion',
        loyalty: 'loyalty',
        approvals: 'an approval',
        backlog_sales: 'a backlog sale',
        credit_orders: 'a credit order',
    },
    _COLOR_BY_VERB: {
        'created':              { bg: '#16a34a22', fg: '#22c55e' },
        'updated':              { bg: '#2563eb22', fg: '#60a5fa' },
        'deleted':              { bg: '#dc262622', fg: '#f87171' },
        'voided':               { bg: '#dc262622', fg: '#f87171' },
        'logged in':            { bg: '#0ea5e922', fg: '#7dd3fc' },
        'logged out':           { bg: '#64748b22', fg: '#94a3b8' },
        'failed to log in':     { bg: '#f59e0b22', fg: '#fbbf24' },
        'approved':             { bg: '#16a34a22', fg: '#22c55e' },
        'rejected':             { bg: '#dc262622', fg: '#f87171' },
        'refunded':             { bg: '#f59e0b22', fg: '#fbbf24' },
        'changed permissions for': { bg: '#a855f722', fg: '#c084fc' },
    },

    _humanize(log) {
        const action  = String(log.action || '').toUpperCase();
        const verb    = this._ACTION_VERBS[action] || action.toLowerCase().replace(/_/g, ' ');
        const tableKey = String(log.table_name || '').toLowerCase();
        const noun    = this._TABLE_NOUNS[tableKey] || (tableKey ? `a ${tableKey.replace(/_/g, ' ').replace(/s$/, '')}` : '');
        const color   = this._COLOR_BY_VERB[verb] || { bg: '#64748b22', fg: '#94a3b8' };
        const actor   = log.full_name || log.username || 'System';
        return { actor, verb, noun, color };
    },

    /** Pretty-prints a parsed payload as a key→value list. Skips
     *  internal/noisy keys and renders nested objects compactly. */
    _renderPayload(json) {
        if (json == null) return '<span class="text-white/50">No additional details.</span>';
        if (typeof json !== 'object') return `<span class="audit-detail-val">${Utils.escapeHtml(String(json))}</span>`;

        const HIDE = new Set(['user_id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'tenant_id']);
        const rows = [];
        for (const [k, v] of Object.entries(json)) {
            if (HIDE.has(k)) continue;
            let display;
            if (v == null) display = '<span class="text-white/40">empty</span>';
            else if (typeof v === 'object') display = `<code class="text-xs">${Utils.escapeHtml(JSON.stringify(v))}</code>`;
            else if (typeof v === 'boolean') display = v ? '<span class="text-green-400">yes</span>' : '<span class="text-red-400">no</span>';
            else display = Utils.escapeHtml(String(v));
            rows.push(`<div class="audit-detail-key">${Utils.escapeHtml(k.replace(/_/g, ' '))}</div><div class="audit-detail-val">${display}</div>`);
        }
        if (!rows.length) return '<span class="text-white/50">No additional details.</span>';
        return `<div class="audit-detail-grid">${rows.join('')}</div>`;
    },

    renderLogs() {
        const list = document.getElementById('audit-list');
        if (!list) return;

        const logs = this._logs;
        if (!logs.length) {
            list.innerHTML = '<div class="p-8 text-center text-white/60">No activity matches these filters.</div>';
            return;
        }

        // Group rows by date label (Today / Yesterday / Mon, 12 May).
        const groups = new Map();
        const todayKey = new Date().toDateString();
        const yKey = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toDateString(); })();
        for (const log of logs) {
            const d = new Date(log.created_at);
            const key = d.toDateString();
            const label = key === todayKey ? 'Today'
                : key === yKey ? 'Yesterday'
                : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
            if (!groups.has(label)) groups.set(label, []);
            groups.get(label).push(log);
        }

        const html = Array.from(groups.entries()).map(([label, rows]) => {
            const inner = rows.map((log) => this._renderRow(log)).join('');
            return `
                <div>
                    <div class="px-4 py-2 text-xs uppercase tracking-wider text-white/50 bg-white/5">${Utils.escapeHtml(label)}</div>
                    ${inner}
                </div>`;
        }).join('');
        list.innerHTML = html;
    },

    _renderRow(log) {
        const { actor, verb, noun, color } = this._humanize(log);
        const time = new Date(log.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        const expanded = this._expanded.has(log.log_id);
        let parsedNew = null, parsedOld = null;
        try { parsedNew = log.new_value ? JSON.parse(log.new_value) : null; } catch (_) { parsedNew = log.new_value; }
        try { parsedOld = log.old_value ? JSON.parse(log.old_value) : null; } catch (_) { parsedOld = log.old_value; }

        // 1-line summary: take a couple of "interesting" fields from the payload to give context.
        let summary = '';
        if (parsedNew && typeof parsedNew === 'object') {
            const candidates = ['name', 'full_name', 'username', 'product_name', 'customer_name', 'amount', 'total', 'reason', 'note', 'description', 'email', 'phone'];
            for (const k of candidates) {
                if (parsedNew[k] != null && String(parsedNew[k]).length > 0 && String(parsedNew[k]).length < 80) {
                    summary = `<span class="text-white/60 text-xs ml-2">"${Utils.escapeHtml(String(parsedNew[k]))}"</span>`;
                    break;
                }
            }
        }

        const recordBit = log.record_id
            ? `<span class="text-white/40 text-xs ml-2">#${String(log.record_id).slice(0, 8)}</span>`
            : '';

        const detailBlock = expanded ? `
            <div class="px-4 pb-4 pt-1 bg-black/20">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    ${parsedOld ? `
                        <div>
                            <div class="text-xs uppercase tracking-wider text-white/50 mb-1">Before</div>
                            ${this._renderPayload(parsedOld)}
                        </div>` : ''}
                    ${parsedNew ? `
                        <div>
                            <div class="text-xs uppercase tracking-wider text-white/50 mb-1">${parsedOld ? 'After' : 'Details'}</div>
                            ${this._renderPayload(parsedNew)}
                        </div>` : ''}
                </div>
                <div class="mt-3 pt-3 border-t border-white/5 text-xs text-white/40 flex flex-wrap gap-x-4 gap-y-1">
                    <span><b>When:</b> ${new Date(log.created_at).toLocaleString()}</span>
                    ${log.ip_address ? `<span><b>IP:</b> ${Utils.escapeHtml(log.ip_address)}</span>` : ''}
                    ${log.device_id ? `<span><b>Device:</b> ${String(log.device_id).slice(0, 8)}…</span>` : ''}
                    <span><b>Log ID:</b> ${String(log.log_id).slice(0, 8)}…</span>
                </div>
                <details class="mt-2">
                    <summary class="text-xs text-white/40 cursor-pointer hover:text-white/60">Show raw JSON</summary>
                    <pre class="text-xs bg-black/40 p-2 rounded mt-1 overflow-x-auto" data-style="max-height:200px;">${Utils.escapeHtml(JSON.stringify({ old_value: parsedOld, new_value: parsedNew }, null, 2))}</pre>
                </details>
            </div>` : '';

        return `
            <div class="audit-row ${expanded ? 'expanded' : ''}" data-on-click="Audit.toggleRow('${log.log_id}')">
                <div class="px-4 py-3 flex items-start gap-3">
                    <div class="flex-shrink-0 text-white/40 text-xs w-12 mt-0.5">${time}</div>
                    <div class="flex-shrink-0">
                        <span class="audit-action-badge" data-style="background:${color.bg};color:${color.fg};">${Utils.escapeHtml(verb)}</span>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="text-sm">
                            <span class="font-semibold text-white">${Utils.escapeHtml(actor)}</span>
                            <span class="text-white/70"> ${Utils.escapeHtml(verb)} </span>
                            <span class="text-white">${Utils.escapeHtml(noun || 'something')}</span>
                            ${recordBit}${summary}
                        </div>
                    </div>
                    <div class="flex-shrink-0 text-white/30">
                        <span class="material-icons-outlined" data-style="font-size:18px;transform:rotate(${expanded ? '180' : '0'}deg);transition:transform 0.15s;">expand_more</span>
                    </div>
                </div>
                ${detailBlock}
            </div>
        `;
    },

    toggleRow(logId) {
        if (this._expanded.has(logId)) this._expanded.delete(logId);
        else this._expanded.add(logId);
        this.renderLogs();
    },
};

// Expose to global scope for delegated event handlers (data-on-* attributes).
window.Audit = Audit;
