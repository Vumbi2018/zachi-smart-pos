/**
 * Zachi Smart-POS - Service Management
 */
const Services = {
    currentCategory: 'All',
    selectedIds: new Set(),
    allServices: [],
    _displayedItems: [],
    // Pagination
    _page: 1,
    _pageSize: 25,
    _filteredItems: [],

    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Service Management</h1>
                    <p class="text-secondary">Manage non-stock items, labor, and services for POS and Jobs.</p>
                </div>
                <button class="btn btn-primary" data-on-click="Services.addService()">
                    <span class="material-icons-outlined text-sm">add</span> Add New Service
                </button>
            </div>

            <!-- Bulk Action Toolbar -->
            <div id="bulk-toolbar-services" class="hidden mb-4 p-3 rounded-lg flex items-center gap-3 flex-wrap" data-style="background:var(--color-primary,#1B3A5C);color:#fff;">
                <span id="bulk-count-services" class="font-bold text-sm">0 selected</span>
                <div class="flex gap-2 flex-wrap ml-auto">
                    <button class="btn btn-xs" data-style="background:#ef4444;color:#fff;border:none;" data-on-click="Services.bulkDeleteSelected()">
                        <i class="fas fa-trash mr-1"></i> Delete Selected
                    </button>
                    <button class="btn btn-xs" data-style="background:#f59e0b;color:#fff;border:none;" data-on-click="Services.bulkChangeCategory()">
                        <i class="fas fa-tag mr-1"></i> Set Category
                    </button>
                    <button class="btn btn-xs" data-style="background:#8b5cf6;color:#fff;border:none;" data-on-click="Services.bulkAdjustPrice()">
                        <i class="fas fa-percent mr-1"></i> Adjust Price %
                    </button>
                    <button class="btn btn-xs btn-outline" data-style="color:#fff;border-color:#fff;" data-on-click="Services.clearSelection()">
                        ✕ Deselect All
                    </button>
                </div>
            </div>

            <div class="card overflow-hidden">
                <div id="services-tabs" class="premium-tab-nav bg-surface">
                    <div class="premium-tab-item active" data-on-click="Services.switchTab('All')">
                        <span>All Services</span>
                        <span class="premium-tab-badge" id="badge-all">0</span>
                    </div>
                </div>
                
                <div class="card-header flex justify-between items-center px-6 py-4 border-b">
                    <h3 class="font-bold" id="current-tab-title">All Services</h3>
                    <div class="flex gap-2">
                        <div class="relative">
                            <span class="material-icons-outlined absolute left-3 top-1/2 -translate-y-1/2 text-secondary text-sm">search</span>
                            <input type="text" id="service-search" class="form-input text-sm pl-9" placeholder="Search services..." data-on-keyup="Services.filterServices()">
                        </div>
                    </div>
                </div>
                <div class="card-body p-0">
                    <div id="svc-table-wrap" data-style="overflow:auto;max-height:65vh;">
                        <table class="data-table">
                            <thead data-style="position:sticky;top:0;z-index:10;background:var(--color-surface,#fff);">
                                <tr>
                                    <th data-style="width:32px;">
                                        <input type="checkbox" id="select-all-services" title="Select All" data-on-change="Services.toggleSelectAll($checked)">
                                    </th>
                                    <th>Service Name</th>
                                    <th>Category</th>
                                    <th>Base Price</th>
                                    <th>Unit Measure</th>
                                    <th>Status</th>
                                    <th class="text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody id="services-list-body">
                                <tr><td colspan="7" class="text-center py-8 text-secondary">Loading services...</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <div id="svc-pagination" class="px-4 py-2 border-t flex items-center justify-between gap-3 text-sm" data-style="min-height:44px;"></div>
                </div>
            </div>
            <!-- Sticky-header / inline-edit styles moved to /css/styles.css (Task #7) -->
        `;

        this.loadServices();
    },

    async loadServices() {
        try {
            // Check cache
            if (App.state.services && (Date.now() - (App.state.lastFetch['services'] || 0) < 300000)) {
                this.allServices = App.state.services;
            } else {
                const { services } = await API.get('/services?active_only=false');
                this.allServices = services || [];
                App.state.services = this.allServices;
                App.state.lastFetch['services'] = Date.now();
            }

            this.renderTabs();
            this.switchTab(this.currentCategory || 'All');
        } catch (err) {
            console.error(err);
            const tbody = document.getElementById('services-list-body');
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-danger">Failed to load services.</td></tr>';
        }
    },

    renderTabs() {
        const tabNav = document.getElementById('services-tabs');
        if (!tabNav) return;

        const categories = new Set(['All', 'General', 'Labor', 'Software', 'Installation', 'Repair']);
        this.allServices.forEach(s => {
            if (s.category && s.category.trim()) categories.add(s.category.trim());
        });

        tabNav.innerHTML = Array.from(categories).map(cat => {
            const count = cat === 'All' ? this.allServices.length : this.allServices.filter(s => s.category === cat).length;
            if (count === 0 && !['All', 'General', 'Labor'].includes(cat)) return '';

            return `
                <div class="premium-tab-item ${this.currentCategory === cat ? 'active' : ''}" data-category="${cat}" data-on-click="Services.switchTab('${cat}')">
                    <span>${cat === 'All' ? 'All Services' : cat}</span>
                    <span class="premium-tab-badge">${count}</span>
                </div>
            `;
        }).join('');
    },

    switchTab(category) {
        this.currentCategory = category;
        this._page = 1; // reset page when switching tabs

        document.querySelectorAll('.premium-tab-item').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.category === category);
        });

        const titleEl = document.getElementById('current-tab-title');
        if (titleEl) titleEl.textContent = category === 'All' ? 'All Services' : `${category} Services`;

        this.filterServices();
    },

    renderTable(services) {
        // -- Pagination --
        this._filteredItems = services;
        const start = (this._page - 1) * this._pageSize;
        const paged = services.slice(start, start + this._pageSize);
        this._displayedItems = paged;
        const tbody = document.getElementById('services-list-body');
        if (!tbody) return;

        if (!services || services.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-secondary">No services found.</td></tr>';
            this._renderPagination();
            return;
        }

        // Helper: editable cell — single-click to edit inline
        const ed = (id, field, display, type = 'text', extraClass = '') =>
            `<td class="svc-editable ${extraClass}" data-id="${id}" data-field="${field}" data-type="${type}"
                data-on-click="Services._inlineEdit($el)"
                title="Click to edit">${display}</td>`;

        tbody.innerHTML = paged.map(s => `
            <tr class="${this.selectedIds.has(s.service_id) ? 'bg-primary/5' : ''}">
                <td>
                    <input type="checkbox" ${this.selectedIds.has(s.service_id) ? 'checked' : ''} data-on-change="Services.toggleSelect(${s.service_id}, $checked)">
                </td>
                ${ed(s.service_id, 'service_name', `<strong>${s.service_name}</strong>`, 'text')}
                ${ed(s.service_id, 'category', `<span class="badge badge-info">${s.category || 'General'}</span>`, 'text', 'text-center')}
                ${ed(s.service_id, 'base_price', Utils.currency(s.base_price), 'number', 'text-right')}
                ${ed(s.service_id, 'unit_measure', `<span class="text-xs text-secondary">${s.unit_measure || 'fixed'}</span>`, 'select')}
                ${ed(s.service_id, 'is_active',
            `<span class="status-dot ${s.is_active ? 'bg-success' : 'bg-danger'}"></span>${s.is_active ? 'Active' : 'Inactive'}`,
            'select')}
                <td class="text-right" data-stop="click">
                    <button class="btn btn-icon" data-on-click="Services.editService(${s.service_id})" title="Edit All Fields">
                        <span class="material-icons-outlined">edit</span>
                    </button>
                    <button class="btn btn-icon text-danger" data-on-click="Services.deleteService(${s.service_id})" title="Delete">
                        <span class="material-icons-outlined">delete</span>
                    </button>
                </td>
            </tr>
        `).join('');

        this.updateBulkToolbar();
        this._renderPagination();
    },

    // ── Pagination ────────────────────────────────────────────────────────────

    _renderPagination() {
        const el = document.getElementById('svc-pagination');
        if (!el) return;
        const total = (this._filteredItems || []).length;
        const ps = this._pageSize;
        const p = this._page;
        const totalPages = Math.max(1, Math.ceil(total / ps));
        const from = total === 0 ? 0 : (p - 1) * ps + 1;
        const to = Math.min(p * ps, total);
        el.innerHTML = `
            <span class="text-secondary">Showing ${from}&ndash;${to} of ${total} services</span>
            <div class="flex items-center gap-2">
                <select data-on-change="Services._setPageSize($valueNum)"
                    data-style="padding:3px 8px;border:1px solid #ddd;border-radius:4px;font-size:.85rem;cursor:pointer;">
                    ${[10, 25, 50, 100].map(n => `<option value="${n}" ${n === ps ? 'selected' : ''}>${n}&nbsp;/&nbsp;page</option>`).join('')}
                </select>
                <button class="btn btn-xs btn-outline" data-on-click="Services._goToPage(1)" ${p <= 1 ? 'disabled' : ''}>«</button>
                <button class="btn btn-xs btn-outline" data-on-click="Services._goToPage(${p - 1})" ${p <= 1 ? 'disabled' : ''}>&#8249;</button>
                <span data-style="font-size:.875rem;white-space:nowrap;">Page ${p} of ${totalPages}</span>
                <button class="btn btn-xs btn-outline" data-on-click="Services._goToPage(${p + 1})" ${p >= totalPages ? 'disabled' : ''}>&#8250;</button>
                <button class="btn btn-xs btn-outline" data-on-click="Services._goToPage(${totalPages})" ${p >= totalPages ? 'disabled' : ''}>»</button>
            </div>
        `;
    },

    _goToPage(p) {
        const total = (this._filteredItems || []).length;
        const totalPages = Math.max(1, Math.ceil(total / this._pageSize));
        this._page = Math.max(1, Math.min(+p, totalPages));
        this.renderTable(this._filteredItems);
        // Scroll table back to top on page change
        const wrap = document.getElementById('svc-table-wrap');
        if (wrap) wrap.scrollTop = 0;
    },

    _setPageSize(n) {
        this._pageSize = +n;
        this._page = 1;
        this.renderTable(this._filteredItems);
    },

    // ── Inline Editing ───────────────────────────────────────────────────────

    _inlineEdit(td) {
        if (td.querySelector('input, select')) return; // already editing
        const field = td.dataset.field;
        const type = td.dataset.type || 'text';
        const id = td.dataset.id;
        const svc = (this.allServices || []).find(x => x.service_id === id);
        if (!svc) return;

        const rawVal = svc[field] !== undefined ? svc[field] : '';
        const origHTML = td.innerHTML;

        let input;

        if (type === 'select') {
            input = document.createElement('select');

            if (field === 'unit_measure') {
                ['fixed', 'hour', 'item', 'km'].forEach(v => {
                    const o = document.createElement('option');
                    o.value = v;
                    o.textContent = v.charAt(0).toUpperCase() + v.slice(1);
                    if (v === rawVal) o.selected = true;
                    input.appendChild(o);
                });
            } else if (field === 'is_active') {
                [{ v: true, l: 'Active' }, { v: false, l: 'Inactive' }].forEach(({ v, l }) => {
                    const o = document.createElement('option');
                    o.value = v;
                    o.textContent = l;
                    if (v === rawVal) o.selected = true;
                    input.appendChild(o);
                });
            }
        } else {
            input = document.createElement('input');
            input.type = type;
            input.value = rawVal;
        }

        td.innerHTML = '';
        td.appendChild(input);
        input.focus();

        const save = () => this._inlineSave(td, id, field, type, input.value, origHTML);
        input.addEventListener('blur', save);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { td.innerHTML = origHTML; input.removeEventListener('blur', save); }
        });
    },

    async _inlineSave(td, id, field, type, value, origHTML) {
        const svc = (this.allServices || []).find(x => x.service_id === id);
        if (!svc) { td.innerHTML = origHTML; return; }

        let parsed = value;
        if (type === 'number') {
            parsed = parseFloat(value);
            if (isNaN(parsed)) { td.innerHTML = origHTML; return; }
        } else if (field === 'is_active') {
            parsed = value === 'true' || value === true;
        }

        // Skip save if nothing changed
        if (svc[field] === parsed) { this.filterServices(); return; }

        td.style.opacity = '0.5';
        try {
            await API.request(`/services/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ ...svc, [field]: parsed })
            });
            svc[field] = parsed;                      // update in-memory
            if (App.state) App.state.services = null; // bust cache
            this.filterServices();
            Utils.toast('Saved', 'success');
        } catch (err) {
            td.innerHTML = origHTML;
            td.style.opacity = '';
            Utils.toast(err.message || 'Save failed', 'error');
        }
    },

    // ── Selection ────────────────────────────────────────────────────────────

    toggleSelect(id, checked) {
        if (checked) this.selectedIds.add(id);
        else this.selectedIds.delete(id);
        this.filterServices();
    },

    toggleSelectAll(checked) {
        const query = document.getElementById('service-search').value.toLowerCase();
        const filtered = this.allServices.filter(s => {
            const matchesSearch = s.service_name.toLowerCase().includes(query) ||
                (s.category && s.category.toLowerCase().includes(query));
            const matchesCategory = this.currentCategory === 'All' || s.category === this.currentCategory;
            return matchesSearch && matchesCategory;
        });

        if (checked) {
            filtered.forEach(s => this.selectedIds.add(s.service_id));
        } else {
            filtered.forEach(s => this.selectedIds.delete(s.service_id));
        }

        this.renderTable(filtered);
    },

    updateBulkToolbar() {
        const toolbar = document.getElementById('bulk-toolbar-services');
        const count = document.getElementById('bulk-count-services');
        if (!toolbar || !count) return;

        if (this.selectedIds.size > 0) {
            toolbar.classList.remove('hidden');
            count.textContent = `${this.selectedIds.size} service(s) selected`;
        } else {
            toolbar.classList.add('hidden');
        }
    },

    clearSelection() {
        this.selectedIds.clear();
        const selectAll = document.getElementById('select-all-services');
        if (selectAll) selectAll.checked = false;
        this.filterServices();
    },

    filterServices() {
        const query = document.getElementById('service-search')?.value?.toLowerCase() || '';
        const filtered = this.allServices.filter(s => {
            const matchesSearch = s.service_name.toLowerCase().includes(query) ||
                (s.category && s.category.toLowerCase().includes(query));
            const matchesCategory = this.currentCategory === 'All' || s.category === this.currentCategory;
            return matchesSearch && matchesCategory;
        });
        this.renderTable(filtered);
    },

    // ── CRUD ─────────────────────────────────────────────────────────────────

    async addService() {
        this.openServiceModal();
    },

    async editService(id) {
        this.openServiceModal(id);
    },

    async openServiceModal(serviceId = null) {
        try {
            await this._loadUomsOnce();
            let service = {};
            if (serviceId) {
                service = this.allServices.find(s => s.service_id === serviceId) || {};
            }

            const categories = new Set(['General', 'Installation', 'Repair', 'Software', 'Support']);
            this.allServices.forEach(s => { if (s.category) categories.add(s.category); });

            Utils.showModal(`
                <div class="modal-header">
                    <h2 class="modal-title">${serviceId ? 'Edit Service' : 'Add New Service'}</h2>
                    <button class="modal-close" data-on-click="Utils.closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="service-form" data-on-submit="Services.saveService($event)">
                        ${serviceId ? `<input type="hidden" name="service_id" value="${serviceId}">` : ''}
                        
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div class="form-group md:col-span-2">
                                <label class="form-label">Service Name <span class="text-red-500">*</span></label>
                                <input type="text" name="service_name" class="form-input" value="${service.service_name || ''}" required placeholder="e.g. System Diagnostic">
                            </div>

                            <div class="form-group">
                                <label class="form-label">Category</label>
                                <div class="flex gap-2">
                                    <select name="category" id="service-modal-category" class="form-input">
                                        <option value="">Select Category...</option>
                                        ${Array.from(categories).map(c => `<option value="${c}" ${service.category === c ? 'selected' : ''}>${c}</option>`).join('')}
                                    </select>
                                    <button type="button" class="btn btn-secondary btn-sm" data-on-click="Services.promptNewCategory()" title="Add New Category">+</button>
                                </div>
                            </div>

                            <div class="form-group">
                                <label class="form-label">Unit Measure</label>
                                <div class="flex gap-2">
                                    <select name="unit_measure" id="service-modal-uom" class="form-input">
                                        ${(function () {
                                            const builtins = ['fixed','hour','item','km','sq m','sq ft','sheet','roll','meter','cm','inch','kg','liter'];
                                            const extra = (Services._uoms || []).filter(u => !builtins.includes(String(u).toLowerCase()));
                                            const all = [...builtins, ...extra];
                                            const cur = (service.unit_measure || 'fixed').toLowerCase();
                                            const has = all.some(u => String(u).toLowerCase() === cur);
                                            const opts = all.map(u => `<option value="${u}" ${String(u).toLowerCase() === cur ? 'selected' : ''}>${u === 'fixed' ? 'Fixed Price' : (u === 'hour' ? 'Per Hour' : (u === 'item' ? 'Per Item' : (u === 'km' ? 'Per KM' : 'Per ' + u)))}</option>`);
                                            if (!has && service.unit_measure) opts.push(`<option value="${service.unit_measure}" selected>Per ${service.unit_measure}</option>`);
                                            return opts.join('');
                                        })()}
                                    </select>
                                    <button type="button" class="btn btn-secondary btn-sm" data-on-click="Services.promptNewUom()" title="Add a new unit (e.g. Sq Meter for stickers/banners)">+</button>
                                </div>
                                <span class="text-xs text-secondary">Stickers/banners → use <b>sq m</b>. Paper → <b>sheet</b>. Cable → <b>meter</b>.</span>
                            </div>

                            <div class="form-group">
                                <label class="form-label">Base Price <span class="text-red-500">*</span></label>
                                <input type="number" name="base_price" class="form-input" step="0.01" value="${service.base_price || ''}" required placeholder="0.00">
                            </div>

                            <div class="form-group">
                                <label class="form-label">Status</label>
                                <select name="is_active" class="form-input">
                                    <option value="true"  ${service.is_active !== false ? 'selected' : ''}>Active</option>
                                    <option value="false" ${service.is_active === false ? 'selected' : ''}>Inactive</option>
                                </select>
                            </div>
                        </div>

                        <div class="form-group mt-4">
                            <label class="form-label">Description (Optional)</label>
                            <textarea name="description" class="form-input" rows="2" placeholder="Brief details about the service...">${service.description || ''}</textarea>
                        </div>

                        <div class="modal-footer mt-6">
                            <button type="button" class="btn btn-secondary" data-on-click="Utils.closeModal()">Cancel</button>
                            <button type="submit" class="btn btn-primary">
                                ${serviceId ? 'Update Service' : 'Create Service'}
                            </button>
                        </div>
                    </form>
                </div>
            `);
        } catch (err) {
            console.error(err);
            Utils.toast('Failed to open service modal', 'error');
        }
    },

    async promptNewCategory() {
        const newCat = await Utils.prompt('Enter new category name:', { title: 'New Category' });
        if (!newCat) return;

        const select = document.getElementById('service-modal-category');
        if (select) {
            const option = document.createElement('option');
            option.value = newCat;
            option.textContent = newCat;
            option.selected = true;
            select.appendChild(option);
        }
    },

    /**
     * Add a custom unit-of-measure on the fly so the print shop can ring
     * up bespoke units (e.g. "linear ft", "panel", "A2 sheet"). Persists
     * for this session by appending to the modal's <select>; for full
     * persistence the admin should add it under Settings → Inventory UoMs.
     */
    async promptNewUom() {
        const newUom = await Utils.prompt('Enter new unit (e.g. "sq m", "linear ft", "panel"):', { title: 'New Unit of Measure' });
        if (!newUom) return;
        const select = document.getElementById('service-modal-uom');
        if (select) {
            const option = document.createElement('option');
            option.value = newUom.trim();
            option.textContent = 'Per ' + newUom.trim();
            option.selected = true;
            select.appendChild(option);
        }
    },

    async _loadUomsOnce() {
        if (this._uoms && this._uoms.length) return;
        try {
            const settings = await API.get('/settings');
            let uoms = settings && settings['inventory.uoms'];
            if (typeof uoms === 'string') { try { uoms = JSON.parse(uoms); } catch (_) { uoms = null; } }
            if (Array.isArray(uoms)) this._uoms = uoms;
        } catch (_) { /* fall back to built-ins */ }
    },

    async saveService(e) {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        const payload = Object.fromEntries(formData.entries());

        if (!payload.service_name || !payload.base_price) {
            Utils.toast('Name and Base Price are required', 'warning');
            return;
        }

        // Coerce types
        payload.base_price = parseFloat(payload.base_price);
        payload.is_active = payload.is_active === 'true';

        const serviceId = payload.service_id;
        const isEdit = !!serviceId;
        const endpoint = isEdit ? `/services/${serviceId}` : '/services';
        const method = isEdit ? 'PUT' : 'POST';

        try {
            await API.request(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            Utils.toast(`Service ${isEdit ? 'updated' : 'created'} successfully`, 'success');
            Utils.closeModal();
            App.state.services = null;
            this.loadServices();
        } catch (err) {
            console.error(err);
            Utils.toast(err.message || `Failed to ${isEdit ? 'update' : 'create'} service`, 'error');
        }
    },

    async deleteService(id) {
        if (!await Utils.confirm('Are you sure you want to delete this service?')) return;
        try {
            // FIX: was API.request('delete', url) — wrong arg order
            await API.delete(`/services/${id}`);
            Utils.toast('Service deleted successfully', 'success');
            App.state.services = null;
            this.loadServices();
        } catch (err) {
            console.error(err);
            Utils.toast('Failed to delete service', 'error');
        }
    },

    // ── Bulk Actions ─────────────────────────────────────────────────────────

    async bulkDeleteSelected() {
        const ids = [...this.selectedIds];
        if (ids.length === 0) return;
        if (!await Utils.confirm(`Delete ${ids.length} service(s)? This cannot be undone.`, { title: 'Delete Services', confirmText: 'Yes, Delete', type: 'danger' })) return;

        try {
            const res = await API.post('/services/bulk-delete', { ids });
            Utils.toast(res.message, 'success');
            App.state.services = null;
            this.clearSelection();
            this.loadServices();
        } catch (err) {
            Utils.toast(err.message || 'Bulk delete failed', 'error');
        }
    },

    async bulkChangeCategory() {
        const ids = [...this.selectedIds];
        if (ids.length === 0) return;

        const cats = [...new Set((this.allServices || []).map(s => s.category).filter(Boolean))].sort();
        const options = cats.map(c => `<option value="${c}">${c}</option>`).join('');

        Utils.showModal(`
            <div class="modal-header">
                <h2 class="modal-title">Set Category for ${ids.length} Service(s)</h2>
                <button class="modal-close" data-on-click="Utils.closeModal()">×</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">New Category</label>
                    <input list="bulk-service-cat-list" id="bulk-service-cat-input" class="form-input" placeholder="Type or choose a category">
                    <datalist id="bulk-service-cat-list">${options}</datalist>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" data-on-click="Utils.closeModal()">Cancel</button>
                    <button class="btn btn-primary" data-on-click="Services._confirmBulkCategory()">Apply</button>
                </div>
            </div>
        `);
    },

    async _confirmBulkCategory() {
        const value = document.getElementById('bulk-service-cat-input')?.value?.trim();
        if (!value) return Utils.toast('Please enter a category name', 'warning');
        Utils.closeModal();
        try {
            const res = await API.post('/services/bulk-update', { ids: [...this.selectedIds], action: 'category', value });
            Utils.toast(res.message, 'success');
            App.state.services = null;
            this.clearSelection();
            this.loadServices();
        } catch (err) {
            Utils.toast(err.message || 'Failed', 'error');
        }
    },

    async bulkAdjustPrice() {
        const ids = [...this.selectedIds];
        if (ids.length === 0) return;

        Utils.showModal(`
            <div class="modal-header">
                <h2 class="modal-title">Adjust Price for ${ids.length} Service(s)</h2>
                <button class="modal-close" data-on-click="Utils.closeModal()">×</button>
            </div>
            <div class="modal-body">
                <p class="text-secondary text-sm mb-3">Enter a percentage change. Positive to increase, negative to decrease (e.g. 10 for +10%, -5 for -5%).</p>
                <div class="form-group">
                    <label class="form-label">% Change</label>
                    <input type="number" id="bulk-service-price-pct" class="form-input" placeholder="e.g. 10" step="0.1">
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" data-on-click="Utils.closeModal()">Cancel</button>
                    <button class="btn btn-primary" data-on-click="Services._confirmBulkPrice()">Apply</button>
                </div>
            </div>
        `);
    },

    async _confirmBulkPrice() {
        const value = document.getElementById('bulk-service-price-pct')?.value;
        if (value === '' || isNaN(parseFloat(value))) return Utils.toast('Enter a valid percentage', 'warning');
        Utils.closeModal();
        try {
            const res = await API.post('/services/bulk-update', { ids: [...this.selectedIds], action: 'price', value: parseFloat(value) });
            Utils.toast(res.message, 'success');
            App.state.services = null;
            this.clearSelection();
            this.loadServices();
        } catch (err) {
            Utils.toast(err.message || 'Failed', 'error');
        }
    }
};

// Expose to global scope for delegated event handlers (data-on-* attributes).
window.Services = Services;
