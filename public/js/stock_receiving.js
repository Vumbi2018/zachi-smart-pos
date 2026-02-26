/**
 * Stock Receiving Module
 * Handles smart stock entry, product creation-on-the-fly, and GRN generation.
 */

const StockReceiving = (function () {
    let receivingItems = [];
    let suppliers = [];
    let products = [];
    let _container = null; // Store for re-renders

    // Local UI Helpers to prevent ReferenceErrors
    function showLoading(show) {
        let loader = document.getElementById('sr-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'sr-loader';
            loader.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0.7);display:none;align-items:center;justify-content:center;z-index:9999;';
            loader.innerHTML = '<div style="width:40px;height:40px;border:4px solid #f3f3f3;border-top:4px solid #3498db;border-radius:50%;animation:sr-spin 1s linear infinite;"></div><style>@keyframes sr-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>';
            document.body.appendChild(loader);
        }
        loader.style.display = show ? 'flex' : 'none';
    }

    function showError(msg) {
        if (typeof Utils !== 'undefined' && Utils.toast) {
            Utils.toast(msg, 'error');
        } else {
            alert('Error: ' + msg);
        }
    }

    function showToast(msg, type = 'info') {
        if (typeof Utils !== 'undefined' && Utils.toast) {
            Utils.toast(msg, type);
        } else {
            console.log(`[Toast ${type}] ${msg}`);
        }
    }

    async function render(container) {
        console.log('[StockReceiving] render called');
        _container = container; // Save for sub-renders
        showLoading(true);
        try {
            console.log('[StockReceiving] loading suppliers...');
            await loadSuppliers();
            console.log('[StockReceiving] rendering content...');
            renderContent(container);
            console.log('[StockReceiving] render complete');
        } catch (err) {
            console.error('[StockReceiving] Render error:', err);
            showError('Failed to load Stock Receiving.');
        } finally {
            showLoading(false);
        }
    }

    async function loadSuppliers() {
        try {
            const data = await API.get('/suppliers');
            suppliers = data || [];
            // Sort active suppliers first
            suppliers.sort((a, b) => b.is_active - a.is_active || a.company_name.localeCompare(b.company_name));
        } catch (err) {
            console.error('Load suppliers error:', err);
        }
    }

    function renderContent(container) {
        container.innerHTML = `
            <div class="page-header">
                <div class="header-content">
                    <h1>📦 Stock Receiving</h1>
                    <p class="subtitle">Quickly receive stock and create new products on-the-fly.</p>
                </div>
                <div class="header-actions">
                    <button class="btn btn-secondary" onclick="StockReceiving.addItem()">
                        <span>+ Add Manual Item</span>
                    </button>
                    <button class="btn btn-outline-primary" onclick="StockReceiving.downloadTemplate()">
                        <span>📥 Template</span>
                    </button>
                    <button class="btn btn-secondary" onclick="document.getElementById('sr-upload-input').click()">
                        <span>📤 Upload CSV</span>
                    </button>
                    <input type="file" id="sr-upload-input" hidden accept=".csv" onchange="StockReceiving.handleUpload(event)">
                    <button class="btn btn-primary" onclick="StockReceiving.submit()">
                        <span>✅ Submit Receipt</span>
                    </button>
                </div>
            </div>

            <div class="card mb-4 shadow-sm border-0">
                <div class="card-body">
                    <div class="row g-3">
                        <div class="col-md-6">
                            <label class="form-label fw-bold">Select Supplier <span class="text-danger">*</span></label>
                            <div class="input-group">
                                <select id="sr-supplier" class="form-select select2-basic">
                                    <option value="">-- Choose Supplier --</option>
                                    ${suppliers.map(s => `<option value="${s.supplier_id}">${s.company_name} ${!s.is_active ? '(Inactive)' : ''}</option>`).join('')}
                                </select>
                                <button class="btn btn-outline-primary" onclick="StockReceiving.quickAddSupplier()">
                                    <span>Quick Add</span>
                                </button>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label fw-bold">Received Date <span class="text-danger">*</span></label>
                            <input type="date" id="sr-date" class="form-control" value="${new Date().toISOString().split('T')[0]}">
                        </div>
                        <div class="col-md-3">
                            <label class="form-label fw-bold">Search Product (Scan/Type)</label>
                            <div class="input-group">
                                <input type="text" id="sr-search" class="form-control" placeholder="Barcode or Name..." autocomplete="off">
                                <div id="sr-search-results" class="autocomplete-suggestions" style="display:none;"></div>
                            </div>
                        </div>
                        <div class="col-12 mt-3">
                            <label class="form-label fw-bold">Notes / Reference</label>
                            <textarea id="sr-notes" class="form-control" rows="1" placeholder="Optional notes for this receipt..."></textarea>
                        </div>
                    </div>
                </div>
            </div>

            <div class="card shadow-sm border-0 overflow-hidden">
                <div class="table-responsive">
                    <table class="table table-hover align-middle mb-0" id="sr-table">
                        <thead class="table-light">
                            <tr>
                                <th style="width: 50px;">#</th>
                                <th>Item Details</th>
                                <th style="width: 150px;">Cost Price</th>
                                <th style="width: 150px;">Unit Price</th>
                                <th style="width: 120px;">Markup% / Margin</th>
                                <th style="width: 120px;">Qty Added</th>
                                <th style="width: 120px;">Subtotal</th>
                                <th style="width: 50px;"></th>
                            </tr>
                        </thead>
                        <tbody id="sr-items-body">
                            <!-- Rows loaded via JS -->
                        </tbody>
                        <tfoot class="table-light fw-bold">
                            <tr>
                                <td colspan="5" class="text-end">Total Items: <span id="sr-total-count">0</span></td>
                                <td class="text-end">Grand Total:</td>
                                <td colspan="2"><span id="sr-grand-total">K0.00</span></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        `;

        setupSearch();
        updateTable();
    }

    function setupSearch() {
        const input = document.getElementById('sr-search');
        const results = document.getElementById('sr-search-results');
        let debounceTimer;

        input.addEventListener('input', (e) => {
            const val = e.target.value.trim().toLowerCase();
            clearTimeout(debounceTimer);

            if (val.length < 2) {
                results.style.display = 'none';
                return;
            }

            debounceTimer = setTimeout(async () => {
                try {
                    const data = await API.get(`/products?search=${encodeURIComponent(val)}&limit=10`);
                    products = data.products || [];

                    if (products.length > 0) {
                        results.innerHTML = products.map(p => `
                            <div class="suggestion-item" onclick="StockReceiving.addItemFromSearch(${p.product_id})">
                                <div class="d-flex justify-content-between align-items-center">
                                    <div>
                                        <div class="fw-bold">${p.name}</div>
                                        <small class="text-muted">${p.barcode || 'No Barcode'} | Stock: ${p.stock_quantity}</small>
                                    </div>
                                    <div class="text-primary fw-bold">K${parseFloat(p.cost_price).toFixed(2)}</div>
                                </div>
                            </div>
                        `).join('');
                        results.style.display = 'block';
                    } else {
                        results.innerHTML = `<div class="p-2 text-muted">No products found. Add manual?</div>`;
                        results.style.display = 'block';
                    }
                } catch (err) {
                    console.error('Search error:', err);
                }
            }, 300);
        });

        // Close results when clicking outside
        document.addEventListener('click', (e) => {
            if (!input.contains(e.target) && !results.contains(e.target)) {
                results.style.display = 'none';
            }
        });

        // Fast scan support - if exact barcode match, add instantly
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                const val = input.value.trim();
                if (!val) return;

                // First check current results
                let exactMatch = products.find(p => p.barcode === val);

                // If not in current results, try direct lookup
                if (!exactMatch) {
                    try {
                        const product = await API.get(`/products/barcode/${val}`);
                        if (product) {
                            exactMatch = product;
                            // Add to local list so addItemFromSearch can find it if needed
                            products.push(product);
                        }
                    } catch (err) {
                        console.warn('Barcode lookup failed:', err);
                    }
                }

                if (exactMatch) {
                    addItemFromSearch(exactMatch.product_id);
                    input.value = '';
                    results.style.display = 'none';
                }
            }
        });
    }

    function addItemFromSearch(id) {
        const product = products.find(p => p.product_id === id);
        if (!product) return;

        // Duplicate detection
        if (receivingItems.some(item => item.product_id === id)) {
            showToast('Item already in list. Update quantity instead.', 'warning');
            return;
        }

        receivingItems.push({
            product_id: product.product_id,
            name: product.name,
            barcode: product.barcode,
            category: product.category,
            cost_price: parseFloat(product.cost_price) || 0,
            unit_price: parseFloat(product.unit_price) || 0,
            quantity_added: 1,
            unit_of_measure: product.unit_of_measure || 'pcs',
            original_cost: parseFloat(product.cost_price) || 0 // For price alerts
        });

        updateTable();
        document.getElementById('sr-search').value = '';
        document.getElementById('sr-search-results').style.display = 'none';
    }

    function addItem() {
        receivingItems.push({
            product_id: null,
            name: '',
            barcode: '',
            category: 'General',
            cost_price: 0,
            unit_price: 0,
            quantity_added: 1,
            unit_of_measure: 'pcs',
            is_new: true
        });
        updateTable();
    }

    function removeItem(index) {
        receivingItems.splice(index, 1);
        updateTable();
    }

    function updateTable() {
        const tbody = document.getElementById('sr-items-body');
        if (!tbody) return;

        if (receivingItems.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center py-5 text-muted">No items added yet. Search or add manual items.</td></tr>`;
            document.getElementById('sr-total-count').textContent = '0';
            document.getElementById('sr-grand-total').textContent = 'K0.00';
            return;
        }

        let grandTotal = 0;
        tbody.innerHTML = receivingItems.map((item, index) => {
            const subtotal = item.cost_price * item.quantity_added;
            grandTotal += subtotal;

            // Margin Analysis
            const markup = item.unit_price > 0 ? ((item.unit_price - item.cost_price) / item.cost_price * 100) : 0;
            const margin = item.unit_price > 0 ? ((item.unit_price - item.cost_price) / item.unit_price * 100) : 0;
            const marginAmount = item.unit_price - item.cost_price;

            // Price Alert
            const priceDiff = item.original_cost ? (item.cost_price - item.original_cost) : 0;
            const alertClass = priceDiff > 0 ? 'text-danger' : (priceDiff < 0 ? 'text-success' : '');
            const alertIcon = priceDiff !== 0 ? ` <span title="Price changed by K${Math.abs(priceDiff).toFixed(2)}" class="${alertClass}">${priceDiff > 0 ? '⚠️' : '📉'}</span>` : '';

            return `
                <tr>
                    <td>${index + 1}</td>
                    <td>
                        ${item.product_id ?
                    `<div class="fw-bold">${item.name}</div><small class="text-muted">${item.barcode || 'N/A'}</small>` :
                    `<div class="mb-1"><input type="text" class="form-control form-control-sm" placeholder="New Product Name" value="${item.name}" onchange="StockReceiving.updateItem(${index}, 'name', this.value)"></div>
                             <div class="row g-1">
                                <div class="col-6"><input type="text" class="form-control form-control-sm" placeholder="Barcode (Auto if empty)" value="${item.barcode}" onchange="StockReceiving.updateItem(${index}, 'barcode', this.value)"></div>
                                <div class="col-6"><input type="text" class="form-control form-control-sm" placeholder="Category" value="${item.category}" onchange="StockReceiving.updateItem(${index}, 'category', this.value)"></div>
                             </div>`
                }
                    </td>
                    <td>
                        <div class="input-group input-group-sm">
                            <span class="input-group-text">K</span>
                            <input type="number" step="0.01" class="form-control" value="${item.cost_price}" onchange="StockReceiving.updateItem(${index}, 'cost_price', this.value)">
                            ${alertIcon}
                        </div>
                    </td>
                    <td>
                        <div class="input-group input-group-sm">
                            <span class="input-group-text">K</span>
                            <input type="number" step="0.01" class="form-control" value="${item.unit_price}" onchange="StockReceiving.updateItem(${index}, 'unit_price', this.value)">
                        </div>
                    </td>
                    <td>
                        <div class="small">
                            <div class="${margin < 15 ? 'text-danger' : 'text-success'}">Margin: ${margin.toFixed(1)}%</div>
                            <div class="text-muted text-nowrap">Profit: K${marginAmount.toFixed(2)}</div>
                        </div>
                    </td>
                    <td>
                        <input type="number" class="form-control form-control-sm" value="${item.quantity_added}" min="1" onchange="StockReceiving.updateItem(${index}, 'quantity_added', this.value)">
                    </td>
                    <td class="fw-bold">K${subtotal.toFixed(2)}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-danger" onclick="StockReceiving.removeItem(${index})">×</button>
                    </td>
                </tr>
            `;
        }).join('');

        document.getElementById('sr-total-count').textContent = receivingItems.length;
        document.getElementById('sr-grand-total').textContent = `K${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function updateItem(index, field, value) {
        if (field === 'cost_price' || field === 'unit_price' || field === 'quantity_added') {
            receivingItems[index][field] = parseFloat(value) || 0;
            updateTable(); // Refresh for subtotal/margin
        } else {
            receivingItems[index][field] = value;
        }
    }

    async function submit() {
        const supplierId = document.getElementById('sr-supplier').value;
        if (!supplierId) {
            showToast('Please select a supplier.', 'error');
            return;
        }

        if (receivingItems.length === 0) {
            showToast('Please add at least one item.', 'error');
            return;
        }

        // Validate items
        for (const item of receivingItems) {
            if (!item.product_id && !item.name.trim()) {
                showToast('New items must have a name.', 'error');
                return;
            }
            if (item.quantity_added <= 0) {
                showToast(`Invalid quantity for ${item.name || 'item'}.`, 'error');
                return;
            }
        }

        if (!confirm(`Submit receipt for ${receivingItems.length} items? This will update stock immediately.`)) return;

        showLoading(true);
        try {
            const data = await API.post('/inventory/quick-receive', {
                supplier_id: supplierId,
                received_date: document.getElementById('sr-date').value,
                items: receivingItems,
                notes: document.getElementById('sr-notes').value
            });

            showToast(`Success! GRN created: ${data.grn_number}`, 'success');

            // Clear and reload
            receivingItems = [];
            render(_container);

        } catch (err) {
            console.error('Submit receipt error:', err);
            showError(err.message);
        } finally {
            showLoading(false);
        }
    }

    function quickAddSupplier() {
        const name = prompt('Enter New Supplier Name:');
        if (!name || !name.trim()) return;

        showLoading(true);
        API.post('/suppliers', { company_name: name.trim() })
            .then(data => {
                showToast('Supplier added successfully.', 'success');
                loadSuppliers().then(() => {
                    // This render() was a bug, should call renderContent or similar
                    // But we need the container. For now, let's just refresh the whole view
                    if (window.location.hash === '#/stock-receiving') {
                        App.navigate('#/stock-receiving');
                    }
                    // Select the new supplier
                    setTimeout(() => {
                        const select = document.getElementById('sr-supplier');
                        if (select) select.value = data.supplier_id;
                    }, 100);
                });
            })
            .catch(err => {
                console.error('Quick add supplier error:', err);
                showError('Failed to add supplier.');
            })
            .finally(() => showLoading(false));
    }

    async function handleUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        showLoading(true);
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch(`${API.baseUrl}/inventory/quick-receive/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${API.token}`
                },
                body: formData
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Upload failed');
            }

            const items = await response.json();
            if (items.length === 0) {
                showToast('No valid items found in CSV.', 'warning');
            } else {
                // Merge items
                items.forEach(item => {
                    const existingIndex = receivingItems.findIndex(ri =>
                        (item.barcode && ri.barcode === item.barcode) ||
                        (!item.barcode && item.name && ri.name === item.name)
                    );

                    if (existingIndex > -1) {
                        receivingItems[existingIndex].quantity_added += (item.quantity_added || 0);
                    } else {
                        receivingItems.push(item);
                    }
                });
                updateTable();
                showToast(`Imported ${items.length} items from CSV. Review before submitting.`, 'success');
            }
        } catch (err) {
            console.error('File upload error:', err);
            showError(err.message);
        } finally {
            showLoading(false);
            event.target.value = ''; // Reset input
        }
    }

    function downloadTemplate() {
        const headers = ['barcode', 'name', 'quantity', 'cost_price', 'unit_price', 'category', 'unit'];
        const sampleRow = ['12345678', 'Sample Product', '10', '5.50', '8.00', 'General', 'pcs'];
        const csvContent = headers.join(',') + '\n' + sampleRow.join(',');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'stock_receiving_template.csv';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
    }

    return { render, addItem, addItemFromSearch, removeItem, updateItem, submit, quickAddSupplier, handleUpload, downloadTemplate };
})();
