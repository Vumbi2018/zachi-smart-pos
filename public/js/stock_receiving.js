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
            // Picked up by /js/utils/data-style.js applier on appendChild below.
            loader.setAttribute('data-style', 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0.7);display:none;align-items:center;justify-content:center;z-index:9999;');
            // Spinner element + @keyframes sr-spin live in /css/styles.css (Task #7).
            loader.innerHTML = '<div id="sr-loader-spinner"></div>';
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
            <!-- Hero header: gradient background + clear primary CTA on the
                 right so the "Submit" action is unmistakable. Auxiliary
                 actions (Add manual / Template / Upload) are grouped in a
                 secondary toolbar below to reduce action overload. -->
            <div class="sr-hero">
                <div class="sr-hero-text">
                    <h1 class="sr-hero-title">📦 Stock Receiving</h1>
                    <p class="sr-hero-subtitle">Receive deliveries fast — scan or type, add new products on-the-fly, and post the GRN in one click.</p>
                </div>
                <div class="sr-hero-cta">
                    <button class="btn btn-primary btn-lg" data-on-click="StockReceiving.submit()">
                        <span>✅ Submit Receipt</span>
                    </button>
                </div>
            </div>

            <div class="sr-toolbar">
                <button class="btn btn-secondary btn-sm" data-on-click="StockReceiving.addItem()">
                    <span>+ Add manual item</span>
                </button>
                <button class="btn btn-secondary btn-sm" data-on-click="StockReceiving.downloadTemplate()">
                    <span>📥 CSV template</span>
                </button>
                <button class="btn btn-secondary btn-sm" data-on-click="Dom.clickById('sr-upload-input')">
                    <span>📤 Upload CSV</span>
                </button>
                <input type="file" id="sr-upload-input" hidden accept=".csv" data-on-change="StockReceiving.handleUpload($event)">
            </div>

            <!-- Header card: 3-column grid (supplier / date / search) so
                 the cashier's eye reads left-to-right in the same order
                 they fill the form. Notes drops to a full-width row. -->
            <div class="sr-card sr-header-card">
                <div class="sr-header-grid">
                    <div class="sr-field">
                        <label class="sr-label">Supplier <span class="sr-req">*</span></label>
                        <div class="sr-input-group">
                            <select id="sr-supplier" class="form-input">
                                <option value="">-- Choose supplier --</option>
                                ${suppliers.map(s => `<option value="${s.supplier_id}">${s.company_name}${!s.is_active ? ' (Inactive)' : ''}</option>`).join('')}
                            </select>
                            <button class="btn btn-secondary btn-sm" data-on-click="StockReceiving.quickAddSupplier()" title="Add a new supplier without leaving this page">
                                <span>＋</span>
                            </button>
                        </div>
                    </div>
                    <div class="sr-field">
                        <label class="sr-label">Received date <span class="sr-req">*</span></label>
                        <input type="date" id="sr-date" class="form-input" value="${new Date().toISOString().split('T')[0]}">
                    </div>
                    <div class="sr-field sr-field--search">
                        <label class="sr-label">Search / scan product</label>
                        <div class="sr-search-wrap">
                            <input type="text" id="sr-search" class="form-input" placeholder="Barcode or product name…" autocomplete="off">
                            <div id="sr-search-results" class="autocomplete-suggestions" data-style="display:none;"></div>
                        </div>
                    </div>
                    <div class="sr-field sr-field--full">
                        <label class="sr-label">Notes / reference</label>
                        <textarea id="sr-notes" class="form-input" rows="1" placeholder="Optional notes for this receipt…"></textarea>
                    </div>
                </div>
            </div>

            <div class="sr-card sr-table-card">
                <div class="sr-table-scroll">
                    <table class="sr-table" id="sr-table">
                        <thead>
                            <tr>
                                <th data-style="width:42px;">#</th>
                                <th>Item details</th>
                                <th data-style="width:140px;">Cost</th>
                                <th data-style="width:140px;">Sell</th>
                                <th data-style="width:130px;">Margin</th>
                                <th data-style="width:100px;">Qty</th>
                                <th data-style="width:130px;text-align:right;">Subtotal</th>
                                <th data-style="width:42px;"></th>
                            </tr>
                        </thead>
                        <tbody id="sr-items-body">
                            <!-- Rows loaded via JS -->
                        </tbody>
                    </table>
                </div>
                <div class="sr-totals-bar">
                    <div class="sr-totals-left">
                        <span class="sr-totals-pill">Items: <strong id="sr-total-count">0</strong></span>
                    </div>
                    <div class="sr-totals-right">
                        <span class="sr-totals-label">Grand total</span>
                        <span class="sr-totals-amount" id="sr-grand-total">K0.00</span>
                    </div>
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
                            <div class="suggestion-item" data-on-click="StockReceiving.addItemFromSearch(${p.product_id})">
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
            tbody.innerHTML = `<tr class="sr-empty-row"><td colspan="8">📦 No items yet — scan a barcode, search by name, or add a manual line to get started.</td></tr>`;
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
                    `<div class="mb-1"><input type="text" class="form-control form-control-sm" placeholder="New Product Name" value="${item.name}" data-on-change="StockReceiving.updateItem(${index}, 'name', $value)"></div>
                             <div class="row g-1">
                                <div class="col-6"><input type="text" class="form-control form-control-sm" placeholder="Barcode (Auto if empty)" value="${item.barcode}" data-on-change="StockReceiving.updateItem(${index}, 'barcode', $value)"></div>
                                <div class="col-6"><input type="text" class="form-control form-control-sm" placeholder="Category" value="${item.category}" data-on-change="StockReceiving.updateItem(${index}, 'category', $value)"></div>
                             </div>`
                }
                    </td>
                    <td>
                        <div class="input-group input-group-sm">
                            <span class="input-group-text">K</span>
                            <input type="number" step="0.01" class="form-control" value="${item.cost_price}" data-on-change="StockReceiving.updateItem(${index}, 'cost_price', $value)">
                            ${alertIcon}
                        </div>
                    </td>
                    <td>
                        <div class="input-group input-group-sm">
                            <span class="input-group-text">K</span>
                            <input type="number" step="0.01" class="form-control" value="${item.unit_price}" data-on-change="StockReceiving.updateItem(${index}, 'unit_price', $value)">
                        </div>
                    </td>
                    <td>
                        <div class="small">
                            <div class="${margin < 15 ? 'text-danger' : 'text-success'}">Margin: ${margin.toFixed(1)}%</div>
                            <div class="text-muted text-nowrap">Profit: K${marginAmount.toFixed(2)}</div>
                        </div>
                    </td>
                    <td>
                        <input type="number" class="form-control form-control-sm" value="${item.quantity_added}" min="1" data-on-change="StockReceiving.updateItem(${index}, 'quantity_added', $value)">
                    </td>
                    <td class="fw-bold">K${subtotal.toFixed(2)}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-danger" data-on-click="StockReceiving.removeItem(${index})">×</button>
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

// Expose to global scope for delegated event handlers (data-on-* attributes).
window.StockReceiving = StockReceiving;
