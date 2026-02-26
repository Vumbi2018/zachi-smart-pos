const Purchases = {
    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Purchase Orders</h1>
                    <p class="text-secondary">Manage procurement, orders, and goods received.</p>
                </div>
                <button class="btn btn-primary" onclick="Purchases.openCreateModal()">
                    <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 5v14M5 12h14"/>
                    </svg>
                    New Purchase Order
                </button>
            </div>

            <div class="tabs mb-6">
                <button class="tab active" onclick="Purchases.filterStatus('All')">All</button>
                <button class="tab" onclick="Purchases.filterStatus('Draft')">Draft</button>
                <button class="tab" onclick="Purchases.filterStatus('Ordered')">Ordered</button>
                <button class="tab" onclick="Purchases.filterStatus('Partial')">Partial</button>
                <button class="tab" onclick="Purchases.filterStatus('Received')">Received</button>
            </div>

            <div class="card">
                <div class="card-body p-0">
                    <div class="table-container">
                        <table class="table w-full">
                            <thead>
                                <tr>
                                    <th>PO Number</th>
                                    <th>Supplier</th>
                                    <th>Date</th>
                                    <th>Status</th>
                                    <th>Amount</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="po-list-body">
                                <tr><td colspan="6" class="text-center p-4">Loading...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;

        await this.loadPOs();
    },

    async loadPOs(status = null) {
        try {
            let url = '/purchases';
            if (status && status !== 'All') url += `?status=${status}`;
            this.pos = await API.get(url);
            this.renderList(this.pos);
        } catch (err) {
            console.error(err);
            Utils.toast('Failed to load purchase orders', 'error');
        }
    },

    renderList(pos) {
        const tbody = document.getElementById('po-list-body');
        if (!tbody) return;

        if (pos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center p-4 text-secondary">No purchase orders found.</td></tr>`;
            return;
        }

        tbody.innerHTML = pos.map(po => `
            <tr class="hover:bg-slate-50 cursor-pointer" onclick="Purchases.openDetail('${po.po_id}')">
                <td class="font-medium">${po.po_number}</td>
                <td>${po.supplier_name}</td>
                <td>${new Date(po.created_at).toLocaleDateString()}</td>
                <td><span class="badge badge-${this.getStatusColor(po.status)}">${po.status}</span></td>
                <td>${Utils.formatCurrency(po.total_amount)}</td>
                <td>
                    <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); Purchases.openDetail('${po.po_id}')">View</button>
                </td>
            </tr>
        `).join('');
    },

    getStatusColor(status) {
        switch (status) {
            case 'Draft': return 'secondary';
            case 'Ordered': return 'info';
            case 'Partial': return 'warning';
            case 'Received': return 'success';
            default: return 'secondary';
        }
    },

    filterStatus(status) {
        document.querySelectorAll(".tab").forEach(t => t.classList.remove('active'));
        event.target.classList.add('active');
        this.loadPOs(status);
    },

    async openCreateModal() {
        // Step 1: Select Supplier
        const suppliers = await API.get('/suppliers');

        Utils.showModal(`
            <div class="modal-header">
                <h2 class="modal-title">New Purchase Order</h2>
                <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                <form id="create-po-form" onsubmit="Purchases.submitCreate(event)">
                    <div class="form-group">
                        <label>Supplier</label>
                        <select name="supplier_id" class="form-input" required>
                            <option value="">Select Supplier...</option>
                            ${suppliers.map(s => `<option value="${s.supplier_id}">${s.company_name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Expected Date</label>
                        <input type="date" name="expected_date" class="form-input">
                    </div>
                    <div class="form-group">
                        <label>Notes</label>
                        <textarea name="notes" class="form-input" rows="2"></textarea>
                    </div>
                    
                    <hr class="my-4">
                    <h3 class="mb-2">Items</h3>
                    <div id="po-items-container" class="space-y-2 mb-4">
                        <!-- Items added dynamically -->
                    </div>
                    <button type="button" class="btn btn-sm btn-outline w-full" onclick="Purchases.addItemRow()">+ Add Item</button>

                    <div class="modal-footer mt-6">
                        <button type="submit" class="btn btn-primary">Create Draft PO</button>
                    </div>
                </form>
            </div>
        `);

        this.itemCount = 0;
        this.addItemRow(); // Add one row by default
    },

    addItemRow() {
        const container = document.getElementById('po-items-container');
        const id = this.itemCount++;
        const row = document.createElement('div');
        row.className = 'grid grid-cols-12 gap-2 items-end';
        row.innerHTML = `
            <div class="col-span-5">
                <label class="text-xs">Product Barcode/Name</label>
                <input type="text" name="item_product_${id}" class="form-input" placeholder="Scan or Search" required onchange="Purchases.lookupProduct(this, ${id})">
                <input type="hidden" name="productId_${id}">
            </div>
            <div class="col-span-2">
                <label class="text-xs">Qty</label>
                <input type="number" name="item_qty_${id}" class="form-input" value="1" min="1" required>
            </div>
            <div class="col-span-3">
                <label class="text-xs">Cost</label>
                <input type="number" name="item_cost_${id}" class="form-input" step="0.01" required>
            </div>
            <div class="col-span-2">
                <button type="button" class="btn btn-icon text-red-500" onclick="this.parentElement.parentElement.remove()">🗑️</button>
            </div>
        `;
        container.appendChild(row);
    },

    async lookupProduct(input, id) {
        const query = input.value;
        if (!query) return;

        try {
            const res = await API.get(`/products?search=${query}`);
            if (res.length > 0) {
                const p = res[0];
                input.value = p.name;
                input.nextElementSibling.value = p.product_id;
                document.querySelector(`[name="item_cost_${id}"]`).value = p.cost_price || 0;
                Utils.toast(`Selected: ${p.name}`, 'success');
            } else {
                Utils.toast('Product not found', 'error');
                input.value = '';
            }
        } catch (err) {
            console.error(err);
        }
    },

    async submitCreate(e) {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);

        const items = [];
        // Parse items manually because of dynamic rows
        // We iterate 0 to itemCount but safe way is check form elements
        // Better: select all hidden productId inputs
        form.querySelectorAll('input[type="hidden"][name^="productId_"]').forEach(input => {
            const id = input.name.split('_')[1];
            const productId = input.value;
            const qty = form.querySelector(`[name="item_qty_${id}"]`).value;
            const cost = form.querySelector(`[name="item_cost_${id}"]`).value;

            if (productId && qty && cost) {
                items.push({
                    product_id: productId,
                    quantity: parseInt(qty),
                    unit_cost: parseFloat(cost)
                });
            }
        });

        if (items.length === 0) return Utils.toast('Please add at least one valid product', 'error');

        const payload = {
            supplier_id: formData.get('supplier_id'),
            expected_date: formData.get('expected_date'),
            notes: formData.get('notes'),
            items
        };

        try {
            await API.post('/purchases', payload);
            Utils.toast('Purchase Order created', 'success');
            Utils.closeModal();
            this.loadPOs();
        } catch (err) {
            Utils.toast(err.message, 'error');
        }
    },

    async openDetail(id) {
        try {
            const po = await API.get(`/purchases/${id}`);

            Utils.showModal(`
                <div class="modal-header">
                    <h2 class="modal-title">PO #${po.po_number}</h2>
                    <span class="badge badge-${this.getStatusColor(po.status)} ml-3">${po.status}</span>
                    <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="grid grid-cols-2 gap-4 mb-6">
                        <div>
                            <p class="text-sm text-secondary">Supplier</p>
                            <p class="font-bold">${po.supplier_name}</p>
                        </div>
                        <div>
                            <p class="text-sm text-secondary">Date</p>
                            <p class="font-bold">${new Date(po.created_at).toLocaleDateString()}</p>
                        </div>
                        <div>
                             <p class="text-sm text-secondary">Total Amount</p>
                             <p class="font-bold text-lg">${Utils.formatCurrency(po.total_amount)}</p>
                        </div>
                        <div>
                            <p class="text-sm text-secondary">Notes</p>
                            <p>${po.notes || '-'}</p>
                        </div>
                    </div>

                    <h3 class="mb-2">Items</h3>
                    <table class="table w-full mb-6">
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th>Ordered</th>
                                <th>Received</th>
                                <th>Cost</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${po.items.map(item => `
                                <tr>
                                    <td>${item.product_name}</td>
                                    <td>${item.quantity_ordered}</td>
                                    <td>${item.quantity_received}</td>
                                    <td>${Utils.formatCurrency(item.unit_cost)}</td>
                                    <td>${Utils.formatCurrency(item.line_total)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    
                    ${po.grns && po.grns.length > 0 ? `
                        <h3 class="mb-2">Goods Received Notes (GRNs)</h3>
                        <div class="space-y-2 mb-6">
                            ${po.grns.map(grn => `
                                <div class="p-3 bg-slate-50 rounded border flex justify-between">
                                    <span>${grn.grn_number}</span>
                                    <span class="text-secondary">${new Date(grn.received_date).toLocaleDateString()}</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}

                    <div class="modal-footer">
                        ${po.status === 'Draft' ? `<button class="btn btn-danger mr-auto" onclick="Purchases.deletePO('${po.po_id}')">Delete Draft</button>` : ''}
                        ${po.status !== 'Received' && po.status !== 'Draft' ? `<button class="btn btn-primary" onclick="Purchases.openReceiveModal('${po.po_id}')">Receive Goods</button>` : ''}
                        <button class="btn btn-secondary" onclick="Utils.closeModal()">Close</button>
                    </div>
                </div>
            `);
        } catch (err) {
            Utils.toast('Failed to load details', 'error');
        }
    },

    async deletePO(id) {
        if (!await Utils.confirm('Are you sure you want to delete this draft PO?', { title: 'Delete Draft PO', confirmText: 'Delete', type: 'danger' })) return;
        try {
            await API.delete(`/purchases/${id}`);
            Utils.toast('PO deleted', 'success');
            Utils.closeModal();
            this.loadPOs();
        } catch (err) {
            Utils.toast(err.message, 'error');
        }
    },

    async openReceiveModal(id) {
        try {
            const po = await API.get(`/purchases/${id}`);
            Utils.showModal(`
                <div class="modal-header">
                    <h2 class="modal-title">Receive Goods (GRN)</h2>
                    <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="grn-form" onsubmit="Purchases.submitGRN(event, '${id}')">
                        <p class="mb-4">Receive items for PO #${po.po_number}</p>
                        
                        <div class="form-group">
                            <label>Notes / Delivery Ref</label>
                            <input type="text" name="notes" class="form-input" placeholder="e.g. Delivery Docket #123">
                        </div>

                        <table class="table w-full mb-4">
                            <thead>
                                <tr>
                                    <th>Product</th>
                                    <th>Pending Qty</th>
                                    <th>Receive Now</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${po.items.map(item => {
                const pending = item.quantity_ordered - item.quantity_received;
                if (pending <= 0) return '';
                return `
                                        <tr>
                                            <td>${item.product_name}</td>
                                            <td>${pending}</td>
                                            <td>
                                                <input type="number" name="qty_${item.product_id}" class="form-input w-24" max="${pending}" min="0" value="${pending}">
                                                <input type="hidden" name="po_item_id_${item.product_id}" value="${item.item_id}">
                                                <input type="hidden" name="unit_cost_${item.product_id}" value="${item.unit_cost}">
                                            </td>
                                        </tr>
                                    `;
            }).join('')}
                            </tbody>
                        </table>
                        
                        <div class="modal-footer">
                            <button type="submit" class="btn btn-primary">Confirm Receipt</button>
                        </div>
                    </form>
                </div>
            `);
        } catch (err) {
            Utils.toast('Error preparing GRN', 'error');
        }
    },

    async submitGRN(e, poId) {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        const items = [];

        // Find all qty inputs
        form.querySelectorAll('input[type="number"][name^="qty_"]').forEach(input => {
            const qty = parseInt(input.value);
            if (qty > 0) {
                const productId = input.name.split('_')[1];
                const poItemId = form.querySelector(`[name="po_item_id_${productId}"]`).value;
                const unitCost = form.querySelector(`[name="unit_cost_${productId}"]`).value;

                items.push({
                    product_id: productId,
                    po_item_id: poItemId,
                    quantity_received: qty,
                    unit_cost: unitCost
                });
            }
        });

        if (items.length === 0) return Utils.toast('No items selected to receive.', 'error');

        try {
            await API.post(`/purchases/${poId}/receive`, {
                items,
                notes: formData.get('notes')
            });
            Utils.toast('Goods Received Note created', 'success');
            Utils.closeModal();
            this.loadPOs();
        } catch (err) {
            Utils.toast(err.message, 'error');
        }
    }
};
