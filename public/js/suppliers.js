const Suppliers = {
    currentSupplier: null,

    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Suppliers</h1>
                    <p class="text-secondary">Manage vendors, price lists, and procurement history.</p>
                </div>
                <button class="btn btn-primary" onclick="Suppliers.openModal()">
                    <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 5v14M5 12h14"/>
                    </svg>
                    Add Supplier
                </button>
            </div>

            <div class="card mb-6">
                <div class="card-body">
                    <input type="text" id="supplier-search" class="form-input" placeholder="Search suppliers..." oninput="Suppliers.filterSuppliers(this.value)">
                </div>
            </div>

            <div id="suppliers-list" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <!-- Suppliers injected here -->
                <div class="loading-state">Loading suppliers...</div>
            </div>
        `;

        await this.loadSuppliers();
    },

    async loadSuppliers() {
        try {
            this.suppliers = await API.get('/suppliers');
            this.renderList(this.suppliers);
        } catch (err) {
            console.error(err);
            Utils.toast('Failed to load suppliers', 'error');
        }
    },

    renderList(suppliers) {
        const container = document.getElementById('suppliers-list');
        if (!container) return;

        container.innerHTML = '';

        if (suppliers.length === 0) {
            container.innerHTML = `<div class="empty-state col-span-full"><p>No suppliers found.</p></div>`;
            return;
        }

        suppliers.forEach(s => {
            const card = document.createElement('div');
            card.className = 'card hover:shadow-lg transition-shadow cursor-pointer';
            card.onclick = () => this.openModal(s.supplier_id);
            card.innerHTML = `
                <div class="card-body">
                    <div class="flex justify-between items-start mb-4">
                        <div class="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xl">
                            ${s.company_name.charAt(0)}
                        </div>
                        <span class="badge ${s.is_active ? 'badge-success' : 'badge-danger'}">
                            ${s.is_active ? 'Active' : 'Inactive'}
                        </span>
                    </div>
                    <h3 class="text-lg font-bold mb-1">${s.company_name}</h3>
                    <p class="text-secondary text-sm mb-4">${s.contact_person || 'No contact'}</p>
                    
                    <div class="space-y-2 text-sm text-secondary border-t pt-4">
                        <div class="flex items-center gap-2">
                            <span class="w-4">📞</span> ${s.phone || '-'}
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="w-4">✉️</span> ${s.email || '-'}
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    },

    filterSuppliers(query) {
        if (!this.suppliers) return;
        const lower = query.toLowerCase();
        const filtered = this.suppliers.filter(s =>
            s.company_name.toLowerCase().includes(lower) ||
            (s.contact_person && s.contact_person.toLowerCase().includes(lower))
        );
        this.renderList(filtered);
    },

    async openModal(id = null) {
        let supplier = null;
        if (id) {
            try {
                supplier = await API.get(`/suppliers/${id}`);
            } catch (err) {
                return Utils.toast('Failed to load details', 'error');
            }
        }

        const isNew = !supplier;
        const data = supplier || {};

        Utils.showModal(`
            <div class="modal-header">
                <h2 class="modal-title">${isNew ? 'Add New Supplier' : 'Supplier Details'}</h2>
                <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                ${isNew ? '' : `
                <div class="tabs mb-6">
                    <button class="tab active" onclick="Suppliers.switchTab(this, 'details')">Details</button>
                    <button class="tab" onclick="Suppliers.switchTab(this, 'pricelist')">Price List</button>
                    <button class="tab" onclick="Suppliers.switchTab(this, 'history')">PO History</button>
                </div>
                `}

                <div id="tab-details" class="tab-content active">
                    <form id="supplier-form" onsubmit="Suppliers.save(event, '${id || ''}')">
                        <div class="grid grid-cols-2 gap-4">
                            <div class="form-group col-span-2">
                                <label>Company Name</label>
                                <input type="text" name="company_name" class="form-input" value="${data.company_name || ''}" required>
                            </div>
                            <div class="form-group">
                                <label>Contact Person</label>
                                <input type="text" name="contact_person" class="form-input" value="${data.contact_person || ''}">
                            </div>
                            <div class="form-group">
                                <label>Phone</label>
                                <input type="tel" name="phone" class="form-input" value="${data.phone || ''}">
                            </div>
                            <div class="form-group">
                                <label>Email</label>
                                <input type="email" name="email" class="form-input" value="${data.email || ''}">
                            </div>
                            <div class="form-group">
                                <label>Tax ID / TPIN</label>
                                <input type="text" name="tax_id" class="form-input" value="${data.tax_id || ''}">
                            </div>
                            <div class="form-group col-span-2">
                                <label>Address</label>
                                <textarea name="address" class="form-input" rows="2">${data.address || ''}</textarea>
                            </div>
                            <div class="form-group">
                                <label>Payment Terms</label>
                                <select name="payment_terms" class="form-input">
                                    <option value="Net 30" ${data.payment_terms === 'Net 30' ? 'selected' : ''}>Net 30</option>
                                    <option value="Net 15" ${data.payment_terms === 'Net 15' ? 'selected' : ''}>Net 15</option>
                                    <option value="Due on Receipt" ${data.payment_terms === 'Due on Receipt' ? 'selected' : ''}>Due on Receipt</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Status</label>
                                <select name="is_active" class="form-input">
                                    <option value="true" ${data.is_active !== false ? 'selected' : ''}>Active</option>
                                    <option value="false" ${data.is_active === false ? 'selected' : ''}>Inactive</option>
                                </select>
                            </div>
                            <div class="form-group col-span-2">
                                <label>Notes</label>
                                <textarea name="notes" class="form-input" rows="2">${data.notes || ''}</textarea>
                            </div>
                        </div>
                        <div class="modal-footer">
                            ${!isNew ? `<button type="button" class="btn btn-danger mr-auto" onclick="Suppliers.delete('${id}')">Deactivate</button>` : ''}
                            <button type="submit" class="btn btn-primary">Save Changes</button>
                        </div>
                    </form>
                </div>

                <div id="tab-pricelist" class="tab-content hidden">
                    <div class="flex justify-between items-center mb-4">
                        <h3>Price List</h3>
                        <button type="button" class="btn btn-sm btn-outline" onclick="Suppliers.addPriceItem('${id}')">+ Add Product</button>
                    </div>
                    <div class="table-container">
                        <table class="table w-full">
                            <thead>
                                <tr>
                                    <th>Product</th>
                                    <th>Supplier SKU</th>
                                    <th>Price</th>
                                    <th>Cost</th>
                                    <th>Lead Time</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="pricelist-tbody">
                                ${this.renderPriceListRows(data.price_list)}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div id="tab-history" class="tab-content hidden">
                    <h3>Recent Purchase Orders</h3>
                    <div class="table-container">
                        <table class="table w-full">
                            <thead>
                                <tr>
                                    <th>PO #</th>
                                    <th>Date</th>
                                    <th>Status</th>
                                    <th>Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(data.recent_orders || []).map(po => `
                                    <tr>
                                        <td>${po.po_number || po.po_id}</td>
                                        <td>${new Date(po.order_date || po.created_at).toLocaleDateString()}</td>
                                        <td><span class="badge badge-${po.status === 'Received' ? 'success' : 'warning'}">${po.status}</span></td>
                                        <td>${Utils.formatCurrency(po.total_amount || 0)}</td>
                                    </tr>
                                `).join('') || '<tr><td colspan="4">No recent orders.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `);
    },

    renderPriceListRows(items) {
        if (!items || items.length === 0) return '<tr><td colspan="6">No items in price list.</td></tr>';
        return items.map(item => `
            <tr>
                <td>${item.product_name} <br><span class="text-xs text-secondary">${item.barcode || ''}</span></td>
                <td>${item.supplier_sku || '-'}</td>
                <td>${Utils.formatCurrency(item.price)}</td>
                <td>${item.minimum_order_qty || 1}</td>
                <td>${item.lead_time_days || '-'} days</td>
                <td>
                    <button class="btn-icon text-red-500" onclick="Suppliers.removePriceItem('${item.supplier_id}', '${item.product_id}')" title="Remove">
                        &times;
                    </button>
                </td>
            </tr>
        `).join('');
    },

    switchTab(btn, tabId) {
        document.querySelectorAll(".tab").forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        document.getElementById(`tab-${tabId}`).classList.remove('hidden');
    },

    async save(e, id) {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        const payload = Object.fromEntries(formData.entries());

        // boolean conversion for is_active
        if (payload.is_active) payload.is_active = payload.is_active === 'true';

        try {
            if (id) {
                await API.put(`/suppliers/${id}`, payload);
                Utils.toast('Supplier updated', 'success');
            } else {
                await API.post('/suppliers', payload);
                Utils.toast('Supplier created', 'success');
            }
            Utils.closeModal();
            this.loadSuppliers();
        } catch (err) {
            Utils.toast(err.message || 'Save failed', 'error');
        }
    },

    async delete(id) {
        if (!await Utils.confirm('Are you sure you want to deactivate this supplier?', { title: 'Deactivate Supplier', confirmText: 'Deactivate', type: 'danger' })) return;
        try {
            await API.delete(`/suppliers/${id}`);
            Utils.toast('Supplier deactivated', 'success');
            Utils.closeModal();
            this.loadSuppliers();
        } catch (err) {
            Utils.toast(err.message, 'error');
        }
    },

    async addPriceItem(supplierId) {
        // Simple prompt for now, or dedicated modal
        // Ideally a product picker.
        // Let's use a prompt for product ID for MVP or build a picker later.
        // Actually, we need a Product Picker.
        // I'll create a simple one: "Enter Product ID" is too raw.
        // I'll reuse the logic from POS or create a new "ProductPicker" utility if needed?
        // For now, let's just ask for Product Barcode or ID.

        // Show a small inline form instead of prompts
        Utils.showModal(`
            <div class="modal-header">
                <h3>Add Product to Price List</h3>
                <button class="modal-close" onclick="Utils.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Product Barcode / Name</label>
                    <input type="text" id="pl-barcode" class="form-input" placeholder="Scan or type barcode...">
                </div>
                <div class="form-group">
                    <label>Supplier Price (K)</label>
                    <input type="number" id="pl-price" class="form-input" step="0.01" min="0" placeholder="0.00">
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="Utils.closeModal()">Cancel</button>
                <button class="btn btn-primary" onclick="Suppliers._submitPriceItem('${supplierId}')">Add</button>
            </div>
        `);
    },

    async _submitPriceItem(supplierId) {
        const barcode = document.getElementById('pl-barcode')?.value?.trim();
        const price = document.getElementById('pl-price')?.value;
        if (!barcode || !price) return Utils.toast('Enter barcode and price', 'warning');

        try {
            // Look up product by barcode/name
            const products = await API.get(`/products?search=${encodeURIComponent(barcode)}`);
            if (!products || products.length === 0) return Utils.toast('Product not found', 'error');
            const product = products[0];

            await API.post(`/suppliers/${supplierId}/prices`, {
                product_id: product.product_id,
                supplier_sku: '',
                price: parseFloat(price),
                minimum_order_qty: 1,
                lead_time_days: 7
            });

            Utils.toast('Product added to price list', 'success');
            Utils.closeModal();
            this.openModal(supplierId); // Refresh
        } catch (err) {
            Utils.toast(err.message, 'error');
        }
    },

    async removePriceItem(supplierId, productId) {
        if (!await Utils.confirm('Remove this item from the price list?', { title: 'Remove Item', confirmText: 'Remove', type: 'danger' })) return;
        try {
            await API.delete(`/suppliers/${supplierId}/prices/${productId}`);
            this.openModal(supplierId); // Refresh
        } catch (err) {
            Utils.toast(err.message, 'error');
        }
    }
};
