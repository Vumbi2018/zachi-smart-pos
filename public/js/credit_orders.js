/**
 * Zachi Smart-POS — Credit Orders Management
 * Shows outstanding credit/partial sales, allows recording installment payments.
 */
const CreditOrders = {
    _orders: [],
    _filter: 'all', // 'all' | 'overdue' | 'partial'

    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">
                        <span class="material-icons-outlined" data-style="vertical-align:middle;margin-right:6px;font-size:1.4rem;">credit_card</span>
                        Credit Orders
                    </h1>
                    <p class="text-secondary">Track outstanding credit sales and record installment payments.</p>
                </div>
                <button class="btn btn-primary" data-on-click="CreditOrders.load()">
                    <span class="material-icons-outlined" data-style="font-size:15px;vertical-align:middle;">refresh</span> Refresh
                </button>
            </div>

            <!-- Summary Cards -->
            <div id="co-summary" data-style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px;"></div>

            <!-- Filter Tabs -->
            <div class="card overflow-hidden">
                <div data-style="display:flex;gap:0;border-bottom:1px solid var(--color-border);">
                    ${[['all', 'All Outstanding'], ['overdue', '🔴 Overdue (>30d)'], ['partial', '🟡 Partial']].map(([v, l]) =>
            `<button class="btn btn-ghost co-filter-btn" data-filter="${v}" data-style="border-radius:0;border-right:1px solid var(--color-border);padding:12px 20px;font-size:.88rem;" data-on-click="CreditOrders.setFilter('${v}')">${l}</button>`
        ).join('')}
                </div>
                <div data-style="overflow:auto;">
                    <table class="table w-full" id="co-table">
                        <thead data-style="position:sticky;top:0;z-index:5;background:var(--color-surface);">
                            <tr>
                                <th>Sale #</th>
                                <th>Date</th>
                                <th>Customer</th>
                                <th class="text-right">Total (K)</th>
                                <th class="text-right">Paid (K)</th>
                                <th class="text-right">Balance (K)</th>
                                <th data-style="width:160px;">Due</th>
                                <th data-style="width:110px;">Status</th>
                                <th data-style="width:200px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="co-tbody">
                            <tr><td colspan="9" class="text-center py-8 text-secondary">Loading…</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Payment Modal -->
            <div id="co-modal" class="modal-overlay hidden" data-style="z-index:1000;">
                <div class="modal" data-style="max-width:460px;width:95%;">
                    <div class="modal-header">
                        <h3 class="modal-title" id="co-modal-title">Record Payment</h3>
                        <button class="modal-close" data-on-click="CreditOrders.closeModal()">×</button>
                    </div>
                    <div class="modal-body" id="co-modal-body"></div>
                </div>
            </div>
        `;

        this.setFilter('all');
        await this.load();
    },

    setFilter(f) {
        this._filter = f;
        document.querySelectorAll('.co-filter-btn').forEach(b => {
            b.style.background = b.dataset.filter === f ? 'var(--color-primary)' : '';
            b.style.color = b.dataset.filter === f ? '#fff' : '';
        });
        this._renderTable();
    },

    /**
     * HTML-escape a string for safe interpolation into an innerHTML
     * template. Customer names come from a user-editable field, so
     * a malicious name like `<img src=x onerror=…>` would otherwise
     * execute script in the cashier's browser when this table
     * renders.
     */
    _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    /**
     * Build the WhatsApp reminder link for a single credit order.
     * Returns null if the customer has no phone on file (we never
     * silently send a reminder to nobody — the UI shows a disabled
     * button with a tooltip in that case).
     */
    _whatsAppLink(order) {
        const raw = (order.customer_phone || '').trim();
        if (!raw) return null;

        // Accept the typical Zambian formats: +260 974 210 067,
        // 0974210067, 260974210067 — wa.me wants a digits-only
        // number with country code and no leading +.
        let digits = raw.replace(/[^\d]/g, '');
        if (digits.startsWith('0')) digits = '260' + digits.slice(1);
        if (digits.length < 9) return null;

        const balance = parseFloat(order.balance || 0).toFixed(2);
        const due = order.due_date
            ? new Date(order.due_date).toLocaleDateString()
            : 'as soon as possible';
        const name = (order.customer_name || 'there').split(' ')[0];

        const msg =
            `Hello ${name}, this is a friendly reminder from Zachi Computer Centre. ` +
            `You have an outstanding balance of K${balance} on sale ${order.sale_number} ` +
            `(due ${due}). Please contact us to settle when you can. Thank you!`;
        return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
    },

    /**
     * Renders the "due in N days" / "overdue by N days" badge from
     * the days_until_due field returned by the backend.
     */
    _dueBadge(daysUntilDue, dueDate) {
        if (daysUntilDue == null) {
            return '<span class="text-secondary" data-style="font-size:.78rem;">—</span>';
        }
        const d = parseInt(daysUntilDue, 10);
        const dateStr = dueDate ? new Date(dueDate).toLocaleDateString() : '';
        if (d < 0) {
            return `<span class="badge" data-style="background:rgba(239,68,68,.18);color:#b91c1c;font-weight:600;">${dateStr} · ${Math.abs(d)}d overdue</span>`;
        }
        if (d <= 7) {
            return `<span class="badge" data-style="background:rgba(234,179,8,.18);color:#a16207;font-weight:600;">${dateStr} · due in ${d}d</span>`;
        }
        return `<span class="badge" data-style="background:rgba(34,197,94,.15);color:#15803d;">${dateStr}</span>`;
    },

    async load() {
        try {
            const data = await API.get('/sales/credit');
            this._orders = data.credit_orders || [];
            this._renderSummary();
            this._renderTable();
        } catch (err) {
            Utils.toast(err.message || 'Failed to load credit orders', 'error');
        }
    },

    _renderSummary() {
        const total = this._orders.reduce((s, o) => s + parseFloat(o.balance || 0), 0);
        const overdue = this._orders.filter(o => parseInt(o.days_overdue) > 30);
        const overdueAmt = overdue.reduce((s, o) => s + parseFloat(o.balance || 0), 0);
        document.getElementById('co-summary').innerHTML = `
            <div class="stat-card" data-style="border-left:4px solid var(--color-danger);">
                <div class="stat-label">Total Outstanding</div>
                <div class="stat-value text-danger">K ${total.toFixed(2)}</div>
                <div class="stat-sub">${this._orders.length} order${this._orders.length !== 1 ? 's' : ''}</div>
            </div>
            <div class="stat-card" data-style="border-left:4px solid var(--color-warning);">
                <div class="stat-label">Overdue (&gt;30 days)</div>
                <div class="stat-value" data-style="color:var(--color-warning);">K ${overdueAmt.toFixed(2)}</div>
                <div class="stat-sub">${overdue.length} order${overdue.length !== 1 ? 's' : ''}</div>
            </div>
            <div class="stat-card" data-style="border-left:4px solid var(--color-success);">
                <div class="stat-label">Partially Paid</div>
                <div class="stat-value" data-style="color:var(--color-success);">${this._orders.filter(o => o.payment_status === 'Partial').length}</div>
                <div class="stat-sub">orders with some payment</div>
            </div>
        `;
    },

    _ageBadge(days) {
        const d = parseInt(days) || 0;
        if (d > 30) return `<span class="badge" data-style="background:rgba(239,68,68,.15);color:#ef4444;">${d}d overdue</span>`;
        if (d > 7) return `<span class="badge" data-style="background:rgba(234,179,8,.15);color:var(--color-warning);">${d}d</span>`;
        return `<span class="badge badge-success">${d}d</span>`;
    },

    _renderTable() {
        const filtered = this._orders.filter(o => {
            if (this._filter === 'overdue') return parseInt(o.days_overdue) > 30;
            if (this._filter === 'partial') return o.payment_status === 'Partial';
            return true;
        });

        if (!filtered.length) {
            document.getElementById('co-tbody').innerHTML =
                '<tr><td colspan="9" class="text-center py-8 text-secondary">No outstanding credit orders.</td></tr>';
            return;
        }

        document.getElementById('co-tbody').innerHTML = filtered.map(o => {
            const waLink = this._whatsAppLink(o);
            const safeCustomer = this._esc(o.customer_name || 'customer');
            const reminderBtn = waLink
                ? `<a href="${this._esc(waLink)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline" title="Send WhatsApp reminder to ${safeCustomer}" data-style="background:#25d366;color:#fff;border-color:#25d366;">
                       <span class="material-icons-outlined" data-style="font-size:14px;vertical-align:middle;">chat</span> Remind
                   </a>`
                : `<button class="btn btn-sm btn-outline" disabled title="No phone number on file for this customer" data-style="opacity:.5;cursor:not-allowed;">
                       <span class="material-icons-outlined" data-style="font-size:14px;vertical-align:middle;">chat</span> Remind
                   </button>`;
            // sale_id is a uuid in this DB, so wrap in single quotes
            // when interpolating into the data-on-click handler.
            return `
                <tr>
                    <td class="font-mono text-sm">${this._esc(o.sale_number)}</td>
                    <td class="text-sm">${new Date(o.transaction_date).toLocaleDateString()}</td>
                    <td>${o.customer_name ? this._esc(o.customer_name) : '<span class="text-secondary">Walk-in</span>'}</td>
                    <td class="text-right font-bold">${parseFloat(o.total_amount).toFixed(2)}</td>
                    <td class="text-right text-success">${parseFloat(o.amount_paid || 0).toFixed(2)}</td>
                    <td class="text-right font-bold text-danger">${parseFloat(o.balance || 0).toFixed(2)}</td>
                    <td>${this._dueBadge(o.days_until_due, o.due_date)}</td>
                    <td><span class="badge ${o.payment_status === 'Partial' ? 'badge-warning' : 'badge-danger'}">${this._esc(o.payment_status)}</span></td>
                    <td data-style="white-space:nowrap;">
                        <button class="btn btn-sm btn-primary" data-on-click="CreditOrders.openPaymentModal('${this._esc(o.sale_id)}')">
                            <span class="material-icons-outlined" data-style="font-size:14px;vertical-align:middle;">add</span> Pay
                        </button>
                        ${reminderBtn}
                    </td>
                </tr>
            `;
        }).join('');
    },

    openPaymentModal(saleId) {
        const order = this._orders.find(o => o.sale_id === saleId);
        if (!order) return;

        const balance = parseFloat(order.balance || 0);
        document.getElementById('co-modal-title').textContent =
            `Record Payment — ${order.sale_number}`;

        document.getElementById('co-modal-body').innerHTML = `
            <div data-style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:.9rem;">
                <div data-style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span class="text-secondary">Customer</span><strong>${order.customer_name || 'Walk-in'}</strong>
                </div>
                <div data-style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span class="text-secondary">Total</span><span>K ${parseFloat(order.total_amount).toFixed(2)}</span>
                </div>
                <div data-style="display:flex;justify-content:space-between;margin-bottom:4px;">
                    <span class="text-secondary">Already Paid</span><span class="text-success">K ${parseFloat(order.amount_paid || 0).toFixed(2)}</span>
                </div>
                <div data-style="display:flex;justify-content:space-between;font-weight:700;border-top:1px solid var(--color-border);padding-top:8px;margin-top:6px;">
                    <span>Balance Due</span><span class="text-danger">K ${balance.toFixed(2)}</span>
                </div>
            </div>

            <div class="form-group">
                <label class="form-label">Amount Received (K) <span class="text-danger">*</span></label>
                <input type="number" id="co-pay-amount" class="form-input" min="0.01" step="0.01"
                    max="${balance}" value="${balance.toFixed(2)}" placeholder="0.00">
            </div>
            <div class="form-group">
                <label class="form-label">Payment Method</label>
                <select id="co-pay-method" class="form-select">
                    <option value="Cash">Cash</option>
                    <option value="EFT">EFT (Bank Transfer)</option>
                    <option value="Airtel_Money">Airtel Money</option>
                    <option value="MTN_Money">MTN Money</option>
                    <option value="Card">Card</option>
                    <option value="Bank">Bank Deposit</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Reference / Transaction #</label>
                <input type="text" id="co-pay-ref" class="form-input" placeholder="e.g. EFT-20261234">
            </div>
            <div class="form-group">
                <label class="form-label">Notes</label>
                <input type="text" id="co-pay-notes" class="form-input" placeholder="Optional notes">
            </div>

            <div data-style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px;">
                <button class="btn btn-outline" data-on-click="CreditOrders.closeModal()">Cancel</button>
                <button class="btn btn-primary" data-on-click="CreditOrders.submitPayment(${saleId})">
                    <span class="material-icons-outlined" data-style="font-size:15px;vertical-align:middle;">check_circle</span>
                    Record Payment
                </button>
            </div>
        `;

        document.getElementById('co-modal').classList.remove('hidden');
    },

    closeModal() {
        document.getElementById('co-modal').classList.add('hidden');
    },

    async submitPayment(saleId) {
        const amount = parseFloat(document.getElementById('co-pay-amount').value);
        if (!amount || amount <= 0) return Utils.toast('Enter a valid amount', 'warning');

        const payload = {
            amount,
            payment_method: document.getElementById('co-pay-method').value,
            payment_reference: document.getElementById('co-pay-ref').value || null,
            notes: document.getElementById('co-pay-notes').value || null
        };

        const btn = document.querySelector('#co-modal .btn-primary');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

        try {
            const res = await API.post(`/sales/${saleId}/payment`, payload);
            Utils.toast(res.message || 'Payment recorded!', 'success');
            this.closeModal();
            await this.load();
        } catch (err) {
            Utils.toast(err.message || 'Failed to record payment', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-icons-outlined" data-style="font-size:15px;vertical-align:middle;">check_circle</span> Record Payment'; }
        }
    }
};

window.CreditOrders = CreditOrders;
