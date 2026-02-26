const Inventory = {
    selectedIds: new Set(),
    pendingSearch: null, // set before navigating here to pre-filter the list

    async render(container) {
        this.selectedIds = new Set();
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Inventory Management</h1>
                    <p class="text-secondary">Track stock levels, audit movements, and perform stocktakes.</p>
                </div>
                <div class="flex gap-2">
                    <button class="btn btn-outline" onclick="Inventory.downloadTemplate()" title="Download CSV Template">
                        📄 Template
                    </button>
                    <button class="btn btn-outline" onclick="Inventory.triggerImport()" title="Import Products from CSV">
                        ⬆️ Import
                    </button>
                    <input type="file" id="inventory-import-file" accept=".csv" class="hidden" onchange="Inventory.handleFileSelect(this)">
                    
                    <button class="btn btn-outline mr-2" onclick="Inventory.exportProducts()" title="Export to CSV">
                        ⬇️ Export
                    </button>

                    <button class="btn btn-outline" onclick="Inventory.startStocktake()">
                        📋 Start Stocktake
                    </button>
                    <button class="btn btn-primary" onclick="Inventory.openProductModal()">
                        <i class="fas fa-plus mr-1"></i> Add Product
                    </button>
                    <button class="btn btn-outline" onclick="Inventory.openAdjustModal()">
                        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 5v14M5 12h14"/>
                        </svg>
                        Quick Adjust
                    </button>
                </div>
            </div>

            <!-- Bulk Action Toolbar (hidden until items selected) -->
            <div id="bulk-toolbar" class="hidden mb-4 p-3 rounded-lg flex items-center gap-3 flex-wrap" style="background:var(--color-primary,#1B3A5C);color:#fff;">
                <span id="bulk-count" class="font-bold text-sm">0 selected</span>
                <div class="flex gap-2 flex-wrap ml-auto">
                    <button class="btn btn-xs" style="background:#ef4444;color:#fff;border:none;" onclick="Inventory.bulkDeleteSelected()">
                        <i class="fas fa-trash mr-1"></i> Delete Selected
                    </button>
                    <button class="btn btn-xs" style="background:#f59e0b;color:#fff;border:none;" onclick="Inventory.bulkChangeCategory()">
                        <i class="fas fa-tag mr-1"></i> Set Category
                    </button>
                    <button class="btn btn-xs" style="background:#8b5cf6;color:#fff;border:none;" onclick="Inventory.bulkAdjustPrice()">
                        <i class="fas fa-percent mr-1"></i> Adjust Price %
                    </button>
                    <button class="btn btn-xs" style="background:#0ea5e9;color:#fff;border:none;" onclick="Inventory.bulkSetReorder()">
                        <i class="fas fa-layer-group mr-1"></i> Set Reorder
                    </button>
                    <button class="btn btn-xs btn-outline" style="color:#fff;border-color:#fff;" onclick="Inventory.clearSelection()">
                        ✕ Deselect All
                    </button>
                </div>
            </div>

            <div class="card mb-6">
                <div class="card-body">
                    <div class="flex gap-2">
                        <input type="text" id="inventory-search" class="form-input flex-1" placeholder="Search products by name or SKU..." oninput="Inventory.filter(this.value)">
                        <button class="btn btn-secondary" onclick="Inventory.openScannerModal()" title="Scan Barcode">
                            <i class="fas fa-barcode"></i> Scan
                        </button>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-body p-0">
                    <div class="table-container max-h-[600px] overflow-y-auto">
                        <table class="table w-full">
                            <thead>
                                <tr>
                                    <th style="width:32px;">
                                        <input type="checkbox" id="select-all-cb" title="Select All" onchange="Inventory.toggleSelectAll(this.checked)">
                                    </th>
                                    <th>S/N</th>
                                    <th>Description</th>
                                    <th>Qty (Packs)</th>
                                    <th>UoM</th>
                                    <th>Unit Qty</th>
                                    <th>Total Qty</th>
                                    <th>Pack Price</th>
                                    <th>Total Price</th>
                                    <th>Buying Price</th>
                                    <th>Selling Price</th>
                                    <th>Total Amount</th>
                                    <th>Remarks</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="inventory-list-body">
                                <tr><td colspan="14" class="text-center p-4">Loading...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;

        await this.loadInventory();
    },

    async loadInventory() {
        try {
            // Check cache
            if (App.state.inventory && (Date.now() - (App.state.lastFetch['inventory'] || 0) < 300000)) {
                this.products = App.state.inventory;
            } else {
                this.products = await API.get('/inventory');
                App.state.inventory = this.products;
                App.state.lastFetch['inventory'] = Date.now();
            }

            // If navigated here from a dashboard card, apply the pre-filter
            if (this.pendingSearch) {
                const q = this.pendingSearch;
                this.pendingSearch = null;
                const searchInput = document.getElementById('inventory-search');
                if (searchInput) searchInput.value = q;
                this.filter(q);
            } else {
                this.renderList(this.products);
            }
        } catch (err) {
            console.error(err);
            Utils.toast('Failed to load inventory', 'error');
        }
    },

    renderList(items) {
        const tbody = document.getElementById('inventory-list-body');
        if (!tbody) return;

        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="14" class="text-center p-4 text-secondary">No products found.</td></tr>`;
            return;
        }

        tbody.innerHTML = items.map((p, index) => {
            // Calculations
            const packQty = p.stock_quantity > 0 && p.items_per_pack > 0
                ? (p.stock_quantity / p.items_per_pack).toFixed(1).replace(/\.0$/, '')
                : 0;
            const packPrice = (parseFloat(p.cost_price || 0) * (p.items_per_pack || 1));
            const totalPrice = (p.stock_quantity * parseFloat(p.cost_price || 0));
            const totalAmount = (p.stock_quantity * parseFloat(p.unit_price || 0));
            const isChecked = this.selectedIds.has(p.product_id);

            return `
            <tr class="hover:bg-slate-50 text-sm cursor-pointer ${isChecked ? 'bg-blue-50' : ''}" id="inv-row-${p.product_id}" onclick="Inventory.showHistory(${p.product_id})">
                <td onclick="event.stopPropagation();">
                    <input type="checkbox" class="inv-cb" data-id="${p.product_id}"
                        ${isChecked ? 'checked' : ''}
                        onchange="Inventory.onRowCheck(${p.product_id}, this.checked)">
                </td>
                <td>${index + 1}</td>
                <td>
                    <div class="font-bold">${p.name}</div>
                    <div class="text-xs text-secondary">${p.sku || p.barcode || '-'}</div>
                </td>
                <td class="text-right font-medium">${packQty}</td>
                <td>${p.unit_of_measure || '-'}</td>
                <td class="text-right">${p.items_per_pack || 1}</td>
                <td class="text-right font-bold text-primary">${p.stock_quantity}</td>
                <td class="text-right">${Utils.formatCurrency(packPrice)}</td>
                <td class="text-right">${Utils.formatCurrency(totalPrice)}</td>
                <td class="text-right text-green-600">${Utils.formatCurrency(p.cost_price)}</td>
                <td class="text-right text-blue-600 font-bold">${Utils.formatCurrency(p.unit_price)}</td>
                <td class="text-right font-bold">${Utils.formatCurrency(totalAmount)}</td>
                <td class="text-xs text-secondary max-w-xs truncate" title="${p.remarks || ''}">${p.remarks || '-'}</td>
                <td>
                    <div class="flex gap-1">
                        <button class="btn btn-xs btn-outline" onclick="event.stopPropagation(); Inventory.showHistory(${p.product_id})" title="History"><i class="fas fa-history"></i></button>
                        <button class="btn btn-xs btn-outline" onclick="event.stopPropagation(); Inventory.openProductModal(${p.product_id})" title="Edit Details"><i class="fas fa-pencil-alt"></i></button>
                        <button class="btn btn-xs btn-outline" onclick="event.stopPropagation(); Inventory.openAdjustModal(${p.product_id})" title="Adjust Stock"><i class="fas fa-sliders-h"></i></button>
                    </div>
                </td>
            </tr>
        `}).join('');

        // Sync select-all checkbox state
        const cb = document.getElementById('select-all-cb');
        if (cb) cb.indeterminate = this.selectedIds.size > 0 && this.selectedIds.size < items.length;
    },

    filter(query) {
        if (!this.products) return;
        const lower = query.toLowerCase();
        const filtered = this.products.filter(p =>
            p.name.toLowerCase().includes(lower) ||
            (p.sku && p.sku.toLowerCase().includes(lower))
        );
        this.renderList(filtered);
    },

    // ── Bulk Selection ───────────────────────────────────────────────────────

    onRowCheck(id, checked) {
        if (checked) {
            this.selectedIds.add(id);
        } else {
            this.selectedIds.delete(id);
        }
        // Highlight row
        const row = document.getElementById(`inv-row-${id}`);
        if (row) row.classList.toggle('bg-blue-50', checked);
        this._updateBulkToolbar();
    },

    toggleSelectAll(checked) {
        const cbs = document.querySelectorAll('.inv-cb');
        cbs.forEach(cb => {
            const id = parseInt(cb.dataset.id);
            cb.checked = checked;
            if (checked) {
                this.selectedIds.add(id);
            } else {
                this.selectedIds.delete(id);
            }
            const row = document.getElementById(`inv-row-${id}`);
            if (row) row.classList.toggle('bg-blue-50', checked);
        });
        this._updateBulkToolbar();
    },

    clearSelection() {
        this.selectedIds.clear();
        document.querySelectorAll('.inv-cb').forEach(cb => cb.checked = false);
        document.querySelectorAll('[id^="inv-row-"]').forEach(r => r.classList.remove('bg-blue-50'));
        const allCb = document.getElementById('select-all-cb');
        if (allCb) { allCb.checked = false; allCb.indeterminate = false; }
        this._updateBulkToolbar();
    },

    _updateBulkToolbar() {
        const toolbar = document.getElementById('bulk-toolbar');
        const countEl = document.getElementById('bulk-count');
        const n = this.selectedIds.size;
        if (toolbar) toolbar.classList.toggle('hidden', n === 0);
        if (countEl) countEl.textContent = `${n} item${n !== 1 ? 's' : ''} selected`;
    },

    // ── Bulk Actions ─────────────────────────────────────────────────────────

    async bulkDeleteSelected() {
        const ids = [...this.selectedIds];
        if (ids.length === 0) return;
        if (!await Utils.confirm(`Delete ${ids.length} product(s)? This cannot be undone.`, { title: 'Delete Products', confirmText: 'Yes, Delete', type: 'danger' })) return;

        try {
            const res = await API.post('/products/bulk-delete', { ids });
            Utils.toast(res.message, 'success');
            this.clearSelection();
            await this.loadInventory();
        } catch (err) {
            Utils.toast(err.message || 'Bulk delete failed', 'error');
        }
    },

    async bulkChangeCategory() {
        const ids = [...this.selectedIds];
        if (ids.length === 0) return;

        // Build category list from loaded products
        const cats = [...new Set((this.products || []).map(p => p.category).filter(Boolean))].sort();
        const options = cats.map(c => `<option value="${c}">${c}</option>`).join('');

        Utils.showModal(`
            <div class="modal-header">
                <h2 class="modal-title">Set Category for ${ids.length} Product(s)</h2>
                <button class="modal-close" onclick="Utils.closeModal()">×</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">New Category</label>
                    <input list="bulk-cat-list" id="bulk-cat-input" class="form-input" placeholder="Type or choose a category">
                    <datalist id="bulk-cat-list">${options}</datalist>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="Inventory._confirmBulkCategory()">Apply</button>
                </div>
            </div>
        `);
    },

    async _confirmBulkCategory() {
        const value = document.getElementById('bulk-cat-input')?.value?.trim();
        if (!value) return Utils.toast('Please enter a category name', 'warning');
        Utils.closeModal();
        try {
            const res = await API.post('/products/bulk-update', { ids: [...this.selectedIds], action: 'category', value });
            Utils.toast(res.message, 'success');
            this.clearSelection();
            await this.loadInventory();
        } catch (err) {
            Utils.toast(err.message || 'Failed', 'error');
        }
    },

    async bulkAdjustPrice() {
        const ids = [...this.selectedIds];
        if (ids.length === 0) return;

        Utils.showModal(`
            <div class="modal-header">
                <h2 class="modal-title">Adjust Price for ${ids.length} Product(s)</h2>
                <button class="modal-close" onclick="Utils.closeModal()">×</button>
            </div>
            <div class="modal-body">
                <p class="text-secondary text-sm mb-3">Enter a percentage change. Use positive to increase, negative to decrease (e.g. 10 for +10%, -5 for -5%).</p>
                <div class="form-group">
                    <label class="form-label">% Change</label>
                    <input type="number" id="bulk-price-pct" class="form-input" placeholder="e.g. 10" step="0.1">
                </div>
                <div class="form-group">
                    <label class="form-label">Apply To</label>
                    <select id="bulk-price-field" class="form-input">
                        <option value="selling">Selling Price only</option>
                        <option value="cost">Buying Price only</option>
                        <option value="both">Both Prices</option>
                    </select>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="Inventory._confirmBulkPrice()">Apply</button>
                </div>
            </div>
        `);
    },

    async _confirmBulkPrice() {
        const value = document.getElementById('bulk-price-pct')?.value;
        const field = document.getElementById('bulk-price-field')?.value || 'selling';
        if (value === '' || isNaN(parseFloat(value))) return Utils.toast('Enter a valid percentage', 'warning');
        Utils.closeModal();
        try {
            const res = await API.post('/products/bulk-update', { ids: [...this.selectedIds], action: 'price', value: parseFloat(value), field });
            Utils.toast(res.message, 'success');
            this.clearSelection();
            await this.loadInventory();
        } catch (err) {
            Utils.toast(err.message || 'Failed', 'error');
        }
    },

    async bulkSetReorder() {
        const ids = [...this.selectedIds];
        if (ids.length === 0) return;

        Utils.showModal(`
            <div class="modal-header">
                <h2 class="modal-title">Set Reorder Level for ${ids.length} Product(s)</h2>
                <button class="modal-close" onclick="Utils.closeModal()">×</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">Reorder Level (units)</label>
                    <input type="number" id="bulk-reorder-val" class="form-input" placeholder="e.g. 10" min="0">
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="Inventory._confirmBulkReorder()">Apply</button>
                </div>
            </div>
        `);
    },

    async _confirmBulkReorder() {
        const value = document.getElementById('bulk-reorder-val')?.value;
        if (value === '' || isNaN(parseInt(value))) return Utils.toast('Enter a valid number', 'warning');
        Utils.closeModal();
        try {
            const res = await API.post('/products/bulk-update', { ids: [...this.selectedIds], action: 'reorder', value: parseInt(value) });
            Utils.toast(res.message, 'success');
            this.clearSelection();
            await this.loadInventory();
        } catch (err) {
            Utils.toast(err.message || 'Failed', 'error');
        }
    },


    async showHistory(id) {
        console.log('Inventory.showHistory called with ID:', id);
        try {
            const product = this.products.find(p => p.product_id == id);
            const name = product ? product.name : 'Product';

            const history = await API.get(`/inventory/${id}/movements`);

            Utils.showModal(`
                <div class="modal-header">
                    <h2 class="modal-title">Stock History: ${name}</h2>
                    <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="table-container max-h-96 overflow-y-auto">
                        <table class="table w-full text-sm">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Type</th>
                                    <th>Qty</th>
                                    <th>Balance</th>
                                    <th>Reason / Ref</th>
                                    <th>User</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${history.map(m => `
                                    <tr>
                                        <td>${new Date(m.created_at).toLocaleString()}</td>
                                        <td><span class="badge badge-secondary">${m.movement_type}</span></td>
                                        <td class="${m.quantity > 0 ? 'text-green-600' : 'text-red-600'} font-bold">
                                            ${m.quantity > 0 ? '+' : ''}${m.quantity}
                                        </td>
                                        <td>${m.balance_after}</td>
                                        <td>
                                            ${m.reason || '-'}
                                            ${m.reference_type ? `<div class="text-xs text-secondary">${m.reference_type.toUpperCase()} #${m.reference_id || ''}</div>` : ''}
                                        </td>
                                        <td>${m.user_name || 'System'}</td>
                                    </tr>
                                `).join('') || '<tr><td colspan="6">No history found.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="Utils.closeModal()">Close</button>
                    </div>
                </div>
            `);
        } catch (err) {
            Utils.toast('Failed to load history', 'error');
        }
    },

    openAdjustModal(productId = null) {
        console.log('Inventory.openAdjustModal called with ID:', productId);
        // Build product select options if product not pre-selected
        // If product list is large, use a search input (ProductPicker). 
        // For now, reusing standard select from loaded products (might be large but acceptable for MVP)

        const options = this.products ? this.products.map(p =>
            `<option value="${p.product_id}" ${p.product_id == productId ? 'selected' : ''}>${p.name} (Cur: ${p.stock_quantity})</option>`
        ).join('') : '';

        Utils.showModal(`
            <div class="modal-header">
                <h2 class="modal-title">Adjust Stock</h2>
                <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                <form id="adjust-form" onsubmit="Inventory.submitAdjust(event)">
                    <div class="form-group">
                        <label>Product</label>
                        <select name="product_id" class="form-input" required ${productId ? 'disabled' : ''}>
                            <option value="">Select Product...</option>
                            ${options}
                        </select>
                        ${productId ? `<input type="hidden" name="product_id" value="${productId}">` : ''}
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="form-group">
                            <label>Adjustment Type</label>
                            <select name="adjustment_type" class="form-input" required>
                                <option value="increase">Increase (+)</option>
                                <option value="decrease">Decrease (-)</option>
                                <option value="set">Set Total Qty</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Quantity (Items)</label>
                            <input type="number" name="quantity" class="form-input" min="0" required>
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-2 gap-4 mt-2">
                         <div class="form-group">
                            <label>Items Per Pack (Unit Qty)</label>
                            <input type="number" name="items_per_pack" class="form-input" min="1" placeholder="Leave empty to keep current">
                        </div>
                        <div class="form-group">
                            <label>Reason Code</label>
                            <select name="reason" class="form-input" required>
                                <option value="Damaged">Damaged</option>
                                <option value="Shrinkage">Shrinkage / Theft</option>
                                <option value="Expired">Expired</option>
                                <option value="Found">Found Inventory</option>
                                <option value="Correction">Count Correction</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                    </div>

                    <div class="form-group">
                        <label>Remarks / Notes</label>
                        <textarea name="remarks" class="form-input" rows="2" placeholder="Update remarks or add adjustment note..."></textarea>
                    </div>
                    <div class="modal-footer">
                        <button type="submit" class="btn btn-primary">Save Adjustment</button>
                    </div>
                </form>
            </div>
        `);
    },

    async submitAdjust(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const payload = Object.fromEntries(formData.entries());

        try {
            await API.post('/inventory/adjust', payload);
            Utils.toast('Stock adjusted successfully', 'success');
            Utils.closeModal();
            this.loadInventory();
        } catch (err) {
            Utils.toast(err.message, 'error');
        }
    },


    async startStocktake() {
        if (!this.products || this.products.length === 0) {
            Utils.toast('No products loaded to stocktake.', 'warning');
            return;
        }
        if (!await Utils.confirm('Start a new stocktake session? This will allow you to enter counts for all items.', { title: 'Start Stocktake', confirmText: 'Start', type: 'primary' })) return;

        const container = document.querySelector('#page-container');
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Active Stocktake</h1>
                    <p class="text-secondary">Enter actual physical counts. Variances will be calculated automatically.</p>
                </div>
                <div class="flex gap-2">
                    <button class="btn btn-outline" onclick="Inventory.downloadTemplate()">
                        📥 Download Template
                    </button>
                    <button class="btn btn-outline" onclick="document.getElementById('stocktake-upload').click()">
                        📤 Upload Counts
                    </button>
                    <input type="file" id="stocktake-upload" accept=".csv" hidden onchange="Inventory.handleFileUpload(this)">
                    
                    <button class="btn btn-secondary" onclick="Inventory.cancelStocktake()">Cancel</button>
                    <button class="btn btn-primary" onclick="Inventory.reviewStocktake()">Review & Commit</button>
                </div>
            </div>

            <div class="card">
                <div class="card-body p-0">
                    <div class="table-container">
                        <table class="table w-full">
                            <thead>
                                <tr>
                                    <th>Product</th>
                                    <th>System Qty</th>
                                    <th>Actual Qty</th>
                                    <th>Variance</th>
                                </tr>
                            </thead>
                            <tbody id="stocktake-body">
                                ${this.products.map(p => `
                                    <tr class="hover:bg-slate-50">
                                        <td>${p.name} <span class="text-xs text-secondary">(${p.sku || '-'})</span></td>
                                        <td>${p.stock_quantity}</td>
                                        <td>
                                            <input type="number" 
                                                   class="form-input w-24 py-1 stocktake-input" 
                                                   data-id="${p.product_id}" 
                                                   data-system="${p.stock_quantity}" 
                                                   value="${p.stock_quantity}" 
                                                   oninput="Inventory.calcVariance(this)">
                                        </td>
                                        <td class="variance-cell font-bold text-gray-400">0</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    },

    async downloadTemplate() {
        try {
            Utils.toast('Generating template...', 'info');
            const token = localStorage.getItem('zspos_token');
            const response = await fetch('/api/inventory/stocktake/export', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) throw new Error('Failed to download template');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `stocktake_template_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            Utils.toast('Template downloaded', 'success');
        } catch (err) {
            console.error(err);
            Utils.toast('Download failed', 'error');
        }
    },

    async handleFileUpload(input) {
        if (!input.files || input.files.length === 0) return;

        const file = input.files[0];
        const formData = new FormData();
        formData.append('file', file);

        try {
            Utils.toast('Uploading and parsing file...', 'info');
            const token = localStorage.getItem('zspos_token');
            const response = await fetch('/api/inventory/stocktake/upload', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Upload failed');

            // Apply updates
            let updateCount = 0;
            data.items.forEach(item => {
                if (item.actual_quantity === null) return; // skip unfilled rows
                const inputField = document.querySelector(`.stocktake-input[data-id="${item.product_id}"]`);
                if (inputField) {
                    inputField.value = item.actual_quantity;
                    this.calcVariance(inputField);
                    updateCount++;
                }
            });

            Utils.toast(`Updated ${updateCount} items from file.`, 'success');
            input.value = ''; // Reset input

        } catch (err) {
            console.error(err);
            Utils.toast('Upload failed: ' + err.message, 'error');
            input.value = '';
        }
    },

    calcVariance(input) {
        const row = input.closest('tr');
        const system = parseInt(input.dataset.system);
        const actual = parseInt(input.value) || 0;
        const variance = actual - system;
        const cell = row.querySelector('.variance-cell');

        cell.textContent = variance > 0 ? `+${variance}` : variance;
        cell.className = 'variance-cell font-bold ' +
            (variance === 0 ? 'text-gray-400' : (variance > 0 ? 'text-green-600' : 'text-red-600'));
    },

    async reviewStocktake() {
        const inputs = document.querySelectorAll('.stocktake-input');
        const discrepancies = [];
        const items = [];

        inputs.forEach(input => {
            const system = parseInt(input.dataset.system);
            const actual = parseInt(input.value) || 0; // Treat empty as 0? Or skip? Assuming intent is count.

            items.push({
                product_id: input.dataset.id,
                actual_quantity: actual
            });

            if (actual !== system) {
                discrepancies.push({
                    name: input.closest('tr').cells[0].innerText,
                    system,
                    actual,
                    variance: actual - system
                });
            }
        });

        if (discrepancies.length === 0) {
            if (!await Utils.confirm('No discrepancies found. Confirm stocktake?', { title: 'Confirm Stocktake', confirmText: 'Confirm', type: 'primary' })) return;
            this.commitStocktake(items, 'Regular Stocktake - No Variances');
            return;
        }

        Utils.showModal(`
            <div class="modal-header">
                <h2 class="modal-title">Review Discrepancies</h2>
                <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                <p class="mb-4">The following items have variances that will be recorded as adjustments:</p>
                <div class="table-container max-h-60 overflow-y-auto mb-4">
                    <table class="table w-full text-sm">
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th>Sys</th>
                                <th>Act</th>
                                <th>Var</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${discrepancies.map(d => `
                                <tr>
                                    <td>${d.name}</td>
                                    <td>${d.system}</td>
                                    <td>${d.actual}</td>
                                    <td class="${d.variance > 0 ? 'text-green-600' : 'text-red-600'} font-bold">
                                        ${d.variance > 0 ? '+' : ''}${d.variance}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="form-group">
                    <label>Stocktake Notes / Reference</label>
                    <input type="text" id="stocktake-notes" class="form-input" placeholder="e.g. End of Month Count">
                </div>
                <div class="modal-footer">
                    <div class="text-xs text-secondary mr-auto">${discrepancies.length} items to adjust.</div>
                    <button class="btn btn-primary" onclick="Inventory.confirmCommit()">Commit Adjustments</button>
                </div>
            </div>
        `);

        // Temporarily store items for the commit step
        this.pendingStocktakeItems = items;
    },

    async confirmCommit() {
        const notes = document.getElementById('stocktake-notes').value || 'Manual Stocktake';
        await this.commitStocktake(this.pendingStocktakeItems, notes);
    },

    async commitStocktake(items, notes) {
        try {
            await API.post('/inventory/stocktake', { items, notes });
            Utils.toast('Stocktake committed successfully', 'success');
            Utils.closeModal();
            this.render(document.querySelector('#page-container')); // Reload view
        } catch (err) {
            Utils.toast(err.message, 'error');
        }
    },

    // Helper for scanning
    async openScannerModal() {
        const modalContent = document.getElementById('modal-content');
        modalContent.innerHTML = `
          <div class="modal-header">
            <h2>Scan Barcode</h2>
            <button class="modal-close">&times;</button>
          </div>
          <div class="modal-body">
            <div id="scanner-container" style="width: 100%; height: 300px; background: #000;"></div>
            <p class="text-center text-muted mt-2">Point camera at a barcode</p>
          </div>
        `;

        document.getElementById('modal-overlay').classList.remove('hidden');

        // Close handler
        const closeBtn = modalContent.querySelector('.modal-close');
        closeBtn.onclick = () => {
            Scanner.stop();
            document.getElementById('modal-overlay').classList.add('hidden');
        };

        // Close on overlay click
        document.getElementById('modal-overlay').onclick = (e) => {
            if (e.target.id === 'modal-overlay') {
                Scanner.stop();
                document.getElementById('modal-overlay').classList.add('hidden');
            }
        };

        // Initialize scanner
        setTimeout(() => {
            Scanner.init(
                "scanner-container",
                (code) => {
                    // On Success
                    document.getElementById('modal-overlay').classList.add('hidden');
                    this.handleScanResult(code);
                    Utils.toast(`Scanned: ${code}`, 'success');
                },
                (err) => {
                    // On Error (handling internally in scanner util currently)
                }
            );
        }, 100);
    },

    handleScanResult(code) {
        if (!code) return;

        // Populate search and filter
        const searchInput = document.getElementById('inventory-search');
        if (searchInput) {
            searchInput.value = code;
            this.filter(code);
            Utils.toast(`Filtering by '${code}'`, 'info');
        }
    },

    async cancelStocktake() {
        if (await Utils.confirm('Discard changes and exit stocktake?', { title: 'Discard Stocktake', confirmText: 'Discard', type: 'warning' })) {
            this.render(document.querySelector('#page-container'));
        }
    },

    async exportProducts() {
        try {
            Utils.toast('Generating CSV...', 'info');
            const res = await fetch('/api/products/export', {
                headers: { 'Authorization': `Bearer ${API.token}` }
            });

            if (!res.ok) throw new Error('Export failed');

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `inventory_export_${new Date().toLocaleDateString('en-CA')}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            Utils.toast('Export complete', 'success');
        } catch (err) {
            Utils.toast('Export failed: ' + err.message, 'error');
        }
    },

    triggerImport() {
        document.getElementById('inventory-import-file').click();
    },

    async handleFileSelect(input) {
        if (!input.files || input.files.length === 0) return;
        const file = input.files[0];

        const formData = new FormData();
        formData.append('file', file);

        try {
            Utils.toast('Uploading...', 'info');
            const res = await fetch('/api/products/import', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${API.token}` },
                body: formData
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Import failed');

            let msg = `Imported: ${data.imported || 0}, Updated: ${data.updated || 0}`;
            if (data.errors && data.errors.length > 0) {
                msg += `. Errors: ${data.errors.length} (check console)`;
                console.warn('Import Errors:', data.errors);
            }
            Utils.toast(msg, 'success');

            // Full re-render so the table DOM is always present when data arrives
            const container = document.getElementById('page-container') || document.querySelector('.page-content');
            if (container) {
                await this.render(container);
            } else {
                this.loadInventory();
            }
        } catch (err) {
            Utils.toast(err.message, 'error');
            console.error(err);
        } finally {
            input.value = ''; // Reset
        }
    },

    async downloadTemplate() {
        try {
            window.location.href = '/api/products/import-template?token=' + API.token;
        } catch (err) {
            Utils.toast('Failed to download template', 'error');
        }
    },

    async openProductModal(productId = null) {
        try {
            const settings = await API.get('/settings');
            // Default lists if not set
            let categories = settings['inventory.categories'] || ['General', 'Stationery', 'Electronics', 'Services'];
            let uoms = settings['inventory.uoms'] || ['Piece', 'Box', 'Kg', 'Liter', 'Meter', 'Hour', 'Set'];

            // Parse if string
            if (typeof categories === 'string') try { categories = JSON.parse(categories); } catch (e) { categories = []; }
            if (typeof uoms === 'string') try { uoms = JSON.parse(uoms); } catch (e) { uoms = []; }

            let product = {};
            if (productId) {
                product = this.products.find(p => p.product_id == productId) || {};
            }

            Utils.showModal(`
                <div class="modal-header">
                    <h2 class="modal-title">${productId ? 'Edit Product' : 'Add New Product'}</h2>
                    <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="product-form" onsubmit="Inventory.saveProduct(event)">
                        ${productId ? `<input type="hidden" name="product_id" value="${productId}">` : ''}
                        
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <!-- Basic Info -->
                            <div class="form-group">
                                <label>Barcode / SKU</label>
                                <div class="flex gap-2">
                                    <input type="text" name="barcode" id="prod-barcode" class="form-input" value="${product.barcode || ''}" placeholder="Scan or enter code">
                                    <button type="button" class="btn btn-sm btn-secondary" onclick="Inventory.scanToInput('prod-barcode')" title="Scan"><i class="fas fa-barcode"></i></button>
                                </div>
                            </div>
                            <div class="form-group">
                                <label>Product Name <span class="text-red-500">*</span></label>
                                <input type="text" name="name" class="form-input" value="${product.name || ''}" required placeholder="e.g. Wireless Mouse">
                            </div>

                            <!-- Categorization -->
                            <div class="form-group">
                                <label>Category</label>
                                <select name="category" class="form-input">
                                    <option value="">Select Category...</option>
                                    ${categories.map(c => `<option value="${c}" ${product.category === c ? 'selected' : ''}>${c}</option>`).join('')}
                                </select>
                            </div>
                             <div class="form-group">
                                <label>Unit of Measure</label>
                                <select name="unit_of_measure" class="form-input">
                                    <option value="piece">Select Unit...</option>
                                    ${uoms.map(u => `<option value="${u}" ${product.unit_of_measure === u ? 'selected' : ''}>${u}</option>`).join('')}
                                </select>
                            </div>

                            <!-- Pricing -->
                            <div class="form-group">
                                <label>Cost Price (Buying)</label>
                                <input type="number" name="cost_price" class="form-input" step="0.01" value="${product.cost_price || ''}" placeholder="0.00">
                            </div>
                            <div class="form-group">
                                <label>Unit Price (Selling) <span class="text-red-500">*</span></label>
                                <input type="number" name="unit_price" class="form-input" step="0.01" value="${product.unit_price || ''}" required placeholder="0.00">
                            </div>

                            <!-- Inventory Config -->
                            <div class="form-group">
                                <label>Items Per Pack</label>
                                <input type="number" name="items_per_pack" class="form-input" min="1" value="${product.items_per_pack || 1}" placeholder="Default: 1">
                                <span class="text-xs text-secondary">Used for fractional sales (e.g. 1 Box = 12 Pieces).</span>
                            </div>
                            <div class="form-group">
                                <label>Reorder Level</label>
                                <input type="number" name="reorder_level" class="form-input" min="0" value="${product.reorder_level || 10}" placeholder="Alert when stock below...">
                            </div>
                        </div>

                        ${!productId ? `
                        <div class="form-group mt-2 border-t pt-2">
                            <label>Initial Stock Quantity</label>
                            <input type="number" name="stock_quantity" class="form-input" min="0" value="0" placeholder="0">
                            <span class="text-xs text-secondary">Set initial stock on hand. Use 'Quick Adjust' for complex updates later.</span>
                        </div>
                        ` : ''}

                        <div class="form-group mt-2">
                            <label>Description / Remarks</label>
                            <textarea name="description" class="form-input" rows="2" placeholder="Product details, location, etc.">${product.description || ''}</textarea>
                        </div>

                         <div class="form-group mt-2">
                             <label class="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" name="is_active" class="form-checkbox" ${product.is_active !== false ? 'checked' : ''}>
                                <span>Active (Available for Sale)</span>
                            </label>
                        </div>

                        <div class="modal-footer">
                            <button type="submit" class="btn btn-primary">Save Product</button>
                        </div>
                    </form>
                </div>
            `);
        } catch (err) {
            console.error(err);
            Utils.toast('Failed to load settings', 'error');
        }
    },

    async saveProduct(e) {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        const payload = Object.fromEntries(formData.entries());

        // Check required
        if (!payload.name || !payload.unit_price) {
            Utils.toast('Name and Selling Price are required', 'warning');
            return;
        }

        // Format Numbers
        payload.unit_price = parseFloat(payload.unit_price);
        payload.cost_price = payload.cost_price ? parseFloat(payload.cost_price) : 0;
        payload.items_per_pack = parseInt(payload.items_per_pack) || 1;
        payload.reorder_level = parseInt(payload.reorder_level) || 0;
        payload.stock_quantity = parseInt(payload.stock_quantity) || 0;
        payload.is_active = !!payload.is_active; // Checkbox

        const isEdit = !!payload.product_id;
        const endpoint = isEdit ? `/products/${payload.product_id}` : '/products';
        const method = isEdit ? 'PUT' : 'POST';

        try {
            await API.request(endpoint, { method, body: JSON.stringify(payload) });
            Utils.toast(`Product ${isEdit ? 'updated' : 'created'} successfully`, 'success');
            Utils.closeModal();
            this.loadInventory();
        } catch (err) {
            Utils.toast(err.message, 'error');
        }
    },

    // Helper to scan into specific input
    scanToInput(inputId) {
        const modalContent = document.getElementById('modal-content');
        // We need to keep the current modal open, so we might need a secondary modal or just a temporary scanner overlay.
        // For simplicity, let's substitute the modal content temporarily or use a dedicated scanner modal that returns.
        // BUT, Utils.showModal replaces content. 
        // Better approach: Open scanner in a way that doesn't destroy the form. 
        // Since our modal system is simple (one global modal), this is tricky.
        // Alternative: Use the existing scanner util but target the input directly without opening a full scanner modal UI?
        // No, scanner needs UI.
        // Workaround: Alert user to use a physical scanner or implement a more complex modal stack later.
        // For now, let's just show a toast "Please use physical scanner or type manually" to manage expectations, 
        // OR implement a simple "Scanner Mode" that overlays the video on top of the form.

        // Let's try a simple overlay approach
        const scannerOverlay = document.createElement('div');
        scannerOverlay.id = 'temp-scanner-overlay';
        scannerOverlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:2000;display:flex;flex-direction:column;align-items:center;justify-content:center;';
        scannerOverlay.innerHTML = `
            <div id="temp-scanner-container" style="width:100%;max-width:500px;height:350px;background:#000;"></div>
            <button class="btn btn-secondary mt-4" id="close-temp-scanner">Close</button>
        `;
        document.body.appendChild(scannerOverlay);

        setTimeout(() => {
            Scanner.init("temp-scanner-container", (code) => {
                document.getElementById(inputId).value = code;
                Scanner.stop();
                document.body.removeChild(scannerOverlay);
                Utils.toast('Scanned: ' + code);
            });
        }, 100);

        document.getElementById('close-temp-scanner').onclick = () => {
            Scanner.stop();
            document.body.removeChild(scannerOverlay);
        };
    }
};

// Make Inventory globally accessible
window.Inventory = Inventory;
