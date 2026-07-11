/**
 * invoices.js
 *
 * Front-end module for the new Invoices page (v1.0.13).
 *
 * Contract:
 *   - Lists `/api/invoices` (status filter, search).
 *   - Opens a view modal for a single invoice with line items.
 *   - "Edit" is enabled ONLY for Draft invoices (mirrors the backend).
 *   - Email / WhatsApp / SMS / Print mirror the Quotes module's
 *     send-to-customer pattern: when a phone gateway is configured the
 *     server sends directly, otherwise we fall back to a wa.me / sms:
 *     link with a signed PDF URL appended so the customer can still
 *     download the branded copy.
 *   - Mark-paid takes a number prompt and POSTs to
 *     `/api/invoices/:id/payment`. Status moves to Paid automatically
 *     when the cumulative amount_paid covers total_amount.
 *
 * UUID note: we always quote ids when interpolating into onclick handler
 * strings (`Invoices.openInvoice('${id}')`) — UUIDs contain dashes that
 * would otherwise be parsed as JS subtractions.
 */
'use strict';

const Invoices = {
    state: { invoices: [], filter: { status: '', search: '' }, current: null },
    __gwCache: null,

    render(container) {
        if (!container) return;
        container.innerHTML = `
            <div class="page-header">
                <h1>Invoices</h1>
                <div class="page-tools" style="display:flex;gap:8px;align-items:center;">
                    <select id="inv-status" class="form-input">
                        <option value="">All statuses</option>
                        <option value="Draft">Draft</option>
                        <option value="Issued">Issued</option>
                        <option value="Paid">Paid</option>
                        <option value="Void">Void</option>
                    </select>
                    <input id="inv-search" class="form-input" placeholder="Search invoice # or customer…" />
                    <button class="btn btn-outline" data-on-click="Invoices.loadInvoices()">Refresh</button>
                    <button class="btn btn-primary" data-on-click="Invoices.showCreateModal()">+ New Invoice</button>
                </div>
            </div>
            <div id="inv-list" class="card mt-3">
                <div class="text-muted" style="padding:24px;text-align:center;">Loading invoices…</div>
            </div>`;
        const sel = container.querySelector('#inv-status');
        const inp = container.querySelector('#inv-search');
        sel.addEventListener('change', () => { this.state.filter.status = sel.value; this.loadInvoices(); });
        let tmr = null;
        inp.addEventListener('input', () => {
            clearTimeout(tmr);
            tmr = setTimeout(() => { this.state.filter.search = inp.value.trim(); this.loadInvoices(); }, 250);
        });
        this.loadInvoices();
    },

    async loadInvoices() {
        const list = document.getElementById('inv-list');
        if (!list) return;
        try {
            const q = new URLSearchParams();
            if (this.state.filter.status) q.set('status', this.state.filter.status);
            if (this.state.filter.search) q.set('search', this.state.filter.search);
            const data = await API.get(`/invoices${q.toString() ? '?' + q.toString() : ''}`);
            this.state.invoices = Array.isArray(data) ? data : [];
            this._renderList();
        } catch (err) {
            console.error('[Invoices] loadInvoices failed', err);
            list.innerHTML = `<div class="alert alert-danger" style="margin:16px;">Failed to load invoices: ${Utils.escapeHtml(err.message || '')}</div>`;
        }
    },

    _renderList() {
        const list = document.getElementById('inv-list');
        if (!list) return;
        if (this.state.invoices.length === 0) {
            list.innerHTML = `<div class="text-muted" style="padding:32px;text-align:center;">
                No invoices yet. Invoices appear automatically when a sale is completed on credit
                or when a quotation is marked Accepted, or click <strong>+ New Invoice</strong>
                to create a one-off (retainer / reimbursement / ad-hoc service) invoice.
            </div>`;
            return;
        }
        const rows = this.state.invoices.map((i) => {
            const balance = Number(i.total_amount) - Number(i.amount_paid || 0);
            const statusBadge = this._statusBadge(i.status);
            // 3-way badge: 'manual' invoices have no parent sale or quote
            // (created via POST /api/invoices). The two auto-issue badges
            // are unchanged so existing rows look identical.
            let sourceBadge;
            if (i.source_kind === 'quote') {
                sourceBadge = '<span class="badge badge-info" title="Auto-issued from accepted quote">From Quote</span>';
            } else if (i.source_kind === 'sale') {
                sourceBadge = '<span class="badge badge-secondary" title="Auto-issued from credit sale">From Sale</span>';
            } else {
                sourceBadge = '<span class="badge badge-warning" title="One-off invoice created manually">Manual</span>';
            }
            return `
                <tr>
                    <td><strong>${Utils.escapeHtml(i.invoice_number || '')}</strong> ${sourceBadge}</td>
                    <td>${Utils.escapeHtml(i.customer_name || '—')}</td>
                    <td>${i.issue_date ? new Date(i.issue_date).toLocaleDateString('en-ZM') : '—'}</td>
                    <td>${i.due_date ? new Date(i.due_date).toLocaleDateString('en-ZM') : '—'}</td>
                    <td style="text-align:right;">${Utils.currency(i.total_amount)}</td>
                    <td style="text-align:right;${balance > 0 ? 'color:#a00;font-weight:bold;' : ''}">
                        ${Utils.currency(balance)}
                    </td>
                    <td>${statusBadge}</td>
                    <td>
                        <button class="btn btn-sm btn-outline"
                            data-on-click="Invoices.openInvoice('${i.invoice_id}')">View</button>
                    </td>
                </tr>`;
        }).join('');
        list.innerHTML = `
            <div class="table-responsive">
                <table class="table">
                    <thead><tr>
                        <th>Invoice #</th>
                        <th>Customer</th>
                        <th>Issued</th>
                        <th>Due</th>
                        <th style="text-align:right;">Total</th>
                        <th style="text-align:right;">Balance</th>
                        <th>Status</th>
                        <th></th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    },

    _statusBadge(s) {
        const map = {
            Draft:  ['secondary', 'Draft'],
            Issued: ['warning',   'Issued'],
            Paid:   ['success',   'Paid'],
            Void:   ['danger',    'Void'],
        };
        const [kind, label] = map[s] || ['secondary', s || '—'];
        return `<span class="badge badge-${kind}">${Utils.escapeHtml(label)}</span>`;
    },

    async openInvoice(id) {
        try {
            const inv = await API.get(`/invoices/${id}`);
            this.state.current = inv;
            const balance = Number(inv.total_amount) - Number(inv.amount_paid || 0);
            const itemRows = (inv.items || []).map((it, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td>${Utils.escapeHtml(it.description || '')}</td>
                    <td style="text-align:center;">${Number(it.quantity)}</td>
                    <td style="text-align:right;">${Utils.currency(it.unit_price)}</td>
                    <td style="text-align:right;">${Utils.currency(it.line_total)}</td>
                </tr>`).join('');

            const canEdit   = inv.status === 'Draft';
            const canPay    = inv.status !== 'Void' && balance > 0;
            const canVoid   = inv.status !== 'Void' && Number(inv.amount_paid || 0) === 0;
            const canIssue  = inv.status === 'Draft';
            const idQ = `'${id}'`;

            const body = `
                <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;">
                    <div>
                        <div><strong>Invoice:</strong> ${Utils.escapeHtml(inv.invoice_number || '')}</div>
                        <div><strong>Status:</strong> ${this._statusBadge(inv.status)}</div>
                        <div><strong>Issued:</strong> ${inv.issue_date ? new Date(inv.issue_date).toLocaleDateString('en-ZM') : '—'}</div>
                        <div><strong>Due:</strong> ${inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-ZM') : '—'}</div>
                        <div><strong>Source:</strong> ${inv.source_kind === 'quote' ? 'Accepted Quote' : (inv.source_kind === 'sale' ? 'Credit Sale' : 'Manual')}</div>
                    </div>
                    <div style="text-align:right;">
                        <div><strong>Bill To:</strong> ${Utils.escapeHtml(inv.customer_name || '—')}</div>
                        ${inv.customer_company ? `<div>${Utils.escapeHtml(inv.customer_company)}</div>` : ''}
                        ${inv.customer_phone   ? `<div>${Utils.escapeHtml(inv.customer_phone)}</div>`   : ''}
                        ${inv.customer_email   ? `<div>${Utils.escapeHtml(inv.customer_email)}</div>`   : ''}
                    </div>
                </div>

                <table class="table mt-3">
                    <thead><tr>
                        <th style="width:30px;">#</th>
                        <th>Description</th>
                        <th style="width:60px;text-align:center;">Qty</th>
                        <th style="text-align:right;">Unit</th>
                        <th style="text-align:right;">Line</th>
                    </tr></thead>
                    <tbody>${itemRows}</tbody>
                </table>

                <table style="margin-left:auto;font-size:14px;">
                    <tr><td style="text-align:right;padding:2px 12px;">Subtotal:</td>
                        <td style="text-align:right;">${Utils.currency(inv.subtotal)}</td></tr>
                    ${Number(inv.discount_amount) > 0
                        ? `<tr><td style="text-align:right;padding:2px 12px;">Discount:</td>
                               <td style="text-align:right;">- ${Utils.currency(inv.discount_amount)}</td></tr>` : ''}
                    ${Number(inv.tax_amount) > 0 ? `
                    <tr><td style="text-align:right;padding:2px 12px;">VAT:</td>
                        <td style="text-align:right;">${Utils.currency(inv.tax_amount)}</td></tr>` : `
                    <tr><td style="text-align:right;padding:2px 12px;color:#6b7280;font-style:italic;">VAT exempt</td>
                        <td style="text-align:right;color:#6b7280;">—</td></tr>`}
                    <tr style="font-weight:bold;background:#f5f5f5;">
                        <td style="text-align:right;padding:6px 12px;">TOTAL:</td>
                        <td style="text-align:right;padding:6px 12px;">${Utils.currency(inv.total_amount)}</td></tr>
                    <tr><td style="text-align:right;padding:2px 12px;">Paid:</td>
                        <td style="text-align:right;">${Utils.currency(inv.amount_paid || 0)}</td></tr>
                    <tr><td style="text-align:right;padding:6px 12px;color:#a00;font-weight:bold;">Balance:</td>
                        <td style="text-align:right;color:#a00;font-weight:bold;">${Utils.currency(balance)}</td></tr>
                </table>

                ${inv.notes ? `<p class="mt-2"><strong>Notes:</strong> ${Utils.escapeHtml(inv.notes)}</p>` : ''}

                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;">
                    <button class="btn btn-outline"  data-on-click="Invoices.printInvoice(${idQ})">Print</button>
                    <button class="btn btn-primary"  data-on-click="Invoices.emailInvoice(${idQ})">Email</button>
                    <button class="btn btn-success"  data-on-click="Invoices.whatsappInvoice(${idQ})">WhatsApp</button>
                    <button class="btn btn-secondary" data-on-click="Invoices.smsInvoice(${idQ})">SMS</button>
                    ${canEdit  ? `<button class="btn btn-outline"  data-on-click="Invoices.editInvoice(${idQ})">Edit</button>`   : ''}
                    ${canIssue ? `<button class="btn btn-warning"  data-on-click="Invoices.changeStatus(${idQ},'Issued')">Issue</button>` : ''}
                    ${canPay   ? `<button class="btn btn-success"  data-on-click="Invoices.recordPayment(${idQ})">Record Payment</button>` : ''}
                    ${canVoid  ? `<button class="btn btn-danger"   data-on-click="Invoices.changeStatus(${idQ},'Void')">Void</button>` : ''}
                </div>`;

            Utils.showModal(`<h3 class="modal-title">Invoice ${Utils.escapeHtml(inv.invoice_number || '')}</h3>${body}`);
        } catch (err) {
            console.error('[Invoices] openInvoice failed', err);
            Utils.toast(err.message || 'Failed to open invoice', 'error');
        }
    },

    async editInvoice(id) {
        try {
            const inv = this.state.current && String(this.state.current.invoice_id) === String(id)
                ? this.state.current
                : await API.get(`/invoices/${id}`);
            if (inv.status !== 'Draft') {
                Utils.toast('Only Draft invoices can be edited.', 'warning');
                return;
            }
            const itemRows = (inv.items || []).map((it, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td><input class="form-input" value="${Utils.escapeHtml(it.description)}" data-inv-desc="${i}"/></td>
                    <td><input class="form-input" type="number" min="0.01" step="0.01" value="${Number(it.quantity)}" data-inv-qty="${i}"/></td>
                    <td><input class="form-input" type="number" min="0" step="0.01" value="${Number(it.unit_price)}" data-inv-price="${i}"/></td>
                </tr>`).join('');
            const body = `
                <form id="inv-edit-form">
                    <div class="form-row">
                        <label>Customer Name <input class="form-input" name="customer_name" value="${Utils.escapeHtml(inv.customer_name || '')}"/></label>
                        <label>Phone <input class="form-input" name="customer_phone" value="${Utils.escapeHtml(inv.customer_phone || '')}"/></label>
                    </div>
                    <div class="form-row">
                        <label>Email <input class="form-input" name="customer_email" value="${Utils.escapeHtml(inv.customer_email || '')}"/></label>
                        <label>Company <input class="form-input" name="customer_company" value="${Utils.escapeHtml(inv.customer_company || '')}"/></label>
                    </div>
                    <div class="form-row">
                        <label>Due Date <input class="form-input" type="date" name="due_date" value="${inv.due_date ? new Date(inv.due_date).toISOString().slice(0,10) : ''}"/></label>
                        <label>Discount <input class="form-input" type="number" min="0" step="0.01" name="discount_amount" value="${Number(inv.discount_amount) || 0}"/></label>
                    </div>
                    <label>Notes <textarea class="form-input" name="notes">${Utils.escapeHtml(inv.notes || '')}</textarea></label>
                    <h4 class="mt-3">Items</h4>
                    <table class="table"><thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Unit Price</th></tr></thead>
                    <tbody>${itemRows}</tbody></table>
                    <label class="flex items-center gap-2 text-sm mt-3">
                        ${(() => {
                            // Default the box to CHECKED unless we can
                            // confidently infer the invoice was created
                            // tax-exempt. tax_amount === 0 alone is not
                            // enough — a 100%-discount invoice can be
                            // taxable but yield zero VAT. Only treat as
                            // exempt when tax_amount is 0 AND there's a
                            // non-zero taxable base (subtotal - discount).
                            const taxable = Math.max(0, Number(inv.subtotal || 0) - Number(inv.discount_amount || 0));
                            const wasExempt = Number(inv.tax_amount) === 0 && taxable > 0;
                            return `<input type="checkbox" name="apply_tax" id="inv-edit-apply-tax" ${wasExempt ? '' : 'checked'}>`;
                        })()}
                        <span>Apply VAT (16%) — tick off for tax-exempt invoices</span>
                    </label>
                    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
                        <button type="button" class="btn btn-outline" data-on-click="Utils.closeModal()">Cancel</button>
                        <button type="submit" class="btn btn-primary">Save Draft</button>
                    </div>
                </form>`;
            Utils.showModal(`<h3 class="modal-title">Edit Invoice ${Utils.escapeHtml(inv.invoice_number || '')}</h3>${body}`);
            const form = document.getElementById('inv-edit-form');
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const fd = new FormData(form);
                const items = (inv.items || []).map((_, i) => ({
                    description: form.querySelector(`[data-inv-desc="${i}"]`).value,
                    quantity:   Number(form.querySelector(`[data-inv-qty="${i}"]`).value)   || 0,
                    unit_price: Number(form.querySelector(`[data-inv-price="${i}"]`).value) || 0,
                    item_type: 'custom', discount: 0,
                }));
                const editTaxBox = document.getElementById('inv-edit-apply-tax');
                try {
                    await API.put(`/invoices/${id}`, {
                        customer_name:    fd.get('customer_name'),
                        customer_phone:   fd.get('customer_phone'),
                        customer_email:   fd.get('customer_email'),
                        customer_company: fd.get('customer_company'),
                        due_date:         fd.get('due_date') || null,
                        notes:            fd.get('notes'),
                        discount_amount:  Number(fd.get('discount_amount')) || 0,
                        apply_tax:        editTaxBox ? !!editTaxBox.checked : true,
                        items,
                    });
                    Utils.toast('Invoice updated', 'success');
                    Utils.closeModal();
                    this.loadInvoices();
                } catch (err) {
                    Utils.toast(err.message || 'Save failed', 'error');
                }
            });
        } catch (err) {
            console.error('[Invoices] editInvoice failed', err);
            Utils.toast(err.message || 'Failed to open editor', 'error');
        }
    },

    async changeStatus(id, status) {
        if (!await Utils.confirm(`Change invoice status to ${status}?`,
            { title: 'Confirm', confirmText: status, type: status === 'Void' ? 'danger' : 'primary' })) return;
        try {
            await API.patch(`/invoices/${id}/status`, { status });
            Utils.toast(`Status updated to ${status}`, 'success');
            Utils.closeModal();
            this.loadInvoices();
        } catch (err) {
            Utils.toast(err.message || 'Status change failed', 'error');
        }
    },

    async recordPayment(id) {
        try {
            const inv = this.state.current || await API.get(`/invoices/${id}`);
            const balance = Number(inv.total_amount) - Number(inv.amount_paid || 0);
            const raw = await Utils.prompt(`Amount paid (balance: ${Utils.currency(balance)}):`, {
                title: 'Record Payment', placeholder: balance.toFixed(2),
                defaultValue: balance.toFixed(2), type: 'primary',
            });
            if (!raw) return;
            const amt = Number(raw);
            if (!Number.isFinite(amt) || amt <= 0) { Utils.toast('Invalid amount', 'warning'); return; }
            await API.post(`/invoices/${id}/payment`, { amount: amt });
            Utils.toast('Payment recorded', 'success');
            Utils.closeModal();
            this.loadInvoices();
        } catch (err) {
            Utils.toast(err.message || 'Payment failed', 'error');
        }
    },

    async emailInvoice(id) {
        try {
            const inv = this.state.current || await API.get(`/invoices/${id}`);
            const email = await Utils.prompt('Customer email address:', {
                title: 'Email Invoice',
                placeholder: 'customer@example.com',
                defaultValue: inv.customer_email || '',
                type: 'primary',
            });
            if (!email) return;
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                Utils.toast('Invalid email address', 'warning');
                return;
            }
            Utils.toast('Sending invoice…', 'info');
            await API.post(`/invoices/${id}/email`, { email });
            Utils.toast(`Invoice emailed to ${email}`, 'success');
            Utils.closeModal();
        } catch (err) {
            Utils.toast(err.message || 'Email failed', 'error');
        }
    },

    async printInvoice(id) {
        try {
            const link = await API.get(`/invoices/${id}/invoice-link`);
            window.open(link.url, '_blank');
        } catch (err) {
            Utils.toast(err.message || 'Failed to open PDF', 'error');
        }
    },

    _waNumber(raw) { return String(raw || '').replace(/[^\d]/g, ''); },

    /** Plain-text invoice summary kept short enough for SMS. */
    _invoiceText(inv, signedUrl) {
        const settings = (window.App && App.settings) || {};
        const storeName = settings['store.name'] || 'Zachi Computer Centre';
        const storePhone = settings['store.phone'] || '';
        const balance = Number(inv.total_amount) - Number(inv.amount_paid || 0);
        const dueStr = inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-ZM') : '';

        // Banking / mobile-money lines (v1.0.14). Kept concise so they
        // don't blow up SMS length. Same suppression rule as PDF + email:
        // skip when the invoice is Paid OR no banking values are set.
        // Spec: appended AFTER the signed PDF link, in the form
        //   Pay to: <Bank> <AccNo>
        //   MoMo:   <Provider> <Number>
        const bankName    = settings['store.bank_name']           || '';
        const bankAcctNo  = settings['store.bank_account_number'] || '';
        const momoProv    = settings['store.momo_provider']       || '';
        const momoNum     = settings['store.momo_number']         || '';
        const hasBanking  = !!(bankName || bankAcctNo || momoProv || momoNum);
        const showBanking = hasBanking && inv.status !== 'Paid';
        const payToLine   = showBanking
            ? [bankName, bankAcctNo].filter(Boolean).join(' ').trim()
            : '';
        const momoLine    = showBanking
            ? [momoProv, momoNum].filter(Boolean).join(' ').trim()
            : '';

        const lines = [
            `*${storeName}*`,
            `Tax Invoice ${inv.invoice_number || ''}`.trim(),
            `Issued: ${new Date(inv.issue_date || inv.created_at || Date.now()).toLocaleDateString('en-ZM')}`,
            dueStr ? `Due: ${dueStr}` : '',
            '',
            `Total: ${Utils.currency(inv.total_amount)}`,
            `Paid:  ${Utils.currency(inv.amount_paid || 0)}`,
            balance > 0 ? `*Balance Due: ${Utils.currency(balance)}*` : '*PAID IN FULL*',
            '',
            signedUrl ? `Download PDF: ${signedUrl}` : '',
            payToLine ? `Pay to: ${payToLine}` : '',
            momoLine  ? `MoMo: ${momoLine}`    : '',
            storePhone ? `Contact: ${storePhone}` : '',
        ].filter(Boolean);
        return lines.join('\n');
    },

    async _gatewayStatus() {
        if (this.__gwCache && (Date.now() - this.__gwCache.t) < 60000) return this.__gwCache.s;
        try {
            const s = await API.get('/messaging/status');
            this.__gwCache = { t: Date.now(), s };
            return s;
        } catch (_) {
            return { sms: { configured: false }, whatsapp: { configured: false } };
        }
    },

    async whatsappInvoice(id) {
        try {
            const inv = this.state.current || await API.get(`/invoices/${id}`);
            let phone = inv.customer_phone || '';
            if (!phone) {
                phone = await Utils.prompt('Customer WhatsApp number (with country code):', {
                    title: 'Send Invoice via WhatsApp', placeholder: '+260...', type: 'primary',
                });
            }
            if (!phone) return;
            const num = this._waNumber(phone);
            if (num.length < 7) { Utils.toast('Invalid phone number', 'warning'); return; }

            // Mint signed PDF URL FIRST so the message body can include it.
            let signedUrl = '';
            try { signedUrl = (await API.get(`/invoices/${id}/invoice-link`)).url; }
            catch (e) { console.warn('[Invoices] could not mint signed URL:', e); }

            const body = this._invoiceText(inv, signedUrl);

            try {
                const status = await this._gatewayStatus();
                if (status.whatsapp && status.whatsapp.configured) {
                    Utils.toast('Sending WhatsApp via gateway…', 'info');
                    const r = await API.post('/messaging/whatsapp', {
                        to: '+' + num, body,
                        subject: `Invoice ${inv.invoice_number || ''}`.trim(),
                        meta: { invoice_id: inv.invoice_id || null },
                    });
                    if (r && r.ok) {
                        Utils.toast('WhatsApp sent', 'success');
                        Utils.closeModal();
                        return;
                    }
                    Utils.toast('Gateway send failed — opening WhatsApp app instead.', 'warning');
                }
            } catch (e) {
                console.warn('[Invoices] WhatsApp gateway error, falling back:', e);
            }

            const url = `https://wa.me/${num}?text=${encodeURIComponent(body)}`;
            try {
                const ok = window.Native ? await window.Native.openExternal(url) : window.open(url, '_blank');
                if (ok) { Utils.toast('Opening WhatsApp…', 'success'); Utils.closeModal(); }
                else    { Utils.toast('Could not open WhatsApp', 'error'); }
            } catch (_) {
                Utils.toast('Could not open WhatsApp', 'error');
            }
        } catch (err) {
            console.error('[Invoices] whatsappInvoice failed', err);
            Utils.toast(err.message || 'WhatsApp send failed', 'error');
        }
    },

    // ── Create one-off / manual invoice ─────────────────────────────
    //
    // Mirrors the Quotes new-quote modal: pick a customer (or fill in
    // free-text fields), add line items (product picker + free-text
    // descriptions), pick due date / discount / notes, click Save.
    // POSTs to /api/invoices which inserts a 'manual' source_kind row.
    //
    // The created invoice opens in the existing view-modal so the user
    // can immediately Issue / Email / WhatsApp / SMS / Mark-Paid it
    // without having to hunt for it in the list.
    async showCreateModal() {
        // Fetch customers + active products + services in parallel so
        // the modal opens fast. Same shape as Quotes._renderQuoteFormModal
        // — endpoints already paginate, so a 500-row cap is fine.
        let customers = [];
        let products = [];
        let services = [];
        try {
            const [customersRes, productsRes, servicesRes] = await Promise.all([
                API.get('/customers').catch(() => ({ customers: [] })),
                API.get('/products?active=1&limit=500').catch(() => ({ products: [] })),
                API.get('/services').catch(() => ({ services: [] })),
            ]);
            customers = customersRes.customers || [];
            products = productsRes.products || [];
            services = servicesRes.services || [];
        } catch (err) {
            console.warn('[Invoices] showCreateModal lookup failed (continuing with empty pickers):', err);
        }

        // Caches for O(1) name→product / name→service lookup in
        // _onCreateDescriptionInput. Products win on name collision so
        // that inventory stock movements stay accurate when the same
        // label exists in both catalogues.
        this._productByName = new Map(products.map((p) => [String(p.name).toLowerCase(), p]));
        this._serviceByName = new Map(services.map((s) => [String(s.service_name).toLowerCase(), s]));

        const E = Utils.escapeHtml || ((s) => String(s == null ? '' : s));
        // Searchable customer picker (replaces the old <select>): native
        // <input list> + <datalist> gives us free incremental search +
        // keyboard navigation with zero JS deps and no CSP friction.
        // Label format includes phone so two customers with the same
        // full name still resolve uniquely (the lookup map is keyed off
        // the visible label). _customerByLabel powers the change
        // handler — match wins → fill hidden customer_id; no match →
        // treat the typed text as a one-off payee name.
        this._customerByLabel = new Map();
        const customerListOptions = customers.map((c) => {
            const label = c.phone
                ? `${c.full_name} — ${c.phone}`
                : String(c.full_name || '');
            this._customerByLabel.set(label.toLowerCase(), c);
            return `<option value="${E(label)}"></option>`;
        }).join('');
        // Single combined datalist labelled so cashiers can see whether
        // a suggestion is a product or a service before picking it. The
        // hidden product_id / service_id fields are populated from the
        // matched catalogue entry in _onCreateDescriptionInput.
        const datalistHtml = `
            <datalist id="inv-products-list">
                ${products.map((p) => `<option value="${E(p.name)}">Product</option>`).join('')}
                ${services.map((s) => `<option value="${E(s.service_name)}">Service</option>`).join('')}
            </datalist>`;

        // Default 30-day net terms — same as the auto-issue paths.
        const due = new Date(); due.setDate(due.getDate() + 30);
        const dueDefault = due.toISOString().slice(0, 10);

        Utils.showModal(`
            <div class="modal-header">
                <h3>New Invoice</h3>
                <button class="modal-close" data-on-click="Utils.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <form id="create-invoice-form">
                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div class="form-group">
                            <label>Customer</label>
                            <input type="text" name="customer_picker" class="form-input"
                                   list="inv-customers-list"
                                   placeholder="Type to search customers…"
                                   autocomplete="off"
                                   data-on-input="Invoices._onCustomerPickerInput($el)">
                            <input type="hidden" name="customer_id" value="">
                            <datalist id="inv-customers-list">${customerListOptions}</datalist>
                            <p class="text-xs text-secondary mt-1">
                                Start typing to find an existing customer, or just type a new
                                name for a one-off payee (retainer, expense reimbursement, ad-hoc).
                            </p>
                        </div>
                        <div class="form-group">
                            <label>Due Date</label>
                            <input type="date" name="due_date" class="form-input" value="${dueDefault}">
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div class="form-group">
                            <label>Customer Name</label>
                            <input type="text" name="customer_name" class="form-input" placeholder="Required if no customer picked">
                        </div>
                        <div class="form-group">
                            <label>Phone</label>
                            <input type="text" name="customer_phone" class="form-input" placeholder="+260...">
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div class="form-group">
                            <label>Email</label>
                            <input type="email" name="customer_email" class="form-input" placeholder="customer@example.com">
                        </div>
                        <div class="form-group">
                            <label>Company</label>
                            <input type="text" name="customer_company" class="form-input">
                        </div>
                    </div>
                    <div class="mb-4">
                        <label class="block mb-2 font-medium">Items</label>
                        <p class="text-xs text-secondary mb-2">
                            Start typing to pick a product or service from your catalogue
                            (the matched price fills in automatically), or type any
                            free-text description for a one-off custom line.
                        </p>
                        <table class="w-full text-left text-sm">
                            <thead>
                                <tr class="border-b">
                                    <th class="py-2 w-1/2">Description / Product / Service</th>
                                    <th class="py-2 w-20">Qty</th>
                                    <th class="py-2 w-24">Unit Price</th>
                                    <th class="py-2 w-20">Disc.</th>
                                    <th class="py-2 w-24 text-right">Total</th>
                                    <th class="py-2 w-8"></th>
                                </tr>
                            </thead>
                            <tbody id="inv-create-lines-tbody"></tbody>
                        </table>
                        ${datalistHtml}
                        <button type="button" class="btn btn-sm btn-secondary mt-2" data-on-click="Invoices._addCreateLine()">+ Add Line Item</button>
                    </div>
                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div class="form-group">
                            <label>Discount (header)</label>
                            <input type="number" name="discount_amount" class="form-input" min="0" step="0.01" value="0" data-on-input="Invoices._updateCreateTotal()">
                        </div>
                        <div class="form-group">
                            <label>Notes</label>
                            <textarea name="notes" class="form-input" rows="2"></textarea>
                        </div>
                    </div>
                    <div class="flex justify-between items-center border-t pt-4">
                        <label class="flex items-center gap-2 text-sm">
                            <input type="checkbox" name="apply_tax" id="inv-create-apply-tax" checked
                                   data-on-change="Invoices._updateCreateTotal()">
                            <span>Apply VAT (16%) — tick off for tax-exempt invoices</span>
                        </label>
                        <div class="text-right">
                            <div class="text-sm text-secondary" id="inv-create-total-label">Total <span class="text-xs">(incl. VAT)</span></div>
                            <div class="text-xl font-bold" id="inv-create-total-display">K 0.00</div>
                        </div>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" data-on-click="Utils.closeModal()">Cancel</button>
                <button class="btn btn-primary" data-on-click="Invoices._submitCreate()">Save Draft</button>
            </div>
        `);

        // One empty starter row so the user has somewhere to type.
        this._addCreateLine();
    },

    /** Searchable customer picker handler. The visible <input> is a
     *  free-text combobox backed by a <datalist>; we look up the typed
     *  label in _customerByLabel (built in showCreateModal). On a match
     *  we capture the customer_id into the hidden field and prefill
     *  Name / Phone / Email / Company from the customers row so the
     *  cashier doesn't have to retype them. On no match (typed a brand
     *  new payee) we clear the hidden id and copy the typed text into
     *  the customer_name field — that's the "one-off / walk-in" path
     *  the server already supports. Phone / Email / Company are NOT
     *  cleared in the no-match case so the user can keep editing them
     *  freely after picking, then unpicking. */
    _onCustomerPickerInput(input) {
        const form = document.getElementById('create-invoice-form');
        if (!form) return;
        const typed = String(input.value || '').trim();
        const match = this._customerByLabel
            && this._customerByLabel.get(typed.toLowerCase());
        const hiddenId = form.querySelector('[name="customer_id"]');
        if (match) {
            hiddenId.value = match.customer_id;
            form.querySelector('[name="customer_name"]').value    = match.full_name    || '';
            form.querySelector('[name="customer_phone"]').value   = match.phone        || '';
            form.querySelector('[name="customer_email"]').value   = match.email        || '';
            form.querySelector('[name="customer_company"]').value = match.company_name || '';
        } else {
            hiddenId.value = '';
            // Treat the typed text as the one-off payee name so the
            // submit-side validation ("pick a customer or type a name")
            // is satisfied without an extra step.
            form.querySelector('[name="customer_name"]').value = typed;
        }
    },

    _addCreateLine(initial) {
        const tbody = document.getElementById('inv-create-lines-tbody');
        if (!tbody) return;
        const desc = initial && initial.description ? String(initial.description).replace(/"/g, '&quot;') : '';
        const qty  = initial && initial.quantity   != null ? initial.quantity   : 1;
        const up   = initial && initial.unit_price != null ? initial.unit_price : 0;
        const disc = initial && initial.discount   != null ? initial.discount   : 0;
        const productId = initial && initial.product_id ? initial.product_id : '';
        const serviceId = initial && initial.service_id ? initial.service_id : '';
        const itemType  = initial && initial.item_type
            ? initial.item_type
            : (productId ? 'product' : (serviceId ? 'service' : 'custom'));
        const tr = document.createElement('tr');
        tr.className = 'border-b last:border-0 inv-create-line-row';
        tr.innerHTML = `
            <td class="py-2 pr-2">
                <input type="text" name="description" list="inv-products-list" class="form-input"
                       placeholder="Item description, product or service name" required value="${desc}"
                       data-on-input="Invoices._onCreateDescriptionInput($el)">
                <input type="hidden" name="product_id" value="${productId}">
                <input type="hidden" name="service_id" value="${serviceId}">
                <input type="hidden" name="item_type" value="${itemType}">
            </td>
            <td class="py-2 pr-2">
                <input type="number" name="quantity" class="form-input" value="${qty}" min="0.01" step="any" data-on-input="Invoices._updateCreateLine($el)">
            </td>
            <td class="py-2 pr-2">
                <input type="number" name="unit_price" class="form-input" value="${up}" min="0" step="0.01" data-on-input="Invoices._updateCreateLine($el)">
            </td>
            <td class="py-2 pr-2">
                <input type="number" name="discount" class="form-input" value="${disc}" min="0" step="0.01" data-on-input="Invoices._updateCreateLine($el)">
            </td>
            <td class="py-2 text-right font-medium line-total">${Utils.currency((qty * up) - disc)}</td>
            <td class="py-2 text-right">
                <button type="button" class="text-red-500 hover:text-red-700" data-on-click="Invoices._removeCreateLine($el)">✕</button>
            </td>
        `;
        tbody.appendChild(tr);
        this._updateCreateTotal();
    },

    _removeCreateLine(btn) {
        const row = btn.closest('tr');
        const tbody = document.getElementById('inv-create-lines-tbody');
        // Always keep at least one row visible — clear the inputs instead
        // of removing it. Mirrors how Quotes.removeLineRow handles the last row.
        if (tbody && tbody.querySelectorAll('.inv-create-line-row').length <= 1) {
            row.querySelector('[name="description"]').value = '';
            row.querySelector('[name="product_id"]').value = '';
            row.querySelector('[name="service_id"]').value = '';
            row.querySelector('[name="item_type"]').value = 'custom';
            row.querySelector('[name="quantity"]').value = 1;
            row.querySelector('[name="unit_price"]').value = 0;
            row.querySelector('[name="discount"]').value = 0;
        } else {
            row.remove();
        }
        this._updateCreateTotal();
    },

    /** Match the typed name against the cached product list — auto-fill
     *  unit_price + tag the row as a product line on a real match.
     *  Mirrors Quotes._onDescriptionInput so the two builders behave the
     *  same way. */
    _onCreateDescriptionInput(input) {
        const row = input.closest('tr');
        const typed = String(input.value || '').trim().toLowerCase();
        const productMatch = this._productByName && this._productByName.get(typed);
        const serviceMatch = !productMatch && this._serviceByName && this._serviceByName.get(typed);
        const hiddenProd = row.querySelector('[name="product_id"]');
        const hiddenSvc  = row.querySelector('[name="service_id"]');
        const hiddenType = row.querySelector('[name="item_type"]');
        const priceInput = row.querySelector('[name="unit_price"]');
        if (productMatch) {
            const previousId = hiddenProd.value;
            const newId = String(productMatch.product_id);
            // Only refresh price on a real catalogue change so the user's
            // edits to unit_price aren't reset on every keystroke.
            if (previousId !== newId) {
                priceInput.value = parseFloat(productMatch.unit_price) || 0;
            }
            hiddenProd.value = newId;
            hiddenSvc.value  = '';
            hiddenType.value = 'product';
        } else if (serviceMatch) {
            const previousId = hiddenSvc.value;
            const newId = String(serviceMatch.service_id);
            if (previousId !== newId) {
                priceInput.value = parseFloat(serviceMatch.base_price) || 0;
            }
            hiddenProd.value = '';
            hiddenSvc.value  = newId;
            hiddenType.value = 'service';
        } else {
            hiddenProd.value = '';
            hiddenSvc.value  = '';
            hiddenType.value = 'custom';
        }
        this._updateCreateLine(input);
    },

    _updateCreateLine(input) {
        const row = input.closest('tr');
        const qty = parseFloat(row.querySelector('[name="quantity"]').value) || 0;
        const price = parseFloat(row.querySelector('[name="unit_price"]').value) || 0;
        const discount = parseFloat(row.querySelector('[name="discount"]').value) || 0;
        const total = (qty * price) - discount;
        row.querySelector('.line-total').textContent = Utils.currency(total);
        this._updateCreateTotal();
    },

    async _updateCreateTotal() {
        let subtotal = 0;
        document.querySelectorAll('.inv-create-line-row').forEach((row) => {
            const qty = parseFloat(row.querySelector('[name="quantity"]').value) || 0;
            const price = parseFloat(row.querySelector('[name="unit_price"]').value) || 0;
            const discount = parseFloat(row.querySelector('[name="discount"]').value) || 0;
            subtotal += (qty * price) - discount;
        });
        const headerDiscount = parseFloat(
            (document.querySelector('#create-invoice-form [name="discount_amount"]') || {}).value
        ) || 0;
        const taxable = Math.max(0, subtotal - headerDiscount);

        // Lazy-load tax rate the first time and cache on the module.
        if (this._taxRate == null) {
            try {
                const settings = await API.get('/settings');
                this._taxRate = parseFloat(settings['tax.rate']) || 0.16;
            } catch (_) {
                this._taxRate = 0.16; // Fallback matches resolveTaxRate default.
            }
        }
        // VAT toggle (defaults to applied for back-compat). The label
        // next to the total flips between "incl. VAT" / "VAT exempt"
        // so the user has a visible confirmation that ticking the box
        // actually changed the math.
        const taxBox = document.getElementById('inv-create-apply-tax');
        const applyTax = taxBox ? !!taxBox.checked : true;
        const effRate = applyTax ? this._taxRate : 0;
        const total = taxable + (taxable * effRate);
        const display = document.getElementById('inv-create-total-display');
        const label   = document.getElementById('inv-create-total-label');
        if (display) display.textContent = Utils.currency(total);
        if (label) {
            label.innerHTML = applyTax
                ? 'Total <span class="text-xs">(incl. VAT)</span>'
                : 'Total <span class="text-xs">(VAT exempt)</span>';
        }
    },

    async _submitCreate() {
        const form = document.getElementById('create-invoice-form');
        if (!form) return;
        if (!form.reportValidity()) return;
        const fd = new FormData(form);

        // Customer ID OR a typed-in customer name must be present so the
        // invoice has at least a payee on it. Server enforces a softer
        // version of this (it accepts NULL customer fields), but the
        // print/PDF layout reads better with at least a name on file.
        const customerId = fd.get('customer_id') || null;
        const customerName = String(fd.get('customer_name') || '').trim();
        if (!customerId && !customerName) {
            Utils.toast('Pick a customer or fill in the name field.', 'warning');
            return;
        }

        const items = [];
        document.querySelectorAll('.inv-create-line-row').forEach((row) => {
            const description = String(row.querySelector('[name="description"]').value || '').trim();
            if (!description) return; // Skip blank rows.
            const productId = row.querySelector('[name="product_id"]').value || null;
            const serviceId = row.querySelector('[name="service_id"]').value || null;
            const itemType  = row.querySelector('[name="item_type"]').value
                || (productId ? 'product' : (serviceId ? 'service' : 'custom'));
            items.push({
                item_type: itemType,
                product_id: productId,
                service_id: serviceId,
                description,
                quantity:   parseFloat(row.querySelector('[name="quantity"]').value)   || 0,
                unit_price: parseFloat(row.querySelector('[name="unit_price"]').value) || 0,
                discount:   parseFloat(row.querySelector('[name="discount"]').value)   || 0,
            });
        });
        if (items.length === 0) {
            Utils.toast('Please add at least one item with a description.', 'warning');
            return;
        }

        const taxBox = document.getElementById('inv-create-apply-tax');
        const applyTax = taxBox ? !!taxBox.checked : true;
        try {
            const created = await API.post('/invoices', {
                customer_id:      customerId,
                customer_name:    customerName || null,
                customer_phone:   fd.get('customer_phone') || null,
                customer_email:   fd.get('customer_email') || null,
                customer_company: fd.get('customer_company') || null,
                due_date:         fd.get('due_date') || null,
                discount_amount:  parseFloat(fd.get('discount_amount')) || 0,
                apply_tax:        applyTax,
                notes:            fd.get('notes') || null,
                items,
            });
            Utils.closeModal();
            Utils.toast('Invoice created', 'success');
            this.loadInvoices();
            // Open the just-created invoice so the user can immediately
            // Issue / Email / WhatsApp / SMS / Mark-Paid without hunting
            // for it in the list — same flow as Quotes.submitCreate.
            if (created && created.invoice_id) {
                this.openInvoice(created.invoice_id);
            }
        } catch (err) {
            console.error('[Invoices] _submitCreate failed', err);
            Utils.toast(err.message || 'Failed to create invoice', 'error');
        }
    },

    async smsInvoice(id) {
        try {
            const inv = this.state.current || await API.get(`/invoices/${id}`);
            let phone = inv.customer_phone || '';
            if (!phone) {
                phone = await Utils.prompt('Customer phone number:', {
                    title: 'Send Invoice via SMS', placeholder: '+260...', type: 'primary',
                });
            }
            if (!phone) return;
            const num = this._waNumber(phone);
            if (num.length < 7) { Utils.toast('Invalid phone number', 'warning'); return; }

            let signedUrl = '';
            try { signedUrl = (await API.get(`/invoices/${id}/invoice-link`)).url; }
            catch (e) { console.warn('[Invoices] could not mint signed URL:', e); }

            const body = this._invoiceText(inv, signedUrl);

            try {
                const status = await this._gatewayStatus();
                if (status.sms && status.sms.configured) {
                    Utils.toast('Sending SMS via gateway…', 'info');
                    const r = await API.post('/messaging/sms', { to: '+' + num, body });
                    if (r && r.ok) { Utils.toast('SMS sent', 'success'); Utils.closeModal(); return; }
                    Utils.toast('Gateway send failed — opening SMS app instead.', 'warning');
                }
            } catch (e) {
                console.warn('[Invoices] SMS gateway error, falling back:', e);
            }

            const url = `sms:+${num}?body=${encodeURIComponent(body)}`;
            try {
                const ok = window.Native ? await window.Native.openExternal(url) : window.open(url, '_blank');
                if (ok) { Utils.toast('Opening SMS…', 'success'); Utils.closeModal(); }
                else    { Utils.toast('Could not open SMS app', 'error'); }
            } catch (_) {
                Utils.toast('Could not open SMS app', 'error');
            }
        } catch (err) {
            console.error('[Invoices] smsInvoice failed', err);
            Utils.toast(err.message || 'SMS send failed', 'error');
        }
    },
};

// Expose for the data-on-* delegation resolver (matches every other
// module in public/js/*). Without this, handlers like
// `Invoices.showCreateModal` resolve to undefined and the delegation
// dispatcher logs "[delegation] unresolved handler".
window.Invoices = Invoices;
