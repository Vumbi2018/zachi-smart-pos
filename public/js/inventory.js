const Inventory = {
    selectedIds: new Set(),
    pendingSearch: null, // set before navigating here to pre-filter the list
    _sortKey: null,
    _sortDir: 'asc',
    _displayedItems: [],
    // Pagination
    _page: 1,
    _pageSize: 50,
    _filteredItems: [],

    async render(container) {
        this.selectedIds = new Set();
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Inventory Management</h1>
                    <p class="text-secondary">Track stock levels, audit movements, and perform stocktakes.</p>
                </div>
                <div class="flex gap-2">
                    <button class="btn btn-outline" data-on-click="Inventory.downloadTemplate()" title="Download CSV Template">
                        📄 Template
                    </button>
                    <button class="btn btn-outline" data-on-click="Inventory.triggerImport()" title="Import Products from CSV">
                        ⬆️ Import
                    </button>
                    <input type="file" id="inventory-import-file" accept=".csv" class="hidden" data-on-change="Inventory.handleFileSelect($el)">
                    
                    <button class="btn btn-outline mr-2" data-on-click="Inventory.exportProducts()" title="Export to CSV">
                        ⬇️ Export
                    </button>

                    <button class="btn btn-outline" data-on-click="Inventory.startStocktake()">
                        📋 Start Stocktake
                    </button>
                    <button class="btn btn-warning" data-on-click="InventoryAlerts.refresh()" title="View AI-powered stock alerts" data-style="background:#f97316;color:#fff;border-color:#f97316;">
                        🤖 AI Alerts
                    </button>
                    <button class="btn btn-primary" data-on-click="Inventory.openProductModal()">
                        <i class="fas fa-plus mr-1"></i> Add Product
                    </button>
                    <button class="btn btn-outline" data-on-click="Inventory.openAdjustModal()">
                        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 5v14M5 12h14"/>
                        </svg>
                        Quick Adjust
                    </button>
                </div>
            </div>

            <!-- Bulk Action Toolbar (hidden until items selected) -->
            <div id="bulk-toolbar" class="hidden mb-4 p-3 rounded-lg flex items-center gap-3 flex-wrap" data-style="background:var(--color-primary,#1B3A5C);color:#fff;">
                <span id="bulk-count" class="font-bold text-sm">0 selected</span>
                <div class="flex gap-2 flex-wrap ml-auto">
                    <button class="btn btn-xs" data-style="background:#ef4444;color:#fff;border:none;" data-on-click="Inventory.bulkDeleteSelected()">
                        <i class="fas fa-trash mr-1"></i> Delete Selected
                    </button>
                    <button class="btn btn-xs" data-style="background:#f59e0b;color:#fff;border:none;" data-on-click="Inventory.bulkChangeCategory()">
                        <i class="fas fa-tag mr-1"></i> Set Category
                    </button>
                    <button class="btn btn-xs" data-style="background:#8b5cf6;color:#fff;border:none;" data-on-click="Inventory.bulkAdjustPrice()">
                        <i class="fas fa-percent mr-1"></i> Adjust Price %
                    </button>
                    <button class="btn btn-xs" data-style="background:#0ea5e9;color:#fff;border:none;" data-on-click="Inventory.bulkSetReorder()">
                        <i class="fas fa-layer-group mr-1"></i> Set Reorder
                    </button>
                    <button class="btn btn-xs btn-outline" data-style="color:#fff;border-color:#fff;" data-on-click="Inventory.clearSelection()">
                        ✕ Deselect All
                    </button>
                </div>
            </div>

            <div class="card mb-6">
                <div class="card-body">
                    <div class="flex gap-2">
                        <input type="text" id="inventory-search" class="form-input flex-1" placeholder="Search products by name or SKU..." data-on-input="Inventory.filter($value)">
                        <button class="btn btn-secondary" data-on-click="Inventory.openScannerModal()" title="Scan Barcode">
                            <i class="fas fa-barcode"></i> Scan
                        </button>
                        <button class="btn btn-outline" data-on-click="Inventory.findDuplicates()" title="Find duplicate products">
                            <span class="material-icons-outlined" data-style="font-size:15px;vertical-align:middle;">content_copy</span> Find Duplicates
                        </button>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-body p-0">
                    <div class="table-container" id="inv-table-wrap" data-style="overflow:auto;max-height:65vh;">
                        <table class="table w-full" id="inv-table" data-style="table-layout:fixed;">
                            <thead data-style="position:sticky;top:0;z-index:10;background:var(--color-surface,#fff);">
                                <tr id="inv-thead-row">
                                    <th data-style="width:32px;position:relative;">
                                        <input type="checkbox" id="select-all-cb" title="Select All" data-on-change="Inventory.toggleSelectAll($checked)">
                                    </th>
                                    <th data-key="_idx" data-style="width:44px;position:relative;cursor:pointer;user-select:none;" data-on-click="Inventory._sortBy('_idx')">S/N<span class="sort-arrow"></span><span class="col-resizer"></span></th>
                                    <th data-key="name" data-style="position:relative;cursor:pointer;user-select:none;" data-on-click="Inventory._sortBy('name')">Description<span class="sort-arrow"></span><span class="col-resizer"></span></th>
                                    <th data-key="_packs" data-style="position:relative;cursor:pointer;user-select:none;" data-on-click="Inventory._sortBy('_packs')">Qty (Packs)<span class="sort-arrow"></span><span class="col-resizer"></span></th>
                                    <th data-key="unit_of_measure" data-style="position:relative;cursor:pointer;user-select:none;" data-on-click="Inventory._sortBy('unit_of_measure')">UoM<span class="sort-arrow"></span><span class="col-resizer"></span></th>
                                    <th data-key="items_per_pack" data-style="position:relative;cursor:pointer;user-select:none;" data-on-click="Inventory._sortBy('items_per_pack')">Unit Qty<span class="sort-arrow"></span><span class="col-resizer"></span></th>
                                    <th data-key="stock_quantity" data-style="position:relative;cursor:pointer;user-select:none;" data-on-click="Inventory._sortBy('stock_quantity')">Total Qty<span class="sort-arrow"></span><span class="col-resizer"></span></th>
                                    <th data-key="_pack_price" data-style="position:relative;cursor:pointer;user-select:none;" data-on-click="Inventory._sortBy('_pack_price')">Pack Price<span class="sort-arrow"></span><span class="col-resizer"></span></th>
                                    <th data-key="_total_price" data-style="position:relative;cursor:pointer;user-select:none;" data-on-click="Inventory._sortBy('_total_price')">Total Price<span class="sort-arrow"></span><span class="col-resizer"></span></th>
                                    <th data-key="cost_price" data-style="position:relative;cursor:pointer;user-select:none;" data-on-click="Inventory._sortBy('cost_price')">Buying Price<span class="sort-arrow"></span><span class="col-resizer"></span></th>
                                    <th data-key="unit_price" data-style="position:relative;cursor:pointer;user-select:none;" data-on-click="Inventory._sortBy('unit_price')">Selling Price<span class="sort-arrow"></span><span class="col-resizer"></span></th>
                                    <th data-key="_total_amount" data-style="position:relative;cursor:pointer;user-select:none;" data-on-click="Inventory._sortBy('_total_amount')">Total Amount<span class="sort-arrow"></span><span class="col-resizer"></span></th>
                                    <th data-key="remarks" data-style="position:relative;cursor:pointer;user-select:none;" data-on-click="Inventory._sortBy('remarks')">Remarks<span class="sort-arrow"></span><span class="col-resizer"></span></th>
                                    <th data-style="width:90px;position:relative;">Actions<span class="col-resizer"></span></th>
                                </tr>
                            </thead>
                            <tbody id="inventory-list-body">
                                <tr><td colspan="14" class="text-center p-4">Loading...</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <div id="inv-pagination" class="px-4 py-2 border-t flex items-center justify-between gap-3 text-sm" data-style="min-height:44px;"></div>
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
        // -- Pagination --
        this._filteredItems = items;
        const start = (this._page - 1) * this._pageSize;
        const paged = items.slice(start, start + this._pageSize);
        this._displayedItems = paged;
        const tbody = document.getElementById('inventory-list-body');
        if (!tbody) return;

        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="14" class="text-center p-4 text-secondary">No products found.</td></tr>`;
            this._renderPagination();
            return;
        }

        // Helper: editable cell — single-click to edit inline
        const ed = (id, field, val, type = 'text', extra = '') =>
            `<td class="inv-editable" data-id="${id}" data-field="${field}" data-type="${type}" ${extra}
                data-on-click="Inventory._inlineEdit($el)"
                title="Click to edit">${val}</td>`;

        tbody.innerHTML = paged.map((p, index) => {
            const packQty = p.stock_quantity > 0 && p.items_per_pack > 0
                ? (p.stock_quantity / p.items_per_pack).toFixed(1).replace(/\.0$/, '')
                : 0;
            const packPrice = (parseFloat(p.cost_price || 0) * (p.items_per_pack || 1));
            const totalPrice = (p.stock_quantity * parseFloat(p.cost_price || 0));
            const totalAmount = (p.stock_quantity * parseFloat(p.unit_price || 0));
            const isChecked = this.selectedIds.has(p.product_id);

            return `
            <tr class="clickable-row hover:bg-slate-50 text-sm ${isChecked ? 'bg-blue-50' : ''}"
                id="inv-row-${p.product_id}" data-id="${p.product_id}"
                data-on-click="Inventory.openProductModal(${p.product_id})"
                title="Click to view / edit product">
                <td data-stop="click">
                    <input type="checkbox" class="inv-cb" data-id="${p.product_id}"
                        ${isChecked ? 'checked' : ''}
                        data-on-change="Inventory.onRowCheck(${p.product_id}, $checked)">
                </td>
                <td>${start + index + 1}</td>
                ${ed(p.product_id, 'name', `<div class="font-bold">${p.name}</div><div class="text-xs text-secondary">${p.sku || p.barcode || '-'}</div>`, 'text', '')}
                <td class="text-right font-medium">${packQty}</td>
                ${ed(p.product_id, 'unit_of_measure', p.unit_of_measure || '-', 'text', '')}
                ${ed(p.product_id, 'items_per_pack', p.items_per_pack || 1, 'number', '')}
                ${ed(p.product_id, 'stock_quantity', p.stock_quantity, 'number', 'class="inv-editable text-right font-bold text-primary"')}
                <td class="text-right text-secondary" title="cost × unit qty">${Utils.formatCurrency(packPrice)}</td>
                <td class="text-right text-secondary">${Utils.formatCurrency(totalPrice)}</td>
                ${ed(p.product_id, 'cost_price', Utils.formatCurrency(p.cost_price), 'number', 'class="inv-editable text-right text-green-600"')}
                ${ed(p.product_id, 'unit_price', Utils.formatCurrency(p.unit_price), 'number', 'class="inv-editable text-right text-blue-600 font-bold"')}
                <td class="text-right font-bold">${Utils.formatCurrency(totalAmount)}</td>
                ${ed(p.product_id, 'remarks', p.remarks || '-', 'text', 'class="inv-editable text-xs text-secondary max-w-xs truncate"')}
                <td data-stop="click">
                    <div class="flex gap-1">
                        <button class="btn btn-xs btn-outline" data-on-click="Inventory.showHistory(${p.product_id})" title="History"><i class="fas fa-history"></i></button>
                        <button class="btn btn-xs btn-outline" data-on-click="Inventory.openProductModal(${p.product_id})" title="Edit All Fields"><i class="fas fa-pencil-alt"></i></button>
                        <button class="btn btn-xs btn-outline" data-on-click="Inventory.openAdjustModal(${p.product_id})" title="Adjust Stock"><i class="fas fa-sliders-h"></i></button>
                    </div>
                </td>
            </tr>
        `}).join('');

        // Sync select-all checkbox state
        const cb = document.getElementById('select-all-cb');
        if (cb) cb.indeterminate = this.selectedIds.size > 0 && this.selectedIds.size < items.length;

        this._updateSortArrows();
        this._initResize();
        this._renderPagination();
    },

    // ── Pagination ────────────────────────────────────────────────────────────

    _renderPagination() {
        const el = document.getElementById('inv-pagination');
        if (!el) return;
        const total = (this._filteredItems || []).length;
        const ps = this._pageSize;
        const p = this._page;
        const totalPages = Math.max(1, Math.ceil(total / ps));
        const from = total === 0 ? 0 : (p - 1) * ps + 1;
        const to = Math.min(p * ps, total);
        el.innerHTML = `
            <span class="text-secondary">Showing ${from}&ndash;${to} of ${total} items</span>
            <div class="flex items-center gap-2">
                <select data-on-change="Inventory._setPageSize($valueNum)"
                    data-style="padding:3px 8px;border:1px solid #ddd;border-radius:4px;font-size:.85rem;cursor:pointer;">
                    ${[25, 50, 100, 250].map(n => `<option value="${n}" ${n === ps ? 'selected' : ''}>${n}&nbsp;/&nbsp;page</option>`).join('')}
                </select>
                <button class="btn btn-xs btn-outline" data-on-click="Inventory._goToPage(1)" ${p <= 1 ? 'disabled' : ''}>«</button>
                <button class="btn btn-xs btn-outline" data-on-click="Inventory._goToPage(${p - 1})" ${p <= 1 ? 'disabled' : ''}>&#8249;</button>
                <span data-style="font-size:.875rem;white-space:nowrap;">Page ${p} of ${totalPages}</span>
                <button class="btn btn-xs btn-outline" data-on-click="Inventory._goToPage(${p + 1})" ${p >= totalPages ? 'disabled' : ''}>&#8250;</button>
                <button class="btn btn-xs btn-outline" data-on-click="Inventory._goToPage(${totalPages})" ${p >= totalPages ? 'disabled' : ''}>»</button>
            </div>
        `;
    },

    _goToPage(p) {
        const total = (this._filteredItems || []).length;
        const totalPages = Math.max(1, Math.ceil(total / this._pageSize));
        this._page = Math.max(1, Math.min(+p, totalPages));
        this.renderList(this._filteredItems);
        // Scroll table back to top on page change
        const wrap = document.getElementById('inv-table-wrap');
        if (wrap) wrap.scrollTop = 0;
    },

    _setPageSize(n) {
        this._pageSize = +n;
        this._page = 1;
        this.renderList(this._filteredItems);
    },

    filter(query) {
        if (!this.products) return;
        this._page = 1; // reset to first page on new search
        const lower = query.toLowerCase();
        const filtered = this.products.filter(p =>
            p.name.toLowerCase().includes(lower) ||
            (p.sku && p.sku.toLowerCase().includes(lower))
        );
        this.renderList(filtered);
    },

    // ── Sorting ──────────────────────────────────────────────────────────────

    _sortBy(key) {
        this._page = 1; // reset to first page on sort
        if (this._sortKey === key) {
            this._sortDir = this._sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            this._sortKey = key;
            this._sortDir = 'asc';
        }
        const items = [...(this._displayedItems || this.products || [])];
        const dir = this._sortDir === 'asc' ? 1 : -1;

        const getVal = (p, k) => {
            if (k === '_idx') return 0;
            if (k === '_packs') return p.stock_quantity > 0 && p.items_per_pack > 0 ? p.stock_quantity / p.items_per_pack : 0;
            if (k === '_pack_price') return parseFloat(p.cost_price || 0) * (p.items_per_pack || 1);
            if (k === '_total_price') return p.stock_quantity * parseFloat(p.cost_price || 0);
            if (k === '_total_amount') return p.stock_quantity * parseFloat(p.unit_price || 0);
            const v = p[k];
            return typeof v === 'string' ? v.toLowerCase() : (v ?? '');
        };

        items.sort((a, b) => {
            const va = getVal(a, key), vb = getVal(b, key);
            if (va < vb) return -dir;
            if (va > vb) return dir;
            return 0;
        });
        this.renderList(items);
    },

    _updateSortArrows() {
        document.querySelectorAll('#inv-thead-row th[data-key]').forEach(th => {
            const arrow = th.querySelector('.sort-arrow');
            if (!arrow) return;
            if (th.dataset.key === this._sortKey) {
                arrow.textContent = this._sortDir === 'asc' ? ' \u25b2' : ' \u25bc';
                th.style.color = 'var(--primary, #1B3A5C)';
            } else {
                arrow.textContent = '';
                th.style.color = '';
            }
        });
    },

    // ── Inline Editing ───────────────────────────────────────────────────────

    _inlineEdit(td) {
        if (td.querySelector('input,textarea')) return;
        const field = td.dataset.field;
        const type = td.dataset.type || 'text';
        const id = td.dataset.id;
        const p = (this.products || []).find(x => x.product_id === id);
        if (!p) return;

        const rawVal = p[field] !== undefined ? p[field] : '';
        const origHTML = td.innerHTML;

        const input = document.createElement(field === 'remarks' ? 'textarea' : 'input');
        input.type = type;
        input.value = rawVal;
        input.setAttribute('data-style',
            'width:100%;min-width:60px;padding:2px 4px;border:1.5px solid var(--primary,#1B3A5C);' +
            'border-radius:4px;font-size:inherit;font-family:inherit;box-sizing:border-box;background:#fff;');
        if (field === 'remarks') input.rows = 2;

        td.innerHTML = '';
        td.appendChild(input);
        input.focus();
        input.select();

        const save = () => this._inlineSave(td, id, field, type, input.value, origHTML);
        input.addEventListener('blur', save);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !(e.shiftKey && field === 'remarks')) { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { td.innerHTML = origHTML; }
        });
    },

    async _inlineSave(td, id, field, type, value, origHTML) {
        let parsed = value;
        if (type === 'number') {
            parsed = parseFloat(value);
            if (isNaN(parsed)) { td.innerHTML = origHTML; return; }
        }
        const p = (this.products || []).find(x => x.product_id === id);
        if (!p) { td.innerHTML = origHTML; return; }

        // Show saving indicator
        td.style.opacity = '0.5';
        try {
            await API.request(`/products/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ ...p, [field]: parsed })
            });
            p[field] = parsed;                    // update in-memory
            if (App.state) App.state.inventory = null; // bust cache
            this.renderList(this._displayedItems || this.products);
            Utils.toast('Saved', 'success');
        } catch (err) {
            td.innerHTML = origHTML;
            td.style.opacity = '';
            Utils.toast(err.message || 'Save failed', 'error');
        }
    },

    // ── Column Resize ────────────────────────────────────────────────────────

    _initResize() {
        document.querySelectorAll('#inv-thead-row th').forEach(th => {
            let resizer = th.querySelector('.col-resizer');
            if (!resizer) return;
            // Replace to drop old listeners
            const newR = resizer.cloneNode(true);
            resizer.parentNode.replaceChild(newR, resizer);
            resizer = newR;

            Object.assign(resizer.style, {
                position: 'absolute',
                top: '0',
                right: '0',
                width: '6px',
                height: '100%',
                cursor: 'col-resize',
                userSelect: 'none',
                zIndex: '10',
                background: 'transparent'
            });

            resizer.addEventListener('mousedown', e => {
                e.preventDefault();
                e.stopPropagation();
                const startX = e.pageX;
                const startW = th.offsetWidth;
                document.body.style.cursor = 'col-resize';

                const onMove = mv => {
                    const w = Math.max(40, startW + mv.pageX - startX);
                    th.style.width = w + 'px';
                    th.style.minWidth = w + 'px';
                };
                const onUp = () => {
                    document.body.style.cursor = '';
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        });
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

    /**
     * AI suggest: looks at the product name + description and pre-fills
     * category, unit of measure, reorder level, and a price band.
     */
    async aiSuggest() {
        const form = document.getElementById('product-form');
        if (!form) return;
        const nameEl = form.querySelector('input[name="name"]');
        const descEl = form.querySelector('textarea[name="description"]');
        const note = document.getElementById('ai-suggest-note');
        const name = (nameEl?.value || '').trim();
        if (!name) {
            Utils.toast('Type a product name first', 'warning');
            nameEl?.focus();
            return;
        }
        if (note) note.textContent = '✨ Asking Zachi-AI…';
        try {
            const res = await API.post('/ai/suggest-product', {
                name,
                description: (descEl?.value || '').trim(),
            });
            const setIfEmpty = (selector, value) => {
                if (value === null || value === undefined || value === '') return;
                const el = form.querySelector(selector);
                if (!el) return;
                if (!el.value || el.value === '0' || el.value === '10') {
                    el.value = value;
                }
            };
            // Category select: add option if missing, then select
            const catSel = form.querySelector('select[name="category"]');
            if (catSel && res.category) {
                let opt = Array.from(catSel.options).find(o => o.value.toLowerCase() === res.category.toLowerCase());
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = res.category;
                    opt.textContent = res.category;
                    catSel.appendChild(opt);
                }
                if (!catSel.value) catSel.value = opt.value;
            }
            // Unit of measure
            const uomSel = form.querySelector('select[name="unit_of_measure"]');
            if (uomSel && res.unit_of_measure) {
                let opt = Array.from(uomSel.options).find(o => o.value.toLowerCase() === res.unit_of_measure.toLowerCase());
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = res.unit_of_measure;
                    opt.textContent = res.unit_of_measure;
                    uomSel.appendChild(opt);
                }
                if (!uomSel.value || uomSel.value === 'piece') uomSel.value = opt.value;
            }
            setIfEmpty('input[name="reorder_level"]', res.reorder_level);
            setIfEmpty('input[name="unit_price"]', res.suggested_unit_price_zmw);
            setIfEmpty('input[name="cost_price"]', res.suggested_cost_price_zmw);
            if (note) note.textContent = `✨ ${res.notes || 'Suggestion applied. Adjust as needed.'}`;
            Utils.toast('AI suggestion applied. Adjust as needed.', 'success');
        } catch (err) {
            const msg = err?.response?.data?.error || err?.message || 'AI suggestion failed';
            if (note) note.textContent = '';
            Utils.toast(msg, 'error');
        }
    },

    toggleSelectAll(checked) {
        const cbs = document.querySelectorAll('.inv-cb');
        cbs.forEach(cb => {
            const id = cb.dataset.id;
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
                <button class="modal-close" data-on-click="Utils.closeModal()">×</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">New Category</label>
                    <input list="bulk-cat-list" id="bulk-cat-input" class="form-input" placeholder="Type or choose a category">
                    <datalist id="bulk-cat-list">${options}</datalist>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" data-on-click="Utils.closeModal()">Cancel</button>
                    <button class="btn btn-primary" data-on-click="Inventory._confirmBulkCategory()">Apply</button>
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
                <button class="modal-close" data-on-click="Utils.closeModal()">×</button>
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
                    <button class="btn btn-secondary" data-on-click="Utils.closeModal()">Cancel</button>
                    <button class="btn btn-primary" data-on-click="Inventory._confirmBulkPrice()">Apply</button>
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
                <button class="modal-close" data-on-click="Utils.closeModal()">×</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">Reorder Level (units)</label>
                    <input type="number" id="bulk-reorder-val" class="form-input" placeholder="e.g. 10" min="0">
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" data-on-click="Utils.closeModal()">Cancel</button>
                    <button class="btn btn-primary" data-on-click="Inventory._confirmBulkReorder()">Apply</button>
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
                    <button class="modal-close" data-on-click="Utils.closeModal()">&times;</button>
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
                        <button class="btn btn-secondary" data-on-click="Utils.closeModal()">Close</button>
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
                <button class="modal-close" data-on-click="Utils.closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                <form id="adjust-form" data-on-submit="Inventory.submitAdjust($event)">
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
                    <button class="btn btn-outline" data-on-click="Inventory.downloadTemplate()">
                        📥 Download Template
                    </button>
                    <button class="btn btn-outline" data-on-click="Dom.clickById('stocktake-upload')">
                        📤 Upload Counts
                    </button>
                    <input type="file" id="stocktake-upload" accept=".csv" hidden data-on-change="Inventory.handleFileUpload($el)">
                    
                    <button class="btn btn-secondary" data-on-click="Inventory.cancelStocktake()">Cancel</button>
                    <button class="btn btn-primary" data-on-click="Inventory.reviewStocktake()">Review & Commit</button>
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
                                                   data-on-input="Inventory.calcVariance($el)">
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
            const token = sessionStorage.getItem('zspos_token');
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
            const token = sessionStorage.getItem('zspos_token');
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
                <button class="modal-close" data-on-click="Utils.closeModal()">&times;</button>
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
                    <button class="btn btn-primary" data-on-click="Inventory.confirmCommit()">Commit Adjustments</button>
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
            <div id="scanner-container" data-style="width: 100%; height: 300px; background: #000;"></div>
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
            const res = await fetch('/api/products/import-template', {
                headers: { 'Authorization': `Bearer ${API.token}` }
            });
            if (!res.ok) throw new Error('Failed to download template');
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'product_import_template.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (err) {
            Utils.toast(err.message || 'Failed to download template', 'error');
        }
    },

    async openProductModal(productId = null) {
        try {
            const settings = await API.get('/settings');
            // Default lists if not set
            let categories = settings['inventory.categories'] || ['General', 'Stationery', 'Electronics', 'Services'];
            let uoms = settings['inventory.uoms'] || ['Piece', 'Box', 'Kg', 'Liter', 'Meter', 'Sq Meter', 'Sq Foot', 'Sheet', 'Roll', 'Inch', 'Cm', 'Hour', 'Set', 'Pack', 'Pair'];

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
                    <button class="modal-close" data-on-click="Utils.closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="product-form" data-on-submit="Inventory.saveProduct($event)">
                        ${productId ? `<input type="hidden" name="product_id" value="${productId}">` : ''}
                        
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <!-- Basic Info -->
                            <div class="form-group">
                                <label>Barcode / SKU</label>
                                <div class="flex gap-2">
                                    <input type="text" name="barcode" id="prod-barcode" class="form-input" value="${product.barcode || ''}" placeholder="Scan or enter code">
                                    <button type="button" class="btn btn-sm btn-secondary" data-on-click="Inventory.scanToInput('prod-barcode')" title="Scan"><i class="fas fa-barcode"></i></button>
                                </div>
                            </div>
                            <div class="form-group">
                                <label>Product Name <span class="text-red-500">*</span></label>
                                <div class="flex gap-2">
                                    <input type="text" name="name" id="prod-name" class="form-input flex-1" value="${product.name || ''}" required placeholder="e.g. Wireless Mouse">
                                    <button type="button" class="btn btn-sm btn-secondary" data-on-click="Inventory.aiSuggest()" title="AI suggest category, price & reorder level"><i class="fas fa-magic"></i> Suggest</button>
                                </div>
                                <span id="ai-suggest-note" class="text-xs text-purple-700 mt-1 block"></span>
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
        scannerOverlay.setAttribute('data-style', 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:2000;display:flex;flex-direction:column;align-items:center;justify-content:center;');
        scannerOverlay.innerHTML = `
            <div id="temp-scanner-container" data-style="width:100%;max-width:500px;height:350px;background:#000;"></div>
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
    },

    // ── Duplicate Detection & Merge ───────────────────────────────────────────

    async findDuplicates() {
        try {
            Utils.toast('Scanning for duplicates…', 'info');
            const data = await API.get('/products/duplicates');
            const exact = data.exact || [];
            const fuzzy = data.fuzzy || [];

            if (!exact.length && !fuzzy.length) {
                return Utils.toast('No duplicate products found! 🎉', 'success');
            }

            // Build modal HTML
            const exactHTML = exact.map(group => {
                const prods = group.products;
                return `
                    <div data-style="border:1px solid var(--color-border);border-radius:8px;padding:14px;margin-bottom:12px;">
                        <div data-style="font-weight:700;margin-bottom:8px;">📌 Exact: "${prods[0].name}" &mdash; ${prods.length} copies</div>
                        <div data-style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
                            ${prods.map(p => `
                                <label data-style="display:flex;align-items:flex-start;gap:6px;border:1px solid var(--color-border);border-radius:6px;padding:8px 10px;cursor:pointer;min-width:180px;">
                                    <input type="radio" name="keep-${group.group_key}" value="${p.product_id}" ${prods.indexOf(p) === 0 ? 'checked' : ''}>
                                    <div class="text-sm">
                                        <div class="font-bold">#${p.product_id}</div>
                                        <div class="text-secondary">Stock: ${p.stock_quantity}</div>
                                        <div class="text-secondary">Price: K${parseFloat(p.unit_price).toFixed(2)}</div>
                                        <div class="text-secondary">Sales: ${p.sales_count}</div>
                                    </div>
                                </label>
                            `).join('')}
                        </div>
                        <button class="btn btn-danger btn-sm" data-on-click="Inventory.mergeGroup('${group.group_key.replace(/'/g, "\\'")}',[${prods.map(p => p.product_id).join(',')}])">
                            <span class="material-icons-outlined" data-style="font-size:14px;vertical-align:middle;">merge</span> Merge (keep selected)
                        </button>
                    </div>
                `;
            }).join('');

            const fuzzyHTML = fuzzy.length ? `
                <h4 data-style="margin:16px 0 8px;font-weight:700;">🔍 Similar Names (trigram ≥ 50%)</h4>
                ${fuzzy.map(pair => `
                    <div data-style="border:1px dashed var(--color-border);border-radius:8px;padding:12px;margin-bottom:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                        <div class="text-sm flex-1"><strong>#${pair.id_a}</strong> ${pair.name_a}<br><span class="text-secondary">K${parseFloat(pair.price_a).toFixed(2)} · stock: ${pair.stock_a}</span></div>
                        <div class="badge badge-warning">${Math.round(pair.sim * 100)}% similar</div>
                        <div class="text-sm flex-1"><strong>#${pair.id_b}</strong> ${pair.name_b}<br><span class="text-secondary">K${parseFloat(pair.price_b).toFixed(2)} · stock: ${pair.stock_b}</span></div>
                        <button class="btn btn-sm btn-outline" data-on-click="Inventory.mergeGroup(null,[${pair.id_a},${pair.id_b}],${pair.id_a})">Merge → #${pair.id_a}</button>
                    </div>
                `).join('')}
            ` : '';

            // Show in modal
            const overlay = document.createElement('div');
            overlay.id = 'dup-overlay';
            overlay.className = 'modal-overlay';
            overlay.innerHTML = `
                <div class="modal" data-style="max-width:700px;width:96%;max-height:85vh;display:flex;flex-direction:column;">
                    <div class="modal-header">
                        <h3 class="modal-title">Duplicate Products (${exact.length} exact, ${fuzzy.length} similar)</h3>
                        <button class="modal-close" data-on-click="Dom.removeById('dup-overlay')">×</button>
                    </div>
                    <div class="modal-body" data-style="overflow-y:auto;flex:1;">
                        ${exact.length ? '<h4 data-style="margin-bottom:8px;font-weight:700;">⚡ Exact Duplicates</h4>' + exactHTML : ''}
                        ${fuzzyHTML}
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
        } catch (err) {
            Utils.toast(err.message || 'Failed to scan duplicates', 'error');
        }
    },

    async mergeGroup(groupKey, productIds, forcedKeepId = null) {
        // Determine the keeper from the radio or from the forced parameter
        let keepId = forcedKeepId;
        if (!keepId && groupKey) {
            const selected = document.querySelector(`input[name="keep-${groupKey}"]:checked`);
            keepId = selected ? selected.value : productIds[0];
        }
        const mergeIds = productIds.filter(id => id !== keepId);

        const confirmed = await Utils.confirm(
            `Keep product #${keepId} and absorb ${mergeIds.length} other(s)?\n\nStocks will be combined. Absorbed products will be deactivated.`,
            { title: 'Confirm Merge', confirmText: 'Merge', type: 'danger' }
        );
        if (!confirmed) return;

        try {
            const res = await API.post('/products/merge', { keepId, mergeIds });
            Utils.toast(res.message || 'Merge complete!', 'success');
            // Remove merged group card from the duplicate modal
            const overlay = document.getElementById('dup-overlay');
            if (overlay) overlay.remove();
            // Reload inventory
            await this.loadInventory();
        } catch (err) {
            Utils.toast(err.message || 'Merge failed', 'error');
        }
    }
};

/** Pre-fill the search box and navigate to the inventory page. */
Inventory.openWithSearch = function (name) {
    Inventory.pendingSearch = name;
    window.location.hash = '#/inventory';
};

// Make Inventory globally accessible
window.Inventory = Inventory;
