/**
 * Zachi Smart-POS — AI Inventory Alerts Panel
 * Renders urgency-scored low-stock alerts driven by sales velocity analytics.
 * Supports Card view and Table view (toggle).
 */
const InventoryAlerts = {
    _view: 'cards', // 'cards' | 'table'
    _data: null,

    async render(container) {
        this._view = this._view || 'cards';
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">🤖 AI Stock Alerts</h1>
                    <p class="text-secondary" data-style="margin-top:0.2rem;">Powered by 30-day sales velocity analysis. Sorted by urgency.</p>
                </div>
                <div class="flex gap-2 items-center">
                    <!-- View Toggle -->
                    <div data-style="display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden;">
                        <button id="view-cards-btn" data-on-click="InventoryAlerts._switchView('cards')"
                            data-style="padding:0.4rem 0.8rem;font-size:0.8rem;border:none;cursor:pointer;transition:background 0.15s;
                                   background:${this._view === 'cards' ? 'var(--primary)' : 'var(--bg-card)'};
                                   color:${this._view === 'cards' ? '#fff' : 'var(--text-primary)'};">
                            ⊞ Cards
                        </button>
                        <button id="view-table-btn" data-on-click="InventoryAlerts._switchView('table')"
                            data-style="padding:0.4rem 0.8rem;font-size:0.8rem;border:none;cursor:pointer;transition:background 0.15s;
                                   background:${this._view === 'table' ? 'var(--primary)' : 'var(--bg-card)'};
                                   color:${this._view === 'table' ? '#fff' : 'var(--text-primary)'};">
                            ☰ Table
                        </button>
                    </div>
                    <button class="btn btn-secondary" data-on-click="InventoryAlerts.backToInventory()">← Back to Inventory</button>
                    <button class="btn btn-primary" data-on-click="InventoryAlerts.refresh()">🔄 Refresh</button>
                </div>
            </div>

            <div id="alerts-summary-bar" class="stats-grid mb-4" data-style="grid-template-columns:repeat(4,1fr);">
                <div class="stat-card text-center"><div class="spinner" data-style="margin:auto;"></div></div>
                <div class="stat-card"></div><div class="stat-card"></div><div class="stat-card"></div>
            </div>

            <div id="alerts-list">
                <div class="text-center p-12">
                    <div class="spinner" data-style="margin:auto;margin-bottom:1rem;"></div>
                    <p class="text-secondary">Running AI analysis...</p>
                </div>
            </div>
        `;

        try {
            // Always fetch the flagged alerts for the summary bar
            const alertsData = await API.get('/ai/stock-alerts');
            this._data = alertsData;
            this._renderSummary(alertsData.summary);

            if (this._view === 'table') {
                // Table mode: load ALL products with velocity scoring
                const analysisData = await API.get('/ai/stock-analysis');
                this._allProducts = analysisData.products;
                this._renderAlertsTable(this._allProducts);
            } else {
                this._renderAlerts(alertsData.alerts);
            }
        } catch (err) {
            document.getElementById('alerts-list').innerHTML =
                `<div class="card text-center p-8 text-danger">⚠️ Failed to load alerts: ${err.message}</div>`;
        }
    },

    _switchView(mode) {
        this._view = mode;
        const cardBtn = document.getElementById('view-cards-btn');
        const tableBtn = document.getElementById('view-table-btn');
        if (cardBtn) { cardBtn.style.background = mode === 'cards' ? 'var(--primary)' : 'var(--bg-card)'; cardBtn.style.color = mode === 'cards' ? '#fff' : 'var(--text-primary)'; }
        if (tableBtn) { tableBtn.style.background = mode === 'table' ? 'var(--primary)' : 'var(--bg-card)'; tableBtn.style.color = mode === 'table' ? '#fff' : 'var(--text-primary)'; }

        if (mode === 'table') {
            // Load all products if not already loaded
            if (this._allProducts) {
                this._renderAlertsTable(this._allProducts);
            } else {
                document.getElementById('alerts-list').innerHTML = '<div class="text-center p-8"><div class="spinner" data-style="margin:auto;"></div></div>';
                API.get('/ai/stock-analysis').then(d => {
                    this._allProducts = d.products;
                    this._renderAlertsTable(d.products);
                }).catch(e => {
                    document.getElementById('alerts-list').innerHTML = `<div class="card text-center p-4 text-danger">⚠️ ${e.message}</div>`;
                });
            }
        } else {
            this._renderAlerts(this._data ? this._data.alerts : []);
        }
    },

    _renderContent(alerts) {
        if (this._view === 'table') {
            this._renderAlertsTable(this._allProducts || alerts);
        } else {
            this._renderAlerts(alerts);
        }
    },

    _renderSummary(s) {
        document.getElementById('alerts-summary-bar').innerHTML = `
            <div class="stat-card" data-style="border-left:4px solid #ef4444;">
                <div class="stat-icon" data-style="background:#fee2e2;color:#ef4444;font-size:1.4rem;">🔴</div>
                <div class="card-title">Critical</div>
                <div class="card-value" data-style="color:#ef4444;">${s.critical}</div>
                <div class="card-subtitle">Stock out in &lt;3 days</div>
            </div>
            <div class="stat-card" data-style="border-left:4px solid #f97316;">
                <div class="stat-icon" data-style="background:#ffedd5;color:#f97316;font-size:1.4rem;">🟠</div>
                <div class="card-title">High</div>
                <div class="card-value" data-style="color:#f97316;">${s.high}</div>
                <div class="card-subtitle">Stock out in 3–7 days</div>
            </div>
            <div class="stat-card" data-style="border-left:4px solid #eab308;">
                <div class="stat-icon" data-style="background:#fef9c3;color:#ca8a04;font-size:1.4rem;">🟡</div>
                <div class="card-title">Medium</div>
                <div class="card-value" data-style="color:#ca8a04;">${s.medium}</div>
                <div class="card-subtitle">Approaching threshold</div>
            </div>
            <div class="stat-card" data-style="border-left:4px solid #3b82f6;">
                <div class="stat-icon" data-style="background:#dbeafe;color:#2563eb;font-size:1.4rem;">📦</div>
                <div class="card-title">Total Flagged</div>
                <div class="card-value" data-style="color:#2563eb;">${s.total}</div>
                <div class="card-subtitle">Products need attention</div>
            </div>
        `;
    },

    // ── TABLE VIEW ────────────────────────────────────────────────────────────

    _renderAlertsTable(products) {
        const list = document.getElementById('alerts-list');
        if (!products || !products.length) {
            list.innerHTML = `<div class="card text-center p-8"><p class="text-secondary">No products found.</p></div>`;
            return;
        }

        const urgencyColor = { CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#ca8a04', OK: '#16a34a' };
        const urgencyBg = { CRITICAL: '#fef2f2', HIGH: '#fff7ed', MEDIUM: '#fefce8', OK: '#f0fdf4' };
        const urgencyIcon = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', OK: '✅' };

        const filterMode = this._tableFilter || 'all';
        const filtered = filterMode === 'flagged'
            ? products.filter(p => p.urgency !== 'OK')
            : products;

        list.innerHTML = `
            <div class="card" data-style="overflow:auto;">
                <div data-style="padding:0.75rem 1rem;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:0.5rem;">
                    <div data-style="display:flex;gap:0.5rem;">
                        <button class="btn btn-xs ${filterMode === 'all' ? 'btn-primary' : 'btn-outline'}" data-on-click="InventoryAlerts._setTableFilter('all')">All (${products.length})</button>
                        <button class="btn btn-xs ${filterMode === 'flagged' ? 'btn-primary' : 'btn-outline'}" data-on-click="InventoryAlerts._setTableFilter('flagged')">🚨 Flagged (${products.filter(p => p.urgency !== 'OK').length})</button>
                    </div>
                    <button class="btn btn-xs btn-outline" data-on-click="InventoryAlerts._exportTableCsv()">⬇️ Export CSV</button>
                </div>
                <table class="table w-full" data-style="font-size:0.82rem;">
                    <thead>
                        <tr>
                            <th>Status</th>
                            <th>Product</th>
                            <th>Category</th>
                            <th>SKU</th>
                            <th class="text-right">In Stock</th>
                            <th class="text-right">Reorder At</th>
                            <th class="text-right">Vel. (u/day)</th>
                            <th class="text-right">Days Left</th>
                            <th class="text-right">Order Qty</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filtered.map(a => {
            const col = urgencyColor[a.urgency] || '#6b7280';
            const bg = urgencyBg[a.urgency] || '#f9fafb';
            const ico = urgencyIcon[a.urgency] || '—';
            const daysText = a.days_left === null ? '—' : `${a.days_left}d`;
            const borderStyle = a.urgency !== 'OK' ? `border-left:3px solid ${col};` : '';
            return `
                            <tr data-style="${borderStyle}">
                                <td><span data-style="font-size:0.7rem;font-weight:700;padding:0.18rem 0.45rem;border-radius:999px;background:${bg};color:${col};white-space:nowrap;">${ico} ${a.urgency}</span></td>
                                <td data-style="font-weight:600;">${a.name}</td>
                                <td class="text-secondary">${a.category}</td>
                                <td class="text-secondary" data-style="font-size:0.72rem;">${a.sku}</td>
                                <td class="text-right font-bold" data-style="color:${a.urgency !== 'OK' ? col : 'inherit'};">${a.stock_quantity}</td>
                                <td class="text-right text-secondary">${a.reorder_level}</td>
                                <td class="text-right">${a.avg_daily_qty > 0 ? a.avg_daily_qty : '<span class="text-secondary">—</span>'}</td>
                                <td class="text-right" data-style="color:${a.urgency !== 'OK' ? col : '#16a34a'}; font-weight:600;">${daysText}</td>
                                <td class="text-right" data-style="color:${a.suggested_order > 0 ? '#2563eb' : '#94a3b8'};font-weight:600;">${a.suggested_order || '—'}</td>
                                <td>
                                    <button class="btn btn-xs btn-outline" title="Adjust Stock"
                                        data-on-click="InventoryAlerts.gotoAdjust(${a.product_id})">📦</button>
                                </td>
                            </tr>`;
        }).join('')}
                    </tbody>
                </table>
            </div>`;
    },

    _setTableFilter(mode) {
        this._tableFilter = mode;
        this._renderAlertsTable(this._allProducts || (this._data ? this._data.alerts : []));
    },

    _exportTableCsv() {
        const source = this._allProducts || (this._data && this._data.alerts) || [];
        if (!source.length) return;
        const headers = ['Status', 'Product', 'Category', 'SKU', 'In Stock', 'Reorder At', 'Velocity (u/day)', 'Days Left', 'Suggested Order'];
        const rows = source.map(a => [
            a.urgency, a.name, a.category, a.sku,
            a.stock_quantity, a.reorder_level,
            a.avg_daily_qty || 0,
            a.days_left !== null ? a.days_left : '',
            a.suggested_order || 0
        ]);
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const el = document.createElement('a');
        el.href = url; el.download = `stock_analysis_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(el); el.click(); el.remove();
        URL.revokeObjectURL(url);
        Utils.toast('CSV exported', 'success');
    },


    // ── CARD VIEW ─────────────────────────────────────────────────────────────

    _renderAlerts(alerts) {
        const list = document.getElementById('alerts-list');

        if (!alerts.length) {
            list.innerHTML = `
                <div class="card text-center p-12">
                    <div data-style="font-size:3rem;margin-bottom:0.75rem;">✅</div>
                    <h3 data-style="color:var(--success);">All Clear!</h3>
                    <p class="text-secondary">No stock alerts at this time. Your inventory looks healthy.</p>
                </div>`;
            return;
        }

        const groups = { CRITICAL: [], HIGH: [], MEDIUM: [] };
        alerts.forEach(a => groups[a.urgency].push(a));

        const urgencyConfig = {
            CRITICAL: { label: '🔴 CRITICAL', color: '#ef4444', bg: '#fff5f5', border: '#fecaca' },
            HIGH: { label: '🟠 HIGH', color: '#f97316', bg: '#fff7ed', border: '#fed7aa' },
            MEDIUM: { label: '🟡 MEDIUM', color: '#ca8a04', bg: '#fefce8', border: '#fde68a' }
        };

        let html = '';
        ['CRITICAL', 'HIGH', 'MEDIUM'].forEach(level => {
            if (!groups[level].length) return;
            const cfg = urgencyConfig[level];
            html += `
                <div class="mb-6">
                    <h3 data-style="font-size:0.95rem;font-weight:700;color:${cfg.color};letter-spacing:0.05em;margin-bottom:0.5rem;padding:0.4rem 0.75rem;background:${cfg.bg};border-radius:6px;border:1px solid ${cfg.border};display:inline-block;">
                        ${cfg.label} &mdash; ${groups[level].length} item${groups[level].length !== 1 ? 's' : ''}
                    </h3>
                    <div data-style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:1rem;">
                        ${groups[level].map(a => this._alertCard(a, cfg)).join('')}
                    </div>
                </div>`;
        });

        list.innerHTML = html;
    },

    _alertCard(a, cfg) {
        const daysText = a.days_left === null
            ? '<span data-style="color:#94a3b8;">No recent sales</span>'
            : `<span data-style="font-weight:700;color:${cfg.color};">${a.days_left} days</span> remaining`;

        const velocityText = a.avg_daily_qty > 0
            ? `${a.avg_daily_qty} units/day &nbsp;·&nbsp; ${a.total_sold_30d} sold in 30 days`
            : `<span data-style="color:#94a3b8;">No sales in last 30 days</span>`;

        const pct = a.reorder_level > 0 ? Math.min(100, Math.round((a.stock_quantity / (a.reorder_level * 3)) * 100)) : 0;
        const barColor = a.urgency === 'CRITICAL' ? '#ef4444' : a.urgency === 'HIGH' ? '#f97316' : '#eab308';
        const stockBar = `
            <div data-style="background:#f1f5f9;border-radius:4px;height:6px;margin:0.4rem 0;">
                <div data-style="width:${pct}%;height:6px;background:${barColor};border-radius:4px;"></div>
            </div>
            <div data-style="display:flex;justify-content:space-between;font-size:0.72rem;color:#94a3b8;">
                <span>0</span><span>Reorder (${a.reorder_level})</span><span>3× Reorder</span>
            </div>`;

        return `
            <div class="card" data-style="border-left:3px solid ${cfg.color};padding:1rem 1.2rem;">
                <div data-style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.6rem;">
                    <div>
                        <div data-style="font-weight:700;font-size:0.95rem;">${a.name}</div>
                        <div data-style="font-size:0.75rem;color:var(--text-muted);">${a.category} &nbsp;·&nbsp; SKU: ${a.sku}</div>
                    </div>
                    <span data-style="font-size:0.72rem;font-weight:700;padding:0.2rem 0.5rem;border-radius:999px;background:${cfg.bg};color:${cfg.color};border:1px solid ${cfg.border};white-space:nowrap;">
                        ${a.urgency}
                    </span>
                </div>
                <div data-style="margin-bottom:0.75rem;">
                    <div data-style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:0.2rem;">
                        <span>Current: <strong>${a.stock_quantity}</strong></span>
                        <span data-style="color:#94a3b8;">Reorder at: ${a.reorder_level}</span>
                    </div>
                    ${stockBar}
                </div>
                <div data-style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.75rem;font-size:0.8rem;">
                    <div data-style="background:#f8fafc;border-radius:6px;padding:0.4rem 0.6rem;">
                        <div data-style="color:#94a3b8;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;">Days Left</div>
                        <div>${daysText}</div>
                    </div>
                    <div data-style="background:#f8fafc;border-radius:6px;padding:0.4rem 0.6rem;">
                        <div data-style="color:#94a3b8;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;">Velocity</div>
                        <div>${velocityText}</div>
                    </div>
                </div>
                <div data-style="background:${cfg.bg};border:1px solid ${cfg.border};border-radius:6px;padding:0.6rem 0.8rem;margin-bottom:0.75rem;font-size:0.8rem;color:#374151;line-height:1.5;">
                    <span data-style="font-weight:700;color:${cfg.color};">💡 AI Recommendation:</span><br>
                    ${a.recommendation}
                </div>
                <div data-style="display:flex;gap:0.5rem;align-items:center;">
                    <span data-style="font-size:0.78rem;color:#64748b;">Suggested order: <strong data-style="color:${cfg.color};">${a.suggested_order} units</strong></span>
                    <button class="btn btn-xs btn-primary ml-auto"
                        data-on-click="InventoryAlerts.gotoAdjust(${a.product_id})">
                        📦 Adjust Stock
                    </button>
                </div>
            </div>`;
    },

    /** Navigate to Inventory page, then open the adjust-stock modal once it has rendered. */
    gotoAdjust(productId) {
        App.navigate('inventory');
        setTimeout(() => {
            try { Inventory.openAdjustModal(productId); } catch (e) { /* page not ready */ }
        }, 600);
    },

    /** Re-render the Inventory page in the main page container. */
    backToInventory() {
        Inventory.render(document.getElementById('page-container'));
    },

    /** Re-render this alerts page in the main page container. */
    refresh() {
        InventoryAlerts.render(document.getElementById('page-container'));
    }
};

// Expose to global scope for delegated event handlers (data-on-* attributes).
window.InventoryAlerts = InventoryAlerts;
