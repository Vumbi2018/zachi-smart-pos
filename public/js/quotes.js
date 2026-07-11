const Quotes = {
    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Quotes & Estimates</h1>
                    <p class="text-secondary">Create and manage customer quotes.</p>
                </div>
                <div class="header-actions">
                    <button class="btn btn-primary" data-on-click="Quotes.showCreateModal()">+ New Quote</button>
                </div>
            </div>

            <div class="card p-4 mb-6">
                <div class="flex gap-4 items-center">
                    <input type="text" id="quote-search" class="form-input" placeholder="Search quotes..." data-on-input="Quotes.loadQuotesDebounced()">
                    <select id="quote-status-filter" class="form-select" data-on-change="Quotes.loadQuotes()">
                        <option value="">All Statuses</option>
                        <option value="Draft">Draft</option>
                        <option value="Sent">Sent</option>
                        <option value="Accepted">Accepted</option>
                        <option value="Declined">Declined</option>
                        <option value="Expired">Expired</option>
                        <option value="Converted">Converted</option>
                    </select>
                </div>
            </div>

            <div class="card overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse" id="quotes-table">
                        <thead id="quotes-thead">
                            <!-- Headers populated by renderList() so the
                                 sort arrows update without re-mounting. -->
                        </thead>
                        <tbody id="quotes-list-body">
                            <tr><td colspan="6" class="p-4 text-center">Loading...</td></tr>
                        </tbody>
                    </table>
                </div>
                <div class="p-4 border-t flex justify-between items-center text-sm text-secondary">
                    <span id="quotes-count-display">Showing 0 quotes</span>
                </div>
            </div>
        `;

        this.loadQuotes();
    },

    async loadQuotes() {
        const search = document.getElementById('quote-search')?.value || '';
        const status = document.getElementById('quote-status-filter')?.value || '';

        try {
            const params = new URLSearchParams();
            if (search) params.append('search', search);
            if (status) params.append('status', status);

            const quotes = await API.get(`/quotes?${params.toString()}`);
            this._lastQuotes = quotes;          // cache for client-side re-sort
            this.renderList(quotes);
        } catch (err) {
            console.error(err);
            Utils.toast('Failed to load quotes', 'error');
        }
    },

    // Lazy-init the sortable controller — defaults to newest first.
    // The arrow callback re-renders the cached row list using the
    // updated sort state without re-fetching the API.
    _ensureSorter() {
        if (this._sorter) return this._sorter;
        this._sorter = Sortable.create({
            defaultKey: 'created_at',
            defaultDir: 'desc',
            onChange: () => this.renderList(this._lastQuotes || []),
        });
        return this._sorter;
    },

    renderList(quotes) {
        const tbody = document.getElementById('quotes-list-body');
        const thead = document.getElementById('quotes-thead');
        const sort = this._ensureSorter();

        // Repaint the header so the active sort arrow updates.
        if (thead) {
            thead.innerHTML = `
                <tr class="text-xs uppercase text-secondary border-b bg-gray-50">
                    ${sort.header('Date',     'created_at',   { style: 'padding:1rem;' })}
                    ${sort.header('Quote #',  'quote_number', { style: 'padding:1rem;' })}
                    ${sort.header('Customer', 'customer_name',{ style: 'padding:1rem;' })}
                    ${sort.header('Amount',   'total_amount', { align: 'right', style: 'padding:1rem;' })}
                    ${sort.header('Status',   'status',       { align: 'center', style: 'padding:1rem;' })}
                    <th class="p-4 text-right">Actions</th>
                </tr>`;
            sort.bind(thead);
        }

        document.getElementById('quotes-count-display').textContent = `Showing ${quotes.length} quotes`;

        if (quotes.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-secondary">No quotes found.</td></tr>`;
            return;
        }

        const sorted = sort.apply(quotes);
        tbody.innerHTML = sorted.map(q => `
            <tr class="clickable-row border-b last:border-0 hover:bg-gray-50"
                data-on-click="Quotes.viewQuote('${q.quote_id}')" title="View quote">
                <td class="p-4">${Utils.date(q.created_at)}</td>
                <td class="p-4 font-medium">${q.quote_number}</td>
                <td class="p-4">${q.customer_name || 'Walk-in'}</td>
                <td class="p-4 text-right">${Utils.currency(q.total_amount)}</td>
                <td class="p-4 text-center">
                    <span class="badge badge-${this.getStatusColor(q.status)}">${q.status}</span>
                </td>
                <td class="p-4 text-right">
                    <button class="btn btn-sm btn-secondary" data-on-click="Quotes.viewQuote('${q.quote_id}')">View</button>
                    ${q.status === 'Accepted' ?
                `<button class="btn btn-sm btn-success ml-2" data-on-click="Quotes.convertQuote('${q.quote_id}')">Convert to Sale</button>` : ''
            }
                </td>
            </tr>
        `).join('');
    },

    getStatusColor(status) {
        switch (status) {
            case 'Draft': return 'secondary';
            case 'Sent': return 'info';
            case 'Accepted': return 'success';
            case 'Converted': return 'primary';
            case 'Declined': return 'danger';
            case 'Expired': return 'warning';
            default: return 'secondary';
        }
    },

    // --- Create / Edit Quote Modal (unified) ───────────────────────────

    /**
     * `showCreateModal()` and `showEditModal(id)` both delegate to the same
     * renderer so the layout, line-item builder, VAT checkbox and inventory
     * picker stay in sync. The only differences are the title, the submit
     * handler, and which fields are pre-populated.
     */
    async showCreateModal() {
        await this._renderQuoteFormModal({ mode: 'create', existing: null });
    },

    async showEditModal(id) {
        try {
            const quote = await API.get(`/quotes/${id}`);
            if (quote.converted_sale_id || !['Draft', 'Sent'].includes(quote.status)) {
                Utils.toast(`Cannot edit a quote in status "${quote.status}".`, 'warning');
                return;
            }
            await this._renderQuoteFormModal({ mode: 'edit', existing: quote });
        } catch (err) {
            console.error('[Quotes] showEditModal failed', err);
            Utils.toast('Failed to load quote for editing', 'error');
        }
    },

    async _renderQuoteFormModal({ mode, existing }) {
        const isEdit = mode === 'edit';

        // Fetch customers + active products in parallel so the form opens fast.
        const [customersRes, productsRes] = await Promise.all([
            API.get('/customers').catch(() => ({ customers: [] })),
            API.get('/products?active=1&limit=500').catch(() => ({ products: [] })),
        ]);
        const customers = customersRes.customers || [];
        const products = productsRes.products || [];

        // Cache products on the module so addLineItem's input handler can do
        // an O(1) lookup on the typed name without re-fetching.
        this._productByName = new Map(products.map(p => [String(p.name).toLowerCase(), p]));

        const esc = Utils.escapeHtml || ((s) => String(s));
        const customerOptions = customers.map(c => `
            <option value="${c.customer_id}" ${existing && existing.customer_id === c.customer_id ? 'selected' : ''}>${esc(c.full_name)}</option>
        `).join('');

        const datalistHtml = `
            <datalist id="quote-products-list">
                ${products.map(p => `<option value="${esc(p.name)}"></option>`).join('')}
            </datalist>
        `;

        const validUntilStr = existing && existing.valid_until
            ? new Date(existing.valid_until).toISOString().split('T')[0]
            : this.getDefaultValidity();

        // Default ON for create; on edit, derive from whether the existing
        // quote actually carries any tax — quotes saved with apply_tax:false
        // come back with tax_amount = 0.
        const applyTaxChecked = isEdit ? (parseFloat(existing.tax_amount) > 0) : true;
        // Remember for updateGrandTotal — set BEFORE addLineItem so the first
        // recompute sees the right value.
        this._applyTax = applyTaxChecked;

        const title = isEdit
            ? `Edit Quote ${esc(existing.quote_number || '')}`
            : 'New Quote';
        const submitLabel = isEdit ? 'Save Changes' : 'Create Quote';
        // Single-quote the UUID inside the data-on-click attribute (same
        // pattern as `qid` in the viewQuote modal). The outer attribute uses
        // double quotes, so embedded single quotes don't terminate it, and
        // the delegation parser receives a clean string literal.
        const submitOnClick = isEdit
            ? `Quotes.submitEdit('${existing.quote_id}')`
            : 'Quotes.submitCreate()';

        Utils.showModal(`
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="modal-close" data-on-click="Utils.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <form id="create-quote-form">
                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div class="form-group">
                            <label>Customer</label>
                            <select name="customer_id" class="form-select" required>
                                <option value="">Select Customer</option>
                                ${customerOptions}
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Valid Until</label>
                            <input type="date" name="valid_until" class="form-input" required value="${validUntilStr}">
                        </div>
                    </div>

                    <div class="mb-4">
                        <label class="block mb-2 font-medium">Items</label>
                        <p class="text-xs text-secondary mb-2">Start typing a product name to pick from inventory, or type any free-text description.</p>
                        <table class="w-full text-left text-sm">
                            <thead>
                                <tr class="border-b">
                                    <th class="py-2 w-1/2">Description / Product</th>
                                    <th class="py-2 w-20">Qty</th>
                                    <th class="py-2 w-24">Unit Price</th>
                                    <th class="py-2 w-20">Disc.</th>
                                    <th class="py-2 w-24 text-right">Total</th>
                                    <th class="py-2 w-8"></th>
                                </tr>
                            </thead>
                            <tbody id="quote-lines-tbody"></tbody>
                        </table>
                        ${datalistHtml}
                        <button type="button" class="btn btn-sm btn-secondary mt-2" data-on-click="Quotes.addLineItem()">+ Add Line Item</button>
                    </div>

                    <div class="flex justify-between items-center border-t pt-4">
                        <label class="flex items-center gap-2 text-sm" title="Untick to issue a VAT-exempt quote.">
                            <input type="checkbox" id="quote-apply-tax" data-on-change="Quotes._onApplyTaxToggle($checked)" ${applyTaxChecked ? 'checked' : ''}>
                            Apply VAT
                        </label>
                        <div class="text-right">
                            <div class="text-sm text-secondary">Total Amount <span id="quote-tax-hint" class="text-xs">${applyTaxChecked ? '(incl. VAT)' : '(VAT exempt)'}</span></div>
                            <div class="text-xl font-bold" id="quote-total-display">K 0.00</div>
                        </div>
                    </div>

                    <div class="form-group mt-4">
                        <label>Notes</label>
                        <textarea name="notes" class="form-input" rows="2">${existing && existing.notes ? esc(existing.notes) : ''}</textarea>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" data-on-click="Utils.closeModal()">Cancel</button>
                <button class="btn btn-primary" data-on-click="${submitOnClick}">${submitLabel}</button>
            </div>
        `, 'modal-lg');

        // Pre-fill rows. On create we add one empty row; on edit we replay
        // every existing line so the user can change anything.
        if (isEdit && Array.isArray(existing.items) && existing.items.length) {
            for (const item of existing.items) this.addLineItem(item);
        } else {
            this.addLineItem();
        }
    },

    getDefaultValidity() {
        const d = new Date();
        d.setDate(d.getDate() + 30); // 30 days default
        return d.toISOString().split('T')[0];
    },

    /** Optionally pre-fill a row with values from an existing quote_item. */
    addLineItem(initial) {
        const tbody = document.getElementById('quote-lines-tbody');
        const tr = document.createElement('tr');
        tr.className = 'border-b last:border-0 quote-line-row';
        const desc = initial && initial.description ? String(initial.description).replace(/"/g, '&quot;') : '';
        const qty  = initial && initial.quantity  != null ? initial.quantity  : 1;
        const up   = initial && initial.unit_price!= null ? initial.unit_price: 0;
        const disc = initial && initial.discount  != null ? initial.discount  : 0;
        const productId = initial && initial.product_id ? initial.product_id : '';
        const itemType  = initial && initial.item_type  ? initial.item_type  : (productId ? 'product' : 'custom');
        tr.innerHTML = `
            <td class="py-2 pr-2">
                <input type="text" name="description" list="quote-products-list" class="form-input"
                       placeholder="Item description or product name" required value="${desc}"
                       data-on-input="Quotes._onDescriptionInput($el)">
                <input type="hidden" name="product_id" value="${productId}">
                <input type="hidden" name="item_type" value="${itemType}">
            </td>
            <td class="py-2 pr-2">
                <input type="number" name="quantity" class="form-input" value="${qty}" min="0.01" step="any" data-on-input="Quotes.updateLineTotal($el)">
            </td>
            <td class="py-2 pr-2">
                <input type="number" name="unit_price" class="form-input" value="${up}" min="0" step="0.01" data-on-input="Quotes.updateLineTotal($el)">
            </td>
            <td class="py-2 pr-2">
                <input type="number" name="discount" class="form-input" value="${disc}" min="0" step="0.01" data-on-input="Quotes.updateLineTotal($el)">
            </td>
            <td class="py-2 text-right font-medium line-total">${Utils.currency((qty * up) - disc)}</td>
            <td class="py-2 text-right">
                <button type="button" class="text-red-500 hover:text-red-700" data-on-click="Quotes.removeLineRow($el)">✕</button>
            </td>
        `;
        tbody.appendChild(tr);
        this.updateGrandTotal();
    },

    /**
     * Description input handler — when the typed name exactly matches a
     * product name (case-insensitive) we tag the row as a product line and
     * auto-fill its unit price from the inventory snapshot. Anything else
     * stays a free-text "custom" line.
     */
    _onDescriptionInput(input) {
        const row = input.closest('tr');
        const typed = String(input.value || '').trim().toLowerCase();
        const match = this._productByName && this._productByName.get(typed);
        const hiddenId   = row.querySelector('[name="product_id"]');
        const hiddenType = row.querySelector('[name="item_type"]');
        const priceInput = row.querySelector('[name="unit_price"]');
        if (match) {
            const previousId = hiddenId.value;
            const newId      = String(match.product_id);
            // Always pull the inventory price when the matched product changes
            // (including the first time a product is picked). The cashier can
            // still type over the field afterwards — we only refresh on a real
            // product change, not on every keystroke for the same product.
            if (previousId !== newId) {
                priceInput.value = parseFloat(match.unit_price) || 0;
            }
            hiddenId.value   = newId;
            hiddenType.value = 'product';
        } else {
            hiddenId.value   = '';
            hiddenType.value = 'custom';
        }
        this.updateLineTotal(input);
    },

    _onApplyTaxToggle(checked) {
        this._applyTax = !!checked;
        const hint = document.getElementById('quote-tax-hint');
        if (hint) hint.textContent = this._applyTax ? '(incl. VAT)' : '(VAT exempt)';
        this.updateGrandTotal();
    },

    updateLineTotal(input) {
        const row = input.closest('tr');
        const qty = parseFloat(row.querySelector('[name="quantity"]').value) || 0;
        const price = parseFloat(row.querySelector('[name="unit_price"]').value) || 0;
        const discount = parseFloat(row.querySelector('[name="discount"]').value) || 0;
        const total = (qty * price) - discount;

        row.querySelector('.line-total').textContent = Utils.currency(total);
        this.updateGrandTotal();
    },

    async updateGrandTotal() {
        let total = 0;
        document.querySelectorAll('.quote-line-row').forEach(row => {
            const qty = parseFloat(row.querySelector('[name="quantity"]').value) || 0;
            const price = parseFloat(row.querySelector('[name="unit_price"]').value) || 0;
            const discount = parseFloat(row.querySelector('[name="discount"]').value) || 0;
            total += (qty * price) - discount;
        });

        // Fetch Tax Rate if not already loaded
        if (!Quotes.taxRate) {
            try {
                const settings = await API.get('/settings');
                Quotes.taxRate = parseFloat(settings['tax.rate']) || 0.16;
            } catch (e) {
                console.error('Error fetching tax rate:', e);
                Quotes.taxRate = 0.16; // Fallback
            }
        }

        // Apply VAT only when the checkbox is checked. _applyTax defaults
        // to true the first time _renderQuoteFormModal sets it.
        const apply = this._applyTax !== false;
        if (apply) total = total * (1 + Quotes.taxRate);

        document.getElementById('quote-total-display').textContent = Utils.currency(total);
    },

    /** Collect the form into the create/update payload shape. */
    _collectQuotePayload() {
        const form = document.getElementById('create-quote-form');
        if (!form.reportValidity()) return null;

        const formData = new FormData(form);
        const items = [];
        document.querySelectorAll('.quote-line-row').forEach(row => {
            const productId = row.querySelector('[name="product_id"]').value || null;
            const itemType  = row.querySelector('[name="item_type"]').value || (productId ? 'product' : 'custom');
            items.push({
                type: itemType,
                product_id: productId,
                description: row.querySelector('[name="description"]').value,
                quantity:   parseFloat(row.querySelector('[name="quantity"]').value),
                unit_price: parseFloat(row.querySelector('[name="unit_price"]').value),
                discount:   parseFloat(row.querySelector('[name="discount"]').value),
            });
        });

        if (items.length === 0) {
            Utils.toast('Please add at least one item', 'warning');
            return null;
        }

        return {
            customer_id: formData.get('customer_id'),
            valid_until: formData.get('valid_until'),
            notes: formData.get('notes'),
            apply_tax: this._applyTax !== false,
            items,
        };
    },

    async submitCreate() {
        const data = this._collectQuotePayload();
        if (!data) return;

        try {
            const created = await API.post('/quotes', data);
            Utils.closeModal();
            Utils.toast('Quote created successfully', 'success');
            // Reload the table in the background, then open the new quote so
            // the user can immediately Email / WhatsApp / SMS it without
            // having to hunt for it in the list.
            this.loadQuotes();
            if (created && created.quote_id) {
                this.viewQuote(created.quote_id);
            }
        } catch (err) {
            Utils.toast(err.message || 'Failed to create quote', 'error');
        }
    },

    async submitEdit(id) {
        const data = this._collectQuotePayload();
        if (!data) return;

        try {
            await API.put(`/quotes/${id}`, data);
            Utils.closeModal();
            Utils.toast('Quote updated', 'success');
            this.loadQuotes();
            this.viewQuote(id);
        } catch (err) {
            Utils.toast(err.message || 'Failed to update quote', 'error');
        }
    },

    // --- View Quote Details ---

    async viewQuote(id) {
        try {
            const quote = await API.get(`/quotes/${id}`);
            // Cache the loaded quote so the send handlers (Email / WhatsApp / SMS)
            // can build a receipt body without a second roundtrip.
            this.currentQuote = quote;

            // Pull store letterhead info from the global Settings cache
            // (loaded by app.js at boot via GET /api/settings). Falls back
            // to safe defaults so the modal still renders if settings
            // failed to load — the print stylesheet doesn't depend on
            // any of these values being non-empty.
            const s = (window.App && App.settings) || {};
            const store = {
                name:    s['store.name']    || 'Zachi Computer Centre',
                tagline: s['store.tagline'] || '',
                address: s['store.address'] || '',
                phone:   s['store.phone']   || '',
                email:   s['store.email']   || '',
                website: s['store.website'] || '',
                tpin:    s['store.tpin']    || '',
                logo:    s['store.logo_url']|| '/logo.png',
            };

            // quote_id is a UUID — must be string-quoted in inline handlers.
            // CRITICAL: `JSON.stringify` produces "<uuid>" with DOUBLE quotes,
            // which terminates the surrounding `data-on-click="..."` HTML
            // attribute — every button in this modal then renders as dead
            // markup. Wrap in single quotes instead so the outer double
            // quotes of the attribute stay intact.
            const qid = "'" + String(quote.quote_id).replace(/'/g, "\\'") + "'";

            // EVERY value below that comes from the DB or another user must
            // run through Utils.escapeHtml before reaching innerHTML. This
            // app's data-on-* delegated handler model means a single
            // attacker-controlled customer name like
            //   foo" data-on-click="App.logout()" "
            // would fire on the next click anywhere in the modal — much
            // worse than ordinary cosmetic HTML breakage.
            const E = Utils.escapeHtml;

            // Items rows
            const itemsHtml = (quote.items || []).map((item, idx) => `
                <tr>
                    <td class="qpd-center">${idx + 1}</td>
                    <td>${E(item.description)}</td>
                    <td class="qpd-center">${E(item.quantity)}</td>
                    <td class="qpd-num">${Utils.currency(item.unit_price)}</td>
                    <td class="qpd-num">${Utils.currency(item.line_total)}</td>
                </tr>
            `).join('');

            // Customer block (all fields escaped — these come straight from
            // the customers table where the cashier types them in).
            const cust = E(quote.customer_name || 'Walk-in Customer');
            const company   = quote.customer_company ? `<div>${E(quote.customer_company)}</div>`         : '';
            const custPhone = quote.customer_phone   ? `<div>Tel: ${E(quote.customer_phone)}</div>`      : '';
            const custEmail = quote.customer_email   ? `<div>${E(quote.customer_email)}</div>`           : '';

            // Quote meta
            const createdStr = new Date(quote.created_at || Date.now()).toLocaleString('en-ZM', {
                year: 'numeric', month: 'short', day: '2-digit',
                hour: '2-digit', minute: '2-digit', hour12: true
            });
            const validStr = quote.valid_until ? Utils.date(quote.valid_until) : '—';
            const staffName = E(quote.staff_name || quote.staff_username || '—');

            Utils.showModal(`
                <div class="modal-header">
                    <h3>Quote ${E(quote.quote_number)}</h3>
                    <button class="modal-close" data-on-click="Utils.closeModal()">✕</button>
                </div>
                <div class="modal-body">
                  <div class="qpd-document">
                    <!-- LETTERHEAD -->
                    <div class="qpd-letterhead">
                        <img src="${E(store.logo)}" class="qpd-logo" alt="Logo"
                             onerror="this.style.display='none'">
                        <div class="qpd-store">
                            <h2>${E(store.name)}</h2>
                            ${store.tagline ? `<div class="qpd-tagline">${E(store.tagline)}</div>` : ''}
                            ${store.address ? `<div class="qpd-contact">${E(store.address)}</div>` : ''}
                            <div class="qpd-contact">
                                ${store.phone ? `Tel: ${E(store.phone)}` : ''}
                                ${store.phone && store.email ? ' &nbsp;|&nbsp; ' : ''}
                                ${store.email ? `Email: ${E(store.email)}` : ''}
                            </div>
                            ${store.tpin ? `<div class="qpd-contact">TPIN: ${E(store.tpin)}</div>` : ''}
                        </div>
                    </div>

                    <div class="qpd-title">QUOTATION</div>

                    <!-- META: Bill-to + Quote details -->
                    <div class="qpd-meta-grid">
                        <div class="qpd-bill-to">
                            <div class="qpd-label">Bill To</div>
                            <div class="qpd-name">${cust}</div>
                            ${company}
                            ${custPhone}
                            ${custEmail}
                        </div>
                        <div class="qpd-meta-right">
                            <div class="qpd-row"><strong>Quote No:</strong> ${E(quote.quote_number || '—')}</div>
                            <div class="qpd-row"><strong>Date:</strong> ${createdStr}</div>
                            <div class="qpd-row"><strong>Valid Until:</strong> ${validStr}</div>
                            <div class="qpd-row"><strong>Status:</strong>
                                <span class="badge badge-${this.getStatusColor(quote.status)}">${quote.status}</span>
                            </div>
                            <div class="qpd-row"><strong>Prepared By:</strong> ${staffName}</div>
                        </div>
                    </div>

                    <!-- ITEMS -->
                    <table class="qpd-items-table">
                        <thead>
                            <tr>
                                <th class="qpd-center" style="width:40px;">#</th>
                                <th>Description</th>
                                <th class="qpd-center" style="width:60px;">Qty</th>
                                <th class="qpd-num" style="width:110px;">Unit Price</th>
                                <th class="qpd-num" style="width:120px;">Line Total</th>
                            </tr>
                        </thead>
                        <tbody>${itemsHtml}</tbody>
                    </table>

                    <!-- TOTALS -->
                    <div class="qpd-totals">
                        <div class="qpd-totals-box">
                            <div class="qpd-totals-row"><span>Subtotal</span><span>${Utils.currency(quote.subtotal)}</span></div>
                            ${Number(quote.discount_amount) > 0 ? `<div class="qpd-totals-row"><span>Discount</span><span>- ${Utils.currency(quote.discount_amount)}</span></div>` : ''}
                            ${Number(quote.tax_amount) > 0 ? `<div class="qpd-totals-row"><span>VAT</span><span>${Utils.currency(quote.tax_amount)}</span></div>` : ''}
                            <div class="qpd-grand"><div style="display:flex;justify-content:space-between;"><span>TOTAL</span><span>${Utils.currency(quote.total_amount)}</span></div></div>
                        </div>
                    </div>

                    ${quote.notes ? `<div class="qpd-notes"><strong>Notes:</strong> ${E(quote.notes)}</div>` : ''}

                    <!-- SIGNATURES -->
                    <div class="qpd-signatures">
                        <div class="qpd-sig-line">Authorised Signature</div>
                        <div class="qpd-sig-line">Customer Acceptance</div>
                    </div>

                    <!-- FOOTER -->
                    <div class="qpd-footer">
                        Thank you for your business.
                        ${quote.valid_until ? ` This quotation is valid until ${validStr}.` : ''}
                        <div class="qpd-prepared">Generated ${new Date().toLocaleString('en-ZM')} by ${staffName}</div>
                    </div>

                    ${quote.converted_sale_id ? `
                        <div class="no-print" data-style="margin-top:1rem;padding:0.75rem;background:#e6f4ea;color:#1e7c4a;border-radius:6px;text-align:center;">
                            ✓ Converted to Sale
                        </div>
                    ` : ''}

                    ${!quote.converted_sale_id ? `
                    <div class="form-group no-print" data-style="margin-top:1.5rem;">
                         <label class="text-sm text-secondary">Send to Customer</label>
                         <div class="flex gap-2" data-style="margin-top:0.4rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
                             <button class="btn btn-sm btn-primary"  data-on-click="Quotes.emailQuote(${qid})">📧 Email Quote</button>
                             <button class="btn btn-sm btn-success"  data-on-click="Quotes.whatsappQuote(${qid})">💬 WhatsApp</button>
                             <button class="btn btn-sm btn-outline"  data-on-click="Quotes.smsQuote(${qid})">📱 SMS</button>
                         </div>
                         <label class="text-sm text-secondary" data-style="margin-top:0.9rem;display:block;">Update Status</label>
                         <div class="flex gap-2" data-style="margin-top:0.4rem;display:flex;gap:0.5rem;">
                             <button class="btn btn-sm btn-outline" data-on-click="Quotes.updateStatus(${qid}, 'Sent')">Mark Sent</button>
                             <button class="btn btn-sm btn-outline-success" data-on-click="Quotes.updateStatus(${qid}, 'Accepted')">Mark Accepted</button>
                             <button class="btn btn-sm btn-outline-danger" data-on-click="Quotes.updateStatus(${qid}, 'Declined')">Mark Declined</button>
                         </div>
                    </div>
                    ` : ''}

                    <div class="qpd-print-tip no-print">
                        <strong>Tip:</strong> When the print dialog opens, untick
                        "Headers and footers" under "More settings" for the cleanest
                        printout.
                    </div>
                  </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" data-on-click="Utils.closeModal()">Close</button>
                    ${(['Draft', 'Sent'].includes(quote.status) && !quote.converted_sale_id) ?
                    `<button class="btn btn-warning" data-on-click="Quotes.showEditModal(${qid})">✎ Edit</button>` : ''
                }
                    ${quote.status === 'Accepted' && !quote.converted_sale_id ?
                    `<button class="btn btn-success" data-on-click="Quotes.convertQuote(${qid})">Convert to Sale</button>` : ''
                }
                    <button class="btn btn-primary" data-on-click="Quotes.printQuoteDocument()">🖨 Print Quote</button>
                </div>
            `, 'modal-lg');
        } catch (err) {
            console.error('viewQuote error:', err);
            Utils.toast('Failed to load quote details', 'error');
        }
    },

    /*
     * Toggles `body.printing-quote` so the destructive @media print rules
     * in /css/print-quote.css ONLY apply during the quote print. Without
     * this, those rules would blank Ctrl+P from any other page in the app.
     * Cleans up via the afterprint event AND a setTimeout fallback so
     * Firefox (which fires afterprint asynchronously) and Chrome (which
     * blocks until the dialog closes) both end up un-classed.
     */
    printQuoteDocument() {
        const body = document.body;
        body.classList.add('printing-quote');
        let removed = false;
        const cleanup = () => {
            if (removed) return;
            removed = true;
            body.classList.remove('printing-quote');
            window.removeEventListener('afterprint', cleanup);
        };
        window.addEventListener('afterprint', cleanup);
        try {
            window.print();
        } finally {
            setTimeout(cleanup, 1500);
        }
    },

    async updateStatus(id, status) {
        try {
            await API.patch(`/quotes/${id}/status`, { status });
            Utils.closeModal();
            Utils.toast(`Quote marked as ${status}`, 'success');
            this.loadQuotes();
        } catch (err) {
            console.error('[Quotes] updateStatus failed', { id, status, err });
            Utils.toast(err.message || 'Failed to update status', 'error');
        }
    },

    async convertQuote(id) {
        if (!await Utils.confirm('Are you sure you want to convert this quote to a sale? Stock will be deducted.', { title: 'Convert to Sale', confirmText: 'Convert', type: 'warning' })) return;

        try {
            const res = await API.post(`/quotes/${id}/convert`, {});
            Utils.closeModal();
            Utils.toast(`Quote converted to Sale ${res.sale_number}!`, 'success');
            this.loadQuotes();
        } catch (err) {
            Utils.toast(err.message || 'Conversion failed', 'error');
        }
    },

    // ── Send-to-customer helpers (mirror POS receipt sender pattern) ───────

    /** 60s-cached gateway status read so each modal open isn't another GET. */
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

    async _gatewaySend(channel, payload) {
        try {
            const r = await API.post('/messaging/' + channel, payload);
            return !!(r && r.ok);
        } catch (_) {
            return false;
        }
    },

    /** E.164-ish digit-only number for wa.me / sms: links. */
    _waNumber(raw) { return String(raw || '').replace(/[^\d]/g, ''); },

    /** Build a plain-text quote summary kept short enough for SMS.
     *  signedUrl (optional) — appended as "Download PDF: <url>" so the
     *  customer can fetch the branded copy without logging in. */
    _quoteText(quote, signedUrl) {
        const settings = (window.App && App.settings) || {};
        const storeName  = settings['store.name']    || 'Zachi Computer Centre';
        const storePhone = settings['store.phone']   || '';
        const storeAddr  = settings['store.address'] || '';
        const storeEmail = settings['store.email']   || '';
        const items = (quote.items || []).slice(0, 10).map((it) => {
            const desc = String(it.description || 'Item');
            const qty = Number(it.quantity || 1);
            const total = Number(it.line_total || (it.unit_price || 0) * qty);
            return `${qty}x ${desc} - ${Utils.currency(total)}`;
        });
        const validUntil = quote.valid_until ? new Date(quote.valid_until).toLocaleDateString('en-ZM') : '';
        const lines = [
            `*${storeName}*`,
            storeAddr ? storeAddr : '',
            [storePhone && `Tel: ${storePhone}`, storeEmail && `Email: ${storeEmail}`]
                .filter(Boolean).join(' | '),
            '',
            `Quotation ${quote.quote_number || ''}`.trim(),
            `Date: ${new Date(quote.created_at || Date.now()).toLocaleDateString('en-ZM')}`,
            validUntil ? `Valid until: ${validUntil}` : '',
            '',
            ...items,
            (quote.items || []).length > 10 ? `…and ${quote.items.length - 10} more line(s)` : '',
            '',
            `*Total: ${Utils.currency(quote.total_amount)}*`,
            '',
            signedUrl ? `Download PDF: ${signedUrl}` : '',
            'Thank you for considering us.',
        ].filter(Boolean);
        return lines.join('\n');
    },

    /** Mint a signed PDF URL for the given quote. Best-effort — returns
     *  '' on any failure so the message body still goes out. */
    async _quoteLink(id) {
        try { return (await API.get(`/quotes/${id}/quote-link`)).url || ''; }
        catch (e) { console.warn('[Quotes] quote-link mint failed:', e); return ''; }
    },

    /** Resolve the quote to act on — uses cache when ids match, else refetches. */
    async _resolveQuote(id) {
        if (this.currentQuote && String(this.currentQuote.quote_id) === String(id)) {
            return this.currentQuote;
        }
        const q = await API.get(`/quotes/${id}`);
        this.currentQuote = q;
        return q;
    },

    /** Email Quote — server-side SMTP via /api/quotes/:id/email. */
    async emailQuote(id) {
        try {
            const quote = await this._resolveQuote(id);
            const defaultEmail = quote.customer_email || '';
            const email = await Utils.prompt('Customer email address:', {
                title: 'Email Quote',
                placeholder: 'customer@example.com',
                defaultValue: defaultEmail,
                type: 'primary'
            });
            if (!email) return;
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                Utils.toast('Invalid email address', 'warning');
                return;
            }
            Utils.toast('Sending quote…', 'info');
            await API.post(`/quotes/${id}/email`, { email, auto_mark_sent: true });
            Utils.toast(`Quote emailed to ${email}`, 'success');
            Utils.closeModal();
            this.loadQuotes();
        } catch (err) {
            console.error('[Quotes] emailQuote failed', err);
            Utils.toast(err.message || 'Failed to send email', 'error');
        }
    },

    /** Send the quote via WhatsApp — gateway-first, fallback to wa.me. */
    async whatsappQuote(id) {
        try {
            const quote = await this._resolveQuote(id);
            let phone = quote.customer_phone || '';
            if (!phone) {
                phone = await Utils.prompt('Customer WhatsApp number (with country code, e.g. +260...):', {
                    title: 'Send Quote via WhatsApp',
                    placeholder: '+260...',
                    type: 'primary'
                });
            }
            if (!phone) return;
            const num = this._waNumber(phone);
            if (num.length < 7) { Utils.toast('Invalid phone number', 'warning'); return; }
            const signedUrl = await this._quoteLink(id);
            const body = this._quoteText(quote, signedUrl);

            try {
                const status = await this._gatewayStatus();
                if (status.whatsapp && status.whatsapp.configured) {
                    Utils.toast('Sending WhatsApp via gateway…', 'info');
                    const ok = await this._gatewaySend('whatsapp', {
                        to: '+' + num,
                        body,
                        subject: `Quotation ${quote.quote_number || ''}`.trim(),
                        meta: { quote_id: quote.quote_id || null },
                    });
                    if (ok) {
                        await this._markSentSilently(id, quote.status);
                        Utils.toast('WhatsApp sent', 'success');
                        Utils.closeModal();
                        this.loadQuotes();
                        return;
                    }
                    Utils.toast('Gateway send failed — opening WhatsApp app instead.', 'warning');
                }
            } catch (e) {
                console.warn('[Quotes] WhatsApp gateway error, falling back to wa.me:', e);
            }

            const url = `https://wa.me/${num}?text=${encodeURIComponent(body)}`;
            try {
                const ok = await window.Native.openExternal(url);
                if (ok) {
                    await this._markSentSilently(id, quote.status);
                    Utils.toast('Opening WhatsApp…', 'success');
                    Utils.closeModal();
                    this.loadQuotes();
                } else {
                    Utils.toast('Could not open WhatsApp', 'error');
                }
            } catch (e) {
                Utils.toast('Could not open WhatsApp', 'error');
            }
        } catch (err) {
            console.error('[Quotes] whatsappQuote failed', err);
            Utils.toast(err.message || 'Failed to send WhatsApp', 'error');
        }
    },

    /** Send the quote via SMS — gateway-first, fallback to device sms: link. */
    async smsQuote(id) {
        try {
            const quote = await this._resolveQuote(id);
            let phone = quote.customer_phone || '';
            if (!phone) {
                phone = await Utils.prompt('Customer phone number:', {
                    title: 'Send Quote via SMS',
                    placeholder: '+260...',
                    type: 'primary'
                });
            }
            if (!phone) return;
            const num = this._waNumber(phone);
            if (num.length < 7) { Utils.toast('Invalid phone number', 'warning'); return; }
            const signedUrl = await this._quoteLink(id);
            const body = this._quoteText(quote, signedUrl);

            try {
                const status = await this._gatewayStatus();
                if (status.sms && status.sms.configured) {
                    Utils.toast('Sending SMS via gateway…', 'info');
                    const ok = await this._gatewaySend('sms', {
                        to: '+' + num,
                        body,
                        meta: { quote_id: quote.quote_id || null },
                    });
                    if (ok) {
                        await this._markSentSilently(id, quote.status);
                        Utils.toast('SMS sent', 'success');
                        Utils.closeModal();
                        this.loadQuotes();
                        return;
                    }
                    Utils.toast('Gateway send failed — opening SMS app instead.', 'warning');
                }
            } catch (e) {
                console.warn('[Quotes] SMS gateway error, falling back to sms: URI:', e);
            }

            const url = `sms:${phone}?body=${encodeURIComponent(body)}`;
            try {
                const ok = await window.Native.openExternal(url);
                if (ok) {
                    await this._markSentSilently(id, quote.status);
                    Utils.toast('Opening SMS app…', 'success');
                    Utils.closeModal();
                    this.loadQuotes();
                } else {
                    Utils.toast('Could not open SMS app', 'error');
                }
            } catch (e) {
                Utils.toast('Could not open SMS app', 'error');
            }
        } catch (err) {
            console.error('[Quotes] smsQuote failed', err);
            Utils.toast(err.message || 'Failed to send SMS', 'error');
        }
    },

    /** Quietly bump a Draft quote to Sent after a successful send. */
    async _markSentSilently(id, currentStatus) {
        if (currentStatus === 'Sent' || currentStatus === 'Accepted' || currentStatus === 'Converted') return;
        try { await API.patch(`/quotes/${id}/status`, { status: 'Sent' }); }
        catch (e) { console.warn('[Quotes] auto mark Sent failed (non-fatal):', e); }
    },

    /** Remove a line-item row from the quote builder and recompute totals. */
    removeLineRow(el) {
        const tr = el && el.closest && el.closest('tr');
        if (tr) tr.remove();
        this.updateGrandTotal();
    }
};

// Debounced search invocation referenced by data-on-input on the search field.
Quotes.loadQuotesDebounced = Utils.debounce(() => Quotes.loadQuotes(), 300);

// Expose to global scope for delegated event handlers (data-on-* attributes).
window.Quotes = Quotes;
