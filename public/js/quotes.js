const Quotes = {
    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Quotes & Estimates</h1>
                    <p class="text-secondary">Create and manage customer quotes.</p>
                </div>
                <div class="header-actions">
                    <button class="btn btn-primary" onclick="Quotes.showCreateModal()">+ New Quote</button>
                </div>
            </div>

            <div class="card p-4 mb-6">
                <div class="flex gap-4 items-center">
                    <input type="text" id="quote-search" class="form-input" placeholder="Search quotes..." oninput="Utils.debounce(Quotes.loadQuotes, 300)()">
                    <select id="quote-status-filter" class="form-select" onchange="Quotes.loadQuotes()">
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
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="text-xs uppercase text-secondary border-b bg-gray-50">
                                <th class="p-4">Date</th>
                                <th class="p-4">Quote #</th>
                                <th class="p-4">Customer</th>
                                <th class="p-4 text-right">Amount</th>
                                <th class="p-4 text-center">Status</th>
                                <th class="p-4 text-right">Actions</th>
                            </tr>
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
            this.renderList(quotes);
        } catch (err) {
            console.error(err);
            Utils.toast('Failed to load quotes', 'error');
        }
    },

    renderList(quotes) {
        const tbody = document.getElementById('quotes-list-body');
        document.getElementById('quotes-count-display').textContent = `Showing ${quotes.length} quotes`;

        if (quotes.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-secondary">No quotes found.</td></tr>`;
            return;
        }

        tbody.innerHTML = quotes.map(q => `
            <tr class="border-b last:border-0 hover:bg-gray-50">
                <td class="p-4">${Utils.date(q.created_at)}</td>
                <td class="p-4 font-medium">${q.quote_number}</td>
                <td class="p-4">${q.customer_name || 'Walk-in'}</td>
                <td class="p-4 text-right">${Utils.currency(q.total_amount)}</td>
                <td class="p-4 text-center">
                    <span class="badge badge-${this.getStatusColor(q.status)}">${q.status}</span>
                </td>
                <td class="p-4 text-right">
                    <button class="btn btn-sm btn-secondary" onclick="Quotes.viewQuote('${q.quote_id}')">View</button>
                    ${q.status === 'Accepted' ?
                `<button class="btn btn-sm btn-success ml-2" onclick="Quotes.convertQuote('${q.quote_id}')">Convert to Sale</button>` : ''
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

    // --- Create Quote Modal ---

    async showCreateModal() {
        // Reuse similar logic to POS for product selection, or simple line items for now
        // For simplicity in this iteration, we will use a dynamic line-item builder

        // Fetch customers for dropdown
        let customers = [];
        try {
            const response = await API.get('/customers');
            customers = response.customers || [];
        } catch (e) { }

        const customerOptions = customers.map(c => `<option value="${c.customer_id}">${c.full_name}</option>`).join('');

        Utils.showModal(`
            <div class="modal-header">
                <h3>New Quote</h3>
                <button class="modal-close" onclick="Utils.closeModal()">✕</button>
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
                            <input type="date" name="valid_until" class="form-input" required value="${this.getDefaultValidity()}">
                        </div>
                    </div>
                    
                    <div class="mb-4">
                        <label class="block mb-2 font-medium">Items</label>
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
                        <button type="button" class="btn btn-sm btn-secondary mt-2" onclick="Quotes.addLineItem()">+ Add Line Item</button>
                    </div>

                    <div class="flex justify-end gap-4 border-t pt-4">
                        <div class="text-right">
                            <div class="text-sm text-secondary">Total Amount</div>
                            <div class="text-xl font-bold" id="quote-total-display">K 0.00</div>
                        </div>
                    </div>

                    <div class="form-group mt-4">
                        <label>Notes</label>
                        <textarea name="notes" class="form-input" rows="2"></textarea>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
                <button class="btn btn-primary" onclick="Quotes.submitCreate()">Create Quote</button>
            </div>
        `, 'modal-lg'); // Large modal

        this.addLineItem(); // Add first empty row
    },

    getDefaultValidity() {
        const d = new Date();
        d.setDate(d.getDate() + 30); // 30 days default
        return d.toISOString().split('T')[0];
    },

    async addLineItem() {
        const tbody = document.getElementById('quote-lines-tbody');
        const id = Date.now();
        const tr = document.createElement('tr');
        tr.className = 'border-b last:border-0 quote-line-row';

        // Fetch products if not already loaded in state
        if (!this.products) {
            try {
                const res = await API.get('/products?limit=1000');
                this.products = res.products || [];
            } catch (e) {
                this.products = [];
            }
        }

        // Create datalist if it doesn't exist
        if (!document.getElementById('inventory-datalist')) {
            const dl = document.createElement('datalist');
            dl.id = 'inventory-datalist';
            dl.innerHTML = this.products.map(p => `<option value="${p.name}" data-price="${p.unit_price}">${p.category || 'General'}</option>`).join('');
            document.body.appendChild(dl);
        }

        tr.innerHTML = `
            <td class="py-2 pr-2">
                <input type="text" name="description" class="form-input" list="inventory-datalist" placeholder="Search product or type description..." required 
                       oninput="Quotes.handleItemInput(this)">
            </td>
            <td class="py-2 pr-2">
                <input type="number" name="quantity" class="form-input" value="1" min="1" step="0.1" oninput="Quotes.updateLineTotal(this)">
            </td>
            <td class="py-2 pr-2">
                <input type="number" name="unit_price" class="form-input" value="0" min="0" step="0.01" oninput="Quotes.updateLineTotal(this)">
            </td>
            <td class="py-2 pr-2">
                <input type="number" name="discount" class="form-input" value="0" min="0" step="0.01" oninput="Quotes.updateLineTotal(this)">
            </td>
            <td class="py-2 text-right font-medium line-total">K 0.00</td>
            <td class="py-2 text-right">
                <button type="button" class="text-red-500 hover:text-red-700" onclick="this.closest('tr').remove(); Quotes.updateGrandTotal();">✕</button>
            </td>
        `;
        tbody.appendChild(tr);
    },

    handleItemInput(input) {
        const val = input.value;
        const option = Array.from(document.getElementById('inventory-datalist').options).find(opt => opt.value === val);
        if (option) {
            const price = option.dataset.price;
            const row = input.closest('tr');
            row.querySelector('[name="unit_price"]').value = price;
            this.updateLineTotal(input);
        }
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

        // Add Tax Estimate (Dynamic)
        total = total * (1 + Quotes.taxRate);

        document.getElementById('quote-total-display').textContent = Utils.currency(total);
    },

    async submitCreate() {
        const form = document.getElementById('create-quote-form');
        if (!form.reportValidity()) return;

        const formData = new FormData(form);
        const data = {
            customer_id: formData.get('customer_id'),
            valid_until: formData.get('valid_until'),
            notes: formData.get('notes'),
            items: []
        };

        document.querySelectorAll('.quote-line-row').forEach(row => {
            data.items.push({
                type: 'product', // Default to generic product type for manual entry
                description: row.querySelector('[name="description"]').value,
                quantity: parseFloat(row.querySelector('[name="quantity"]').value),
                unit_price: parseFloat(row.querySelector('[name="unit_price"]').value),
                discount: parseFloat(row.querySelector('[name="discount"]').value)
            });
        });

        if (data.items.length === 0) {
            Utils.toast('Please add at least one item', 'warning');
            return;
        }

        try {
            await API.post('/quotes', data);
            Utils.closeModal();
            Utils.toast('Quote created successfully', 'success');
            this.loadQuotes();
        } catch (err) {
            Utils.toast(err.message || 'Failed to create quote', 'error');
        }
    },

    // --- View Quote Details ---

    async viewQuote(id) {
        try {
            const quote = await API.get(`/quotes/${id}`);

            const itemsHtml = quote.items.map(item => `
                <tr class="border-b last:border-0">
                    <td class="py-2">${item.description}</td>
                    <td class="py-2 text-center">${item.quantity}</td>
                    <td class="py-2 text-right">${Utils.currency(item.unit_price)}</td>
                    <td class="py-2 text-right">${Utils.currency(item.line_total)}</td>
                </tr>
            `).join('');

            Utils.showModal(`
                <div class="modal-header">
                    <h3>Quote ${quote.quote_number}</h3>
                    <button class="modal-close" onclick="Utils.closeModal()">✕</button>
                </div>
                <div class="modal-body">
                    <div class="flex justify-between mb-6">
                        <div>
                            <div class="text-sm text-secondary">Customer</div>
                            <div class="font-bold text-lg">${quote.customer_name}</div>
                            <div class="text-sm">${quote.customer_phone || ''}</div>
                        </div>
                        <div class="text-right">
                            <div class="text-sm text-secondary">Status</div>
                            <span class="badge badge-${this.getStatusColor(quote.status)}">${quote.status}</span>
                            <div class="text-sm text-secondary mt-1">Valid until: ${Utils.date(quote.valid_until)}</div>
                        </div>
                    </div>

                    <table class="w-full mb-6 text-sm">
                        <thead>
                            <tr class="border-b uppercase text-xs text-secondary">
                                <th class="py-2 text-left">Description</th>
                                <th class="py-2 text-center">Qty</th>
                                <th class="py-2 text-right">Unit Price</th>
                                <th class="py-2 text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody>${itemsHtml}</tbody>
                    </table>

                    <div class="flex justify-end border-t pt-4">
                        <div class="w-48">
                            <div class="flex justify-between mb-1"><span>Subtotal:</span> <span>${Utils.currency(quote.subtotal)}</span></div>
                            <div class="flex justify-between mb-1"><span>Tax (16%):</span> <span>${Utils.currency(quote.tax_amount)}</span></div>
                            <div class="flex justify-between font-bold text-lg"><span>Total:</span> <span>${Utils.currency(quote.total_amount)}</span></div>
                        </div>
                    </div>

                    ${quote.converted_sale_id ? `
                        <div class="mt-4 p-3 bg-blue-50 text-blue-800 rounded text-sm text-center">
                            Converted to Sale #${quote.converted_sale_id}
                        </div>
                    ` : ''}

                    ${!quote.converted_sale_id ? `
                    <div class="form-group mt-4">
                         <label class="text-sm text-secondary">Update Status</label>
                         <div class="flex gap-2 mt-1">
                             <button class="btn btn-sm btn-outline" onclick="Quotes.updateStatus(${quote.quote_id}, 'Sent')">Mark Sent</button>
                             <button class="btn btn-sm btn-outline-success" onclick="Quotes.updateStatus(${quote.quote_id}, 'Accepted')">Mark Accepted</button>
                             <button class="btn btn-sm btn-outline-danger" onclick="Quotes.updateStatus(${quote.quote_id}, 'Declined')">Mark Declined</button>
                         </div>
                    </div>
                    ` : ''}
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="Utils.closeModal()">Close</button>
                    ${quote.status === 'Accepted' && !quote.converted_sale_id ?
                    `<button class="btn btn-success" onclick="Quotes.convertQuote('${quote.quote_id}')">Convert to Sale</button>` : ''
                }
                    <button class="btn btn-primary" onclick="window.print()">🖨 Print Quote</button>
                </div>
            `, 'modal-lg');
        } catch (err) {
            Utils.toast('Failed to load quote details', 'error');
        }
    },

    async updateStatus(id, status) {
        try {
            await API.patch(`/quotes/${id}/status`, { status });
            Utils.closeModal();
            Utils.toast(`Quote marked as ${status}`, 'info');
            this.loadQuotes();
        } catch (err) {
            Utils.toast('Failed to update status', 'error');
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
    }
};
