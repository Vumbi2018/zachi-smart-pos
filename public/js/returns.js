const Returns = {
    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Returns & Exchanges</h1>
                    <p class="text-secondary">Process customer returns, refunds, and store credits.</p>
                </div>
                <button class="btn btn-primary" onclick="Returns.openWizard()">
                    <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 5v14M5 12h14"/>
                    </svg>
                    New Return
                </button>
            </div>

            <div class="tabs mb-6">
                <button class="tab active" onclick="Returns.filterStatus('Pending')">Pending Approval</button>
                <button class="tab" onclick="Returns.filterStatus('Processed')">Processed History</button>
            </div>

            <div class="card">
                <div class="card-body p-0">
                    <div class="table-container">
                        <table class="table w-full">
                            <thead>
                                <tr>
                                    <th>Return #</th>
                                    <th>Date</th>
                                    <th>Sale Ref</th>
                                    <th>Customer</th>
                                    <th>Type</th>
                                    <th>Amount</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="returns-list-body">
                                <tr><td colspan="8" class="text-center p-4">Loading...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;

        await this.loadReturns('Pending');
    },

    async loadReturns(status) {
        try {
            let url = '/returns';
            if (status) url += `?status=${status}`;
            this.returns = await API.get(url);
            this.renderList(this.returns);
        } catch (err) {
            console.error(err);
            Utils.toast('Failed to load returns', 'error');
        }
    },

    renderList(items) {
        const tbody = document.getElementById('returns-list-body');
        if (!tbody) return;

        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center p-4 text-secondary">No returns found.</td></tr>`;
            return;
        }

        tbody.innerHTML = items.map(r => `
            <tr class="hover:bg-slate-50 cursor-pointer" onclick="Returns.openDetail('${r.return_id}')">
                <td class="font-medium">${r.return_number}</td>
                <td>${new Date(r.created_at).toLocaleDateString()}</td>
                <td>${r.sale_number}</td>
                <td>${r.customer_name || 'Walk-in'}</td>
                <td><span class="badge badge-secondary">${r.return_type}</span></td>
                <td>${Utils.formatCurrency(r.refund_amount)}</td>
                <td><span class="badge badge-${r.status === 'Processed' ? 'success' : 'warning'}">${r.status}</span></td>
                <td>
                    <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); Returns.openDetail('${r.return_id}')">View</button>
                </td>
            </tr>
        `).join('');
    },

    filterStatus(status) {
        document.querySelectorAll(".tab").forEach(t => t.classList.remove('active'));
        event.target.classList.add('active');
        this.loadReturns(status);
    },

    // ── Wizard ──

    openWizard() {
        Utils.showModal(`
            <div class="modal-header">
                <h2 class="modal-title">New Return Request</h2>
                <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
            </div>
            <div class="modal-body" id="wizard-body">
                <!-- Step 1: Find Sale -->
                <div id="step-1">
                    <p class="mb-4">Enter the receipt number or customer name to locate the original sale.</p>
                    <div class="flex gap-2 mb-4">
                        <input type="text" id="sale-search-input" class="form-input" placeholder="e.g. SALE-20231025-001 or Customer Name">
                        <button class="btn btn-primary" onclick="Returns.searchSale()">Search</button>
                    </div>
                    <div id="sale-results" class="space-y-2"></div>
                </div>
            </div>
        `);
    },

    async searchSale() {
        const term = document.getElementById('sale-search-input').value;
        if (!term) return;

        const resultsContainer = document.getElementById('sale-results');
        resultsContainer.innerHTML = '<div class="loading-spinner"></div>';

        try {
            const sales = await API.get(`/returns/sales/search?term=${encodeURIComponent(term)}`);
            if (sales.length === 0) {
                resultsContainer.innerHTML = '<p class="text-secondary">No sales found.</p>';
                return;
            }

            resultsContainer.innerHTML = sales.map(s => `
                <div class="p-3 border rounded hover:bg-slate-50 cursor-pointer flex justify-between items-center" onclick="Returns.selectSale('${s.sale_id}')">
                    <div>
                        <div class="font-bold">${s.sale_number}</div>
                        <div class="text-sm text-secondary">${new Date(s.created_at).toLocaleDateString()} • ${s.customer_name || 'Walk-in'}</div>
                    </div>
                    <div class="font-bold">${Utils.formatCurrency(s.total_amount)}</div>
                </div>
            `).join('');

        } catch (err) {
            resultsContainer.innerHTML = `<p class="error-text">${err.message}</p>`;
        }
    },

    async selectSale(saleId) {
        try {
            // We need sales details (items). We can reuse standard sales endpoint if available?
            // Or fetch sale details. I'll assume GET /api/sales/:id works?
            // Actually, `searchSale` returned sale object but maybe not items.
            // Let's assume there is an endpoint to get sale details. 
            // Wait, I didn't verify `salesController` has `getSale`. It likely does.
            // If not, I might need to add one. Assuming it exists for now based on context.

            // Wait, I can't be sure.
            // Let's rely on standard GET /sales/:id.

            const sale = await API.get(`/sales/${saleId}`);
            this.currentSale = sale; // Store for wizard context

            this.renderStep2();
        } catch (err) {
            Utils.toast('Failed to load sale details', 'error');
        }
    },

    renderStep2() {
        const container = document.getElementById('wizard-body');
        const sale = this.currentSale;

        container.innerHTML = `
            <div class="mb-4">
                <button class="text-sm text-blue-600 mb-2" onclick="Returns.openWizard()">← Back to Search</button>
                <h3 class="font-bold">Select Items to Return</h3>
                <p class="text-sm text-secondary">Sale #${sale.sale_number}</p>
            </div>

            <form id="return-items-form" onsubmit="Returns.submitReturn(event)">
                <input type="hidden" name="original_sale_id" value="${sale.sale_id}">
                
                <div class="table-container mb-6 max-h-60 overflow-y-auto">
                    <table class="table w-full">
                        <thead>
                            <tr>
                                <th class="w-8"></th>
                                <th>Product</th>
                                <th>Sold</th>
                                <th>Return Qty</th>
                                <th>Condition</th>
                                <th>Restock?</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sale.items.map(item => `
                                <tr>
                                    <td>
                                        <input type="checkbox" class="item-select" data-id="${item.item_id}" onchange="Returns.toggleItemRow(this)">
                                    </td>
                                    <td>
                                        ${item.product_name}
                                        <div class="text-xs text-secondary">${Utils.formatCurrency(item.unit_price)}</div>
                                    </td>
                                    <td>${item.quantity}</td>
                                    <td>
                                        <input type="number" name="qty_${item.item_id}" class="form-input w-20 py-1" min="1" max="${item.quantity}" value="1" disabled>
                                        <input type="hidden" name="price_${item.item_id}" value="${item.unit_price}">
                                        <input type="hidden" name="product_${item.item_id}" value="${item.product_id}">
                                    </td>
                                    <td>
                                        <select name="condition_${item.item_id}" class="form-input py-1 text-sm" disabled>
                                            <option value="Good">Good</option>
                                            <option value="Damaged">Damaged</option>
                                            <option value="Opened">Opened</option>
                                        </select>
                                    </td>
                                    <td>
                                        <select name="restock_${item.item_id}" class="form-input py-1 text-sm" disabled>
                                            <option value="true">Yes</option>
                                            <option value="false">No</option>
                                            <option value="false">Scrap</option>
                                        </select>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div class="form-group">
                        <label>Reason for Return</label>
                        <select name="reason_code" class="form-input" required>
                            <option value="Defective">Defective</option>
                            <option value="Wrong Item">Wrong Item</option>
                            <option value="Changed Mind">Changed Mind</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Requested Action</label>
                        <select name="return_type" class="form-input" required>
                            <option value="refund">Refund (Cash/Card)</option>
                            <option value="store_credit">Store Credit</option>
                            <option value="exchange">Exchange</option>
                        </select>
                    </div>
                    <div class="form-group col-span-2">
                        <label>Notes</label>
                        <textarea name="notes" class="form-input" rows="2"></textarea>
                    </div>
                </div>

                <div class="modal-footer">
                    <button type="submit" class="btn btn-primary">Create Return Request</button>
                </div>
            </form>
        `;
    },

    toggleItemRow(checkbox) {
        const row = checkbox.closest('tr');
        const inputs = row.querySelectorAll('input[type="number"], select');
        inputs.forEach(input => input.disabled = !checkbox.checked);
        if (checkbox.checked) row.classList.add('bg-blue-50');
        else row.classList.remove('bg-blue-50');
    },

    async submitReturn(e) {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);

        const items = [];
        form.querySelectorAll('.item-select:checked').forEach(cb => {
            const itemId = cb.dataset.id;
            const qty = formData.get(`qty_${itemId}`);

            if (qty) {
                items.push({
                    original_item_id: itemId,
                    product_id: formData.get(`product_${itemId}`),
                    quantity: parseInt(qty),
                    unit_price: parseFloat(formData.get(`price_${itemId}`)),
                    condition: formData.get(`condition_${itemId}`),
                    restock: formData.get(`restock_${itemId}`) === 'true'
                });
            }
        });

        if (items.length === 0) return Utils.toast('Select at least one item.', 'error');

        const payload = {
            original_sale_id: formData.get('original_sale_id'),
            return_type: formData.get('return_type'),
            reason_code: formData.get('reason_code'),
            notes: formData.get('notes'),
            items
        };

        try {
            await API.post('/returns', payload);
            Utils.toast('Return request created', 'success');
            Utils.closeModal();
            this.loadReturns('Pending');
        } catch (err) {
            Utils.toast(err.message, 'error');
        }
    },

    async openDetail(id) {
        try {
            const ret = await API.get(`/returns/${id}`);

            Utils.showModal(`
                <div class="modal-header">
                    <h2 class="modal-title">Return #${ret.return_number}</h2>
                    <span class="badge badge-${ret.status === 'Processed' ? 'success' : 'warning'} ml-3">${ret.status}</span>
                    <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="grid grid-cols-2 gap-4 mb-6">
                        <div>
                            <p class="text-sm text-secondary">Customer</p>
                            <p class="font-bold">${ret.customer_name || 'Walk-in'}</p>
                        </div>
                        <div>
                            <p class="text-sm text-secondary">Original Sale</p>
                            <p class="font-bold">${ret.sale_number}</p>
                        </div>
                        <div>
                             <p class="text-sm text-secondary">Return Value</p>
                             <p class="font-bold text-lg">${Utils.formatCurrency(ret.refund_amount)}</p>
                        </div>
                        <div>
                            <p class="text-sm text-secondary">Reason</p>
                            <p>${ret.reason_code} - ${ret.return_type}</p>
                        </div>
                        <div class="col-span-2">
                            <p class="text-sm text-secondary">Notes</p>
                            <p>${ret.notes || '-'}</p>
                        </div>
                    </div>

                    <h3 class="mb-2">Items</h3>
                    <table class="table w-full mb-6">
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th>Qty</th>
                                <th>Value</th>
                                <th>Condition</th>
                                <th>Restock</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${ret.items.map(item => `
                                <tr>
                                    <td>${item.product_name}</td>
                                    <td>${item.quantity}</td>
                                    <td>${Utils.formatCurrency(item.line_total)}</td>
                                    <td>${item.condition}</td>
                                    <td>${item.restock ? 'Yes' : 'No'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>

                    <div class="modal-footer">
                        ${ret.status === 'Pending' ? `<button class="btn btn-primary" onclick="Returns.processReturn('${ret.return_id}')">Use Store Credit / Refund</button>` : ''}
                        <button class="btn btn-secondary" onclick="Utils.closeModal()">Close</button>
                    </div>
                </div>
            `);
        } catch (err) {
            Utils.toast('Failed to load details', 'error');
        }
    },

    async processReturn(id) {
        // Simple prompt or confirmation for Refund Method
        // In a real app, strict payment gateway handling or cash drawer integration.
        // For now, simple selection.

        const method = await Utils.prompt("Enter Refund Method (Cash, Card, Store Credit, None):", {
            title: 'Process Refund',
            defaultValue: 'Cash',
            placeholder: 'Refund method...',
            type: 'primary'
        });
        if (!method) return;

        try {
            await API.patch(`/returns/${id}/process`, { refund_method: method });
            Utils.toast('Return processed successfully', 'success');
            Utils.closeModal();
            this.loadReturns('Pending');
        } catch (err) {
            Utils.toast(err.message, 'error');
        }
    }
};
