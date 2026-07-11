const DailySales = {
    filterState: {
        range: 'today',
        start: new Date().toLocaleDateString('en-CA'),
        end: new Date().toLocaleDateString('en-CA'),
        payment_method: '',
        label: 'Today'
    },

    init() {
        this.render();
    },

    async render(container) {
        if (!container) {
            container = document.getElementById('main-content') || document.getElementById('page-container');
        }

        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Sales Report</h1>
                    <p class="text-secondary" id="sales-date-label">Today</p>
                </div>
                <div class="header-actions">
                    <div class="flex items-center">
                        <select id="sales-range-select" class="form-select text-sm mr-2" data-on-change="DailySales.handleRangeChange($value)" data-style="width:140px;">
                            <option value="today">Today</option>
                            <option value="yesterday">Yesterday</option>
                            <option value="7days">Last 7 Days</option>
                            <option value="30days">Last 30 Days</option>
                            <option value="this_month">This Month</option>
                            <option value="last_month">Last Month</option>
                            <option value="custom">Custom Range</option>
                        </select>

                        <div id="sales-custom-dates" class="hidden mr-2 flex items-center">
                            <input type="date" id="sales-start-date" class="form-input text-sm p-1 border rounded">
                            <span class="mx-1">-</span>
                            <input type="date" id="sales-end-date" class="form-input text-sm p-1 border rounded">
                            <button class="btn btn-sm btn-primary ml-1" data-on-click="DailySales.applyCustomDate()">Go</button>
                        </div>

                        <select id="sales-payment-filter" class="form-select text-sm mr-2" data-on-change="DailySales.handlePaymentFilter($value)" data-style="width:140px;">
                            <option value="">All Payments</option>
                            <option value="Cash">Cash</option>
                            <option value="Airtel_Money">Airtel Money</option>
                            <option value="MTN_Money">MTN Money</option>
                            <option value="Card">Card</option>
                            <option value="Bank">Bank Transfer</option>
                            <option value="Credit">Credit</option>
                        </select>

                        <input type="text" id="sales-lookup-input" class="form-input text-sm p-1 border rounded mr-1" placeholder="Sale # (e.g. S-000123)" data-style="width:170px;" data-on-keyup="DailySales.handleLookupKey($event)">
                        <button class="btn btn-sm btn-outline mr-2" data-on-click="DailySales.lookupSale()" title="Find any sale by number, regardless of date filter"><i class="fas fa-search"></i> Find</button>

                        <button class="btn btn-outline mr-2" data-on-click="DailySales.exportSales()"><i class="fas fa-file-csv"></i> Export</button>
                        <button class="btn btn-secondary" data-on-click="DailySales.loadData()"><i class="fas fa-sync"></i> Refresh</button>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-body">
                    <div id="daily-sales-table-container">
                        <div class="loading-spinner"></div>
                    </div>
                </div>
            </div>
        `;

        // Set initial state
        document.getElementById('sales-range-select').value = this.filterState.range;
        if (this.filterState.payment_method) {
            document.getElementById('sales-payment-filter').value = this.filterState.payment_method;
        }

        await this.loadData();
    },

    handleRangeChange(range) {
        this.filterState.range = range;
        const now = new Date();
        let start = new Date();
        let end = new Date();

        if (range === 'custom') {
            document.getElementById('sales-custom-dates').classList.remove('hidden');
            return;
        } else {
            document.getElementById('sales-custom-dates').classList.add('hidden');
        }

        switch (range) {
            case 'today':
                this.filterState.label = 'Today';
                break;
            case 'yesterday':
                start.setDate(now.getDate() - 1);
                end.setDate(now.getDate() - 1);
                this.filterState.label = 'Yesterday';
                break;
            case '7days':
                start.setDate(now.getDate() - 6);
                this.filterState.label = 'Last 7 Days';
                break;
            case '30days':
                start.setDate(now.getDate() - 29);
                this.filterState.label = 'Last 30 Days';
                break;
            case 'this_month':
                start = new Date(now.getFullYear(), now.getMonth(), 1);
                this.filterState.label = 'This Month';
                break;
            case 'last_month':
                start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                end = new Date(now.getFullYear(), now.getMonth(), 0);
                this.filterState.label = 'Last Month';
                break;
        }

        this.filterState.start = start.toLocaleDateString('en-CA');
        this.filterState.end = end.toLocaleDateString('en-CA');
        this.updateDateLabel();
        this.loadData();
    },

    applyCustomDate() {
        const s = document.getElementById('sales-start-date').value;
        const e = document.getElementById('sales-end-date').value;
        if (!s || !e) return Utils.toast('Select start and end dates', 'warning');

        this.filterState.start = s;
        this.filterState.end = e;
        this.filterState.label = 'Custom Range';
        this.updateDateLabel();
        this.loadData();
    },

    handlePaymentFilter(val) {
        this.filterState.payment_method = val;
        this.loadData();
    },

    updateDateLabel() {
        const lbl = document.getElementById('sales-date-label');
        if (lbl) {
            if (this.filterState.range === 'today') {
                lbl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            } else {
                lbl.textContent = `${this.filterState.label} (${this.filterState.start} - ${this.filterState.end})`;
            }
        }
    },

    async exportSales() {
        try {
            Utils.toast('Generating CSV...', 'info');
            const { start, end, payment_method } = this.filterState;
            let url = `/reports/sales?format=csv&startDate=${start}&endDate=${end} 23:59:59`;
            if (payment_method) url += `&payment_method=${payment_method}`;

            const res = await fetch('/api' + url, {
                headers: { 'Authorization': `Bearer ${API.token}` }
            });

            if (!res.ok) throw new Error('Export failed');

            const blob = await res.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `sales_report_${start}_to_${end}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            Utils.toast('Export complete', 'success');
        } catch (err) {
            Utils.toast('Export failed: ' + err.message, 'error');
        }
    },

    PAGE_SIZE: 50,

    /**
     * Build the report URL for a given page. Daily Sales now uses the
     * `?page=N&limit=M` envelope (v1.0.29) so directors can keep
     * paging back without losing rows past a hard cap. The first page
     * resets accumulated rows; subsequent pages append.
     */
    _buildReportUrl(page) {
        const { start, end, payment_method } = this.filterState;
        let url = `/reports/sales?startDate=${start}&endDate=${end} 23:59:59&page=${page}&limit=${this.PAGE_SIZE}`;
        if (payment_method) url += `&payment_method=${payment_method}`;
        return url;
    },

    async loadData() {
        try {
            const container = document.getElementById('daily-sales-table-container');
            if (container) container.innerHTML = '<div class="loading-spinner"></div>';

            let transactions;
            if (this._skipFetch && Array.isArray(this.data)) {
                // Re-render path used by loadMore() — keep the
                // already-accumulated rows + pageState, just redraw.
                transactions = this.data;
            } else {
                // Reset paging state on every fresh load (filter
                // change / refresh / first open).
                this.pageState = { page: 1, total: 0, accumulated: 0 };
                const env = await API.get(this._buildReportUrl(1));
                // Envelope shape: {rows,total,page,limit}. Defensive
                // fallback to bare-array (legacy) if any caller bypasses
                // the page param.
                transactions = Array.isArray(env) ? env : (env && env.rows) || [];
                const total = Array.isArray(env) ? transactions.length : (env && env.total) || transactions.length;
                this.data = transactions;
                this.pageState.total = total;
                this.pageState.accumulated = transactions.length;
            }

            if (!transactions || transactions.length === 0) {
                const container = document.getElementById('daily-sales-table-container');
                if (container) {
                    container.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-icon">📝</div>
                            <h3>No sales found for today</h3>
                            <p>Transactions will appear here once recorded.</p>
                        </div>
                    `;
                }
                return;
            }

            const total = transactions.reduce((sum, t) => sum + parseFloat(t.total_amount), 0);
            const totalCash = transactions.filter(t => t.payment_method === 'Cash').reduce((sum, t) => sum + parseFloat(t.total_amount), 0);
            const totalMobile = transactions.filter(t => t.payment_method.includes('Money')).reduce((sum, t) => sum + parseFloat(t.total_amount), 0);
            const totalBank = transactions.filter(t => t.payment_method === 'Bank' || t.payment_method === 'Card').reduce((sum, t) => sum + parseFloat(t.total_amount), 0);

            const rows = transactions.map((t, index) => {
                // Child Row Content (Nested Table)
                // v1.0.31 (Task #57) — director per-line refund button.
                // Hidden if the sale is voided, the row is already removed,
                // or the user is not a director. CSP-strict (data-on-click +
                // data-style only).
                const _isDirRow = !!(Utils.getUser() && Utils.getUser().role === 'director');
                const itemsRows = t.items && t.items.length > 0
                    ? t.items.map(i => {
                        const isRemoved = !!i.removed_at;
                        const rowStyle = isRemoved
                            ? 'text-decoration:line-through;color:#999;background:#fff5f5;'
                            : '';
                        // Hide for voided/deleted sales and already-removed lines.
                        // (is_deleted column doesn't currently exist server-side,
                        // but we guard anyway so a future schema change is safe.)
                        const canRemove = _isDirRow && !t.is_voided && !t.is_deleted && !isRemoved;
                        // XSS-safe: removed_reason is director-typed free text
                        // and removed_by_name comes from the users table —
                        // both must be escaped before going into innerHTML.
                        const removedNote = isRemoved
                            ? `<div class="text-xs text-secondary mt-1" data-style="text-decoration:none;color:#a00;">Removed${i.removed_by_name ? ` by ${Utils.escapeHtml(i.removed_by_name)}` : ''}${i.removed_at ? ` on ${Utils.escapeHtml(new Date(i.removed_at).toLocaleString())}` : ''}${i.removed_reason ? ` — ${Utils.escapeHtml(i.removed_reason)}` : ''}</div>`
                            : '';
                        return `
                        <tr data-style="${rowStyle}">
                            <td>
                                ${i.description}
                                ${i.item_type === 'service' ? '<span class="badge badge-sm badge-info">Service</span>' : ''}
                                ${removedNote}
                            </td>
                            <td class="text-right">${Number(i.quantity)}${i.unit_of_measure || i.unit_measure ? ` <span class="text-xs text-secondary">${i.unit_of_measure || i.unit_measure}</span>` : ''}</td>
                            <td class="text-right">${Utils.currency(i.unit_price)}</td>
                            <td class="text-right font-bold">${Utils.currency(i.line_total)}</td>
                            <td>${canRemove ? `<button class="btn btn-xs btn-danger" data-on-click="DailySales.removeLine('${t.sale_id}','${i.item_id}','${(i.description || '').replace(/'/g, "&#39;")}')" title="Remove this line and restore stock"><i class="fas fa-times"></i></button>` : (t.staff_name || 'System')}</td>
                        </tr>`;
                    }).join('')
                    : '<tr><td colspan="5" class="text-muted text-center">No items</td></tr>';

                return `
                <!-- Parent Row -->
                <tr class="bs-row-parent clickable" data-on-click="DailySales.toggleRow('details-${index}',$el)">
                    <td class="font-bold">
                        <i class="fas fa-chevron-right row-toggle-icon mr-2 text-secondary"></i>
                        ${t.sale_number}
                    </td>
                    <td>
                        <div class="text-sm">${new Date(t.transaction_date).toLocaleDateString()}</div>
                        <div class="text-xs text-secondary detail-time">${new Date(t.transaction_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>
                    <td>${t.staff_name || 'System'}</td>
                    <td>
                        <span class="badge badge-${this.getPaymentBadge(t.payment_method)}">${t.payment_method}</span>
                        ${t.payment_reference ? `<span class="text-xs text-secondary ml-1">(${t.payment_reference})</span>` : ''}
                        ${(Array.isArray(t.payments) && t.payments.length > 1) ? `<span class="text-xs text-secondary ml-1">· ${t.payments.length} tenders</span>` : ''}
                    </td>
                    <td class="text-right font-bold text-lg text-primary">${Utils.currency(t.total_amount)}</td>
                </tr>
                <!-- Child Row (Hidden by default) -->
                <tr id="details-${index}" class="bs-row-child hidden">
                    <td colspan="5" class="p-0">
                        <div class="child-content-wrapper">
                            <div class="flex justify-between items-center p-3 bg-gray-50 border-b">
                                <h4 class="text-sm font-bold">Transaction Items ${t.is_voided ? '<span class="badge badge-danger ml-2">VOIDED</span>' : ''}</h4>
                                <div class="flex gap-2">
                                    <button class="btn btn-sm btn-outline" data-on-click="DailySales.reprintReceipt(${index})">
                                        <i class="fas fa-print mr-1"></i> Reprint Receipt
                                    </button>
                                    ${(Utils.getUser() && Utils.getUser().role === 'director' && !t.is_voided) ? `
                                        <button class="btn btn-sm btn-warning" data-on-click="DailySales.reverseSale('${t.sale_id}', '${t.sale_number}')">
                                            <i class="fas fa-undo mr-1"></i> Reverse
                                        </button>
                                    ` : ''}
                                    ${(Utils.getUser() && Utils.getUser().role === 'director') ? `
                                        <button class="btn btn-sm btn-danger" data-on-click="DailySales.deleteSale('${t.sale_id}', '${t.sale_number}')">
                                            <i class="fas fa-trash mr-1"></i> Delete
                                        </button>
                                    ` : ''}
                                </div>
                            </div>
                            ${(Array.isArray(t.payments) && t.payments.length > 1) ? `
                              <div class="p-3 border-b" data-style="background:#f8fafc;">
                                <div class="text-xs text-secondary font-bold mb-1">Tender Breakdown</div>
                                ${t.payments.map(p => `
                                  <div class="flex justify-between text-sm">
                                    <span><span class="badge badge-${this.getPaymentBadge(p.payment_method)}">${p.payment_method}</span>${p.payment_reference ? ` <span class="text-xs text-secondary">(${p.payment_reference})</span>` : ''}</span>
                                    <span class="font-bold">${Utils.currency(p.amount)}</span>
                                  </div>
                                `).join('')}
                              </div>
                            ` : ''}
                            <table class="table w-full table-sm table-nested">
                                <thead>
                                    <tr>
                                        <th>Item Description</th>
                                        <th class="text-right" data-style="width:10%">Qty</th>
                                        <th class="text-right" data-style="width:15%">Unit Price</th>
                                        <th class="text-right" data-style="width:15%">Total</th>
                                        <th data-style="width:15%">Sales Rep</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${itemsRows}
                                </tbody>
                            </table>
                        </div>
                    </td>
                </tr>
                `;
            }).join('');

            document.getElementById('daily-sales-table-container').innerHTML = `
                <div class="summary-cards-row">
                     <div class="summary-card card-total">
                        <div class="card-icon"><i class="fas fa-coins"></i></div>
                        <div class="card-content">
                            <div class="label">Total Revenue</div>
                            <div class="value">${Utils.currency(total)}</div>
                        </div>
                     </div>
                     <div class="summary-card">
                        <div class="card-icon text-success"><i class="fas fa-money-bill-wave"></i></div>
                        <div class="card-content">
                            <div class="label">Cash Sales</div>
                            <div class="value">${Utils.currency(totalCash)}</div>
                        </div>
                     </div>
                     <div class="summary-card">
                        <div class="card-icon text-warning"><i class="fas fa-mobile-alt"></i></div>
                        <div class="card-content">
                            <div class="label">Mobile Money</div>
                            <div class="value">${Utils.currency(totalMobile)}</div>
                        </div>
                     </div>
                </div>

                <div class="table-container">
                    <table class="table w-full table-hover">
                        <thead>
                            <tr class="bg-light">
                                <th data-style="width:20%">Reference</th>
                                <th data-style="width:15%">Time</th>
                                <th data-style="width:20%">Staff</th>
                                <th data-style="width:25%">Payment Method</th>
                                <th class="text-right" data-style="width:20%">Total Amount</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>

                <!-- Showing N of M + Load more (v1.0.29). Rendered for
                     every load so the count is always visible; the
                     button hides itself when accumulated >= total. -->
                <div class="flex items-center justify-between mt-3 px-1 text-sm text-secondary">
                    <div>Showing <b>${this.pageState.accumulated}</b> of <b>${this.pageState.total}</b> sale${this.pageState.total === 1 ? '' : 's'}</div>
                    ${this.pageState.accumulated < this.pageState.total ? `
                        <button class="btn btn-sm btn-outline" data-on-click="DailySales.loadMore()">
                            <i class="fas fa-chevron-down mr-1"></i> Load more (${Math.min(this.PAGE_SIZE, this.pageState.total - this.pageState.accumulated)})
                        </button>
                    ` : ''}
                </div>
            `;

        } catch (err) {
            console.error(err);
            const container = document.getElementById('daily-sales-table-container');
            if (container) {
                container.innerHTML = `<div class="error-state">Failed to load data</div>`;
            }
        }
    },

    reprintReceipt(index) {
        const sale = this.data[index];
        if (!sale) return;
        if (typeof POS !== 'undefined') {
            POS.printReceipt(sale);
        } else {
            Utils.toast('POS module not loaded', 'error');
        }
    },

    async reverseSale(saleId, saleNumber) {
        const ok = await Utils.confirm(
            `Reverse sale ${saleNumber}?\n\nThis voids the sale and restores stock for any product items. The transaction stays on record marked as VOIDED.`,
            { title: 'Reverse Sale', confirmText: 'Reverse', type: 'warning' }
        );
        if (!ok) return;
        try {
            await API.request(`/sales/${saleId}/void`, { method: 'PATCH', body: JSON.stringify({}) });
            Utils.toast(`Sale ${saleNumber} reversed`, 'success');
            this.loadData();
        } catch (err) {
            Utils.toast(err.message || 'Failed to reverse sale', 'error');
        }
    },

    /**
     * Append the next page of sales onto the existing list. Re-runs
     * the same render pipeline as loadData so the summary cards stay
     * accurate. No-op if the user has already loaded everything.
     */
    async loadMore() {
        if (!this.pageState || this.pageState.accumulated >= this.pageState.total) return;
        const btn = document.querySelector('[data-on-click="DailySales.loadMore()"]');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading…'; }
        try {
            const next = this.pageState.page + 1;
            const env  = await API.get(this._buildReportUrl(next));
            const more = Array.isArray(env) ? env : (env && env.rows) || [];
            this.data = (this.data || []).concat(more);
            this.pageState.page = next;
            this.pageState.accumulated += more.length;
            // Re-render in place — easiest way to keep summary cards,
            // child-row toggling and the Load-more pill consistent.
            // We can't call loadData() (it re-fetches page 1), so we
            // run the same render section manually by stuffing data
            // into a tiny re-entrant helper.
            await this._rerenderFromData();
        } catch (err) {
            Utils.toast((err && err.message) || 'Failed to load more sales', 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-chevron-down mr-1"></i> Load more'; }
        }
    },

    /**
     * Render the current `this.data` snapshot using the same markup
     * as loadData(). Extracted so loadMore() can append + redraw
     * without re-fetching page 1.
     */
    async _rerenderFromData() {
        // Cheapest possible approach: stash data, call loadData, but
        // loadData re-fetches. Instead we trigger the render half by
        // dispatching to a synthetic path. To avoid duplicating ~120
        // lines of markup, we wrap the existing render block by
        // setting a flag and re-invoking loadData with a short-circuit.
        this._skipFetch = true;
        try { await this.loadData(); } finally { this._skipFetch = false; }
    },

    handleLookupKey(ev) {
        if (ev && ev.key === 'Enter') { ev.preventDefault(); this.lookupSale(); }
    },

    /**
     * Jump to any sale by its sale_number — bypasses the date filter
     * so directors can pull up a transaction from weeks/months ago
     * without paginating. On a unique match we open the existing
     * detail drawer; on multiple prefix matches we toast the count
     * and offer to apply the first match.
     */
    async lookupSale() {
        const input = document.getElementById('sales-lookup-input');
        const raw = (input && input.value || '').trim();
        if (!raw) return Utils.toast('Enter a sale number to look up', 'warning');
        try {
            const result = await API.get(`/sales/lookup?sale_number=${encodeURIComponent(raw)}`);
            if (result && Array.isArray(result.matches)) {
                Utils.toast(`Found ${result.matches.length} matches — showing the most recent`, 'info');
                await this._openSaleById(result.matches[0].sale_id, result.matches[0].sale_number);
                return;
            }
            if (result && result.sale_id) {
                await this._openSaleById(result.sale_id, result.sale_number);
                return;
            }
            Utils.toast('No sale found with that number', 'warning');
        } catch (err) {
            const msg = (err && err.message) || 'Lookup failed';
            Utils.toast(/no sale found/i.test(msg) ? 'No sale found with that number' : msg, /no sale found/i.test(msg) ? 'warning' : 'error');
        }
    },

    /**
     * Fetch a single sale and inject it as a one-row table so the
     * existing reverse/delete buttons + detail drawer all work without
     * duplicating render code. Replaces the current view; user clicks
     * Refresh (or changes the filter) to return to the listing.
     */
    async _openSaleById(saleId, saleNumber) {
        try {
            const sale = await API.get(`/sales/${saleId}`);
            if (!sale) return Utils.toast('Sale could not be loaded', 'error');
            // Reports endpoint returns { items, staff_name, payment_reference } —
            // getSale returns slightly different shape. Normalise so the
            // existing render pipeline works.
            const normalized = {
                sale_id: sale.sale_id,
                sale_number: sale.sale_number,
                transaction_date: sale.transaction_date,
                payment_method: sale.payment_method,
                payment_reference: sale.payment_reference,
                total_amount: sale.total_amount,
                is_voided: !!sale.is_voided,
                staff_name: sale.staff_name || 'System',
                items: Array.isArray(sale.items) ? sale.items : [],
                payments: Array.isArray(sale.payments) ? sale.payments : [],
            };
            this.data = [normalized];
            // Re-render via loadData's tail by stuffing the data and
            // calling the same render path. Easiest is to fake the
            // empty branch out and trigger a single-row render: just
            // call loadData but it would refetch — instead, manually
            // render the same markup loadData uses.
            this.filterState.label = `Sale ${normalized.sale_number}`;
            this.updateDateLabel();
            await this._renderRows([normalized]);
            // Auto-expand the only row so the director sees Reverse/Delete.
            setTimeout(() => {
                const firstParent = document.querySelector('.bs-row-parent');
                if (firstParent) firstParent.click();
            }, 50);
        } catch (err) {
            Utils.toast((err && err.message) || 'Failed to open sale', 'error');
        }
    },

    /**
     * Internal helper: render an arbitrary list of transactions into
     * the table container, reusing the same markup as loadData. Kept
     * tiny on purpose — the heavy lifting stays in loadData and we
     * only call this from the lookup path.
     */
    async _renderRows(transactions) {
        const container = document.getElementById('daily-sales-table-container');
        if (!container) return;
        // Re-stash and re-run loadData's render section by temporarily
        // overriding the data fetch. Simplest: assign data and call a
        // dedicated re-render. To avoid a deep refactor we just call
        // loadData() — but that refetches. Instead, swap to inline
        // rendering of just the requested row.
        const t = transactions[0];
        // v1.0.31 — same per-line refund button on the lookup-path drawer.
        const _isDirLk = !!(Utils.getUser() && Utils.getUser().role === 'director');
        const itemsRows = (t.items && t.items.length > 0)
            ? t.items.map(i => {
                const isRemoved = !!i.removed_at;
                const rowStyle = isRemoved
                    ? 'text-decoration:line-through;color:#999;background:#fff5f5;'
                    : '';
                const canRemove = _isDirLk && !t.is_voided && !t.is_deleted && !isRemoved;
                const removedNote = isRemoved
                    ? `<div class="text-xs text-secondary mt-1" data-style="text-decoration:none;color:#a00;">Removed${i.removed_by_name ? ` by ${Utils.escapeHtml(i.removed_by_name)}` : ''}${i.removed_at ? ` on ${Utils.escapeHtml(new Date(i.removed_at).toLocaleString())}` : ''}${i.removed_reason ? ` — ${Utils.escapeHtml(i.removed_reason)}` : ''}</div>`
                    : '';
                return `
                <tr data-style="${rowStyle}">
                    <td>${i.description}${i.item_type === 'service' ? ' <span class="badge badge-sm badge-info">Service</span>' : ''}${removedNote}</td>
                    <td class="text-right">${Number(i.quantity)}${i.unit_of_measure || i.unit_measure ? ` <span class="text-xs text-secondary">${i.unit_of_measure || i.unit_measure}</span>` : ''}</td>
                    <td class="text-right">${Utils.currency(i.unit_price)}</td>
                    <td class="text-right font-bold">${Utils.currency(i.line_total)}</td>
                    <td>${canRemove ? `<button class="btn btn-xs btn-danger" data-on-click="DailySales.removeLine('${t.sale_id}','${i.item_id}','${(i.description || '').replace(/'/g, "&#39;")}')" title="Remove this line and restore stock"><i class="fas fa-times"></i></button>` : (t.staff_name || 'System')}</td>
                </tr>`;
            }).join('')
            : '<tr><td colspan="5" class="text-muted text-center">No items</td></tr>';
        const isDir = Utils.getUser() && Utils.getUser().role === 'director';
        container.innerHTML = `
            <div class="mb-3 text-sm text-secondary">
                Showing 1 sale found by lookup. <a href="#" data-on-click="DailySales.loadData()">Back to list</a>.
            </div>
            <div class="table-container">
                <table class="table w-full table-hover">
                    <thead><tr class="bg-light">
                        <th data-style="width:20%">Reference</th>
                        <th data-style="width:15%">Time</th>
                        <th data-style="width:20%">Staff</th>
                        <th data-style="width:25%">Payment Method</th>
                        <th class="text-right" data-style="width:20%">Total Amount</th>
                    </tr></thead>
                    <tbody>
                        <tr class="bs-row-parent clickable" data-on-click="DailySales.toggleRow('details-lookup',$el)">
                            <td class="font-bold"><i class="fas fa-chevron-right row-toggle-icon mr-2 text-secondary"></i>${t.sale_number}</td>
                            <td>
                                <div class="text-sm">${new Date(t.transaction_date).toLocaleDateString()}</div>
                                <div class="text-xs text-secondary detail-time">${new Date(t.transaction_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                            </td>
                            <td>${t.staff_name || 'System'}</td>
                            <td>
                                <span class="badge badge-${this.getPaymentBadge(t.payment_method)}">${t.payment_method}</span>
                                ${t.payment_reference ? `<span class="text-xs text-secondary ml-1">(${t.payment_reference})</span>` : ''}
                            </td>
                            <td class="text-right font-bold text-lg text-primary">${Utils.currency(t.total_amount)}</td>
                        </tr>
                        <tr id="details-lookup" class="bs-row-child hidden">
                            <td colspan="5" class="p-0">
                                <div class="child-content-wrapper">
                                    <div class="flex justify-between items-center p-3 bg-gray-50 border-b">
                                        <h4 class="text-sm font-bold">Transaction Items ${t.is_voided ? '<span class="badge badge-danger ml-2">VOIDED</span>' : ''}</h4>
                                        <div class="flex gap-2">
                                            ${(isDir && !t.is_voided) ? `<button class="btn btn-sm btn-warning" data-on-click="DailySales.reverseSale('${t.sale_id}', '${t.sale_number}')"><i class="fas fa-undo mr-1"></i> Reverse</button>` : ''}
                                            ${isDir ? `<button class="btn btn-sm btn-danger" data-on-click="DailySales.deleteSale('${t.sale_id}', '${t.sale_number}')"><i class="fas fa-trash mr-1"></i> Delete</button>` : ''}
                                        </div>
                                    </div>
                                    <table class="table w-full table-sm table-nested">
                                        <thead><tr>
                                            <th>Item Description</th>
                                            <th class="text-right" data-style="width:10%">Qty</th>
                                            <th class="text-right" data-style="width:15%">Unit Price</th>
                                            <th class="text-right" data-style="width:15%">Total</th>
                                            <th data-style="width:15%">Sales Rep</th>
                                        </tr></thead>
                                        <tbody>${itemsRows}</tbody>
                                    </table>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    },

    /**
     * v1.0.31 (Task #57) — Director per-line refund.
     *
     * Confirms with the user, posts DELETE /sales/:id/items/:itemId,
     * then refreshes the Daily Sales view so the struck line, the
     * recomputed total and the negative cash-drawer movement are all
     * visible immediately. Server enforces director-only and
     * "can't remove the last line" — frontend only hides the button
     * to keep the UI tidy.
     */
    async removeLine(saleId, itemId, description) {
        const reason = await Utils.prompt(
            `Remove "${description}" from this sale?\n\nThis restores its stock and refunds the line amount from the largest tender (cash refunds are posted to the open till). The line stays on the receipt struck through for the audit trail.\n\nReason (optional, shown on the receipt):`,
            { title: 'Remove sale line', confirmText: 'Remove line', placeholder: 'e.g. customer changed mind, wrong item', allowEmpty: true }
        );
        if (reason === null || reason === undefined) return; // cancelled
        try {
            const res = await API.request(`/sales/${saleId}/items/${itemId}`, {
                method: 'DELETE',
                body: JSON.stringify({ reason: String(reason || '').trim() }),
            });
            Utils.toast('Line removed and stock restored.', 'success');
            // Reload whichever view the director was on. loadData() handles
            // the day-list path; if they came in via lookup the same call
            // refreshes back to the day-list, which is the safer default
            // (the new total is visible and the line is struck through).
            this.loadData();
            return res;
        } catch (err) {
            Utils.toast((err && err.message) || 'Failed to remove line', 'error');
        }
    },

    async deleteSale(saleId, saleNumber) {
        const ok = await Utils.confirm(
            `PERMANENTLY DELETE sale ${saleNumber}?\n\nThis removes the sale and all its items, payments, cash-drawer movements, credit and loyalty rows. Stock is restored if the sale wasn't already voided. This cannot be undone.`,
            { title: 'Delete Sale', confirmText: 'Delete', type: 'danger' }
        );
        if (!ok) return;
        try {
            await API.request(`/sales/${saleId}`, { method: 'DELETE' });
            Utils.toast(`Sale ${saleNumber} deleted`, 'success');
            this.loadData();
        } catch (err) {
            Utils.toast(err.message || 'Failed to delete sale', 'error');
        }
    },

    toggleRow(id, row) {
        const el = document.getElementById(id);
        const icon = row.querySelector('.row-toggle-icon');

        if (el.classList.contains('hidden')) {
            el.classList.remove('hidden');
            row.classList.add('expanded');
            if (icon) {
                icon.classList.remove('fa-chevron-right');
                icon.classList.add('fa-chevron-down');
            }
        } else {
            el.classList.add('hidden');
            row.classList.remove('expanded');
            if (icon) {
                icon.classList.add('fa-chevron-right');
                icon.classList.remove('fa-chevron-down');
            }
        }
    },

    getPaymentBadge(method) {
        switch (method) {
            case 'Cash': return 'success';
            case 'Airtel_Money': return 'danger';
            case 'MTN_Money': return 'warning';
            case 'Bank': return 'info';
            default: return 'secondary';
        }
    }
};

window.DailySales = DailySales;
