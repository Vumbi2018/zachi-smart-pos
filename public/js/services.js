/**
 * Zachi Smart-POS - Service Management
 */
const Services = {
    currentCategory: 'All',
    selectedIds: new Set(),

    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Service Management</h1>
                    <p class="text-secondary">Manage non-stock items, labor, and services for POS and Jobs.</p>
                </div>
                <button class="btn btn-primary" onclick="Services.addService()">
                    <span class="material-icons-outlined text-sm">add</span> Add New Service
                </button>
            </div>

            <!-- Bulk Action Toolbar -->
            <div id="bulk-toolbar-services" class="hidden mb-4 p-3 rounded-lg flex items-center gap-3 flex-wrap" style="background:var(--color-primary,#1B3A5C);color:#fff;">
                <span id="bulk-count-services" class="font-bold text-sm">0 selected</span>
                <div class="flex gap-2 flex-wrap ml-auto">
                    <button class="btn btn-xs" style="background:#ef4444;color:#fff;border:none;" onclick="Services.bulkDeleteSelected()">
                        <i class="fas fa-trash mr-1"></i> Delete Selected
                    </button>
                    <button class="btn btn-xs" style="background:#f59e0b;color:#fff;border:none;" onclick="Services.bulkChangeCategory()">
                        <i class="fas fa-tag mr-1"></i> Set Category
                    </button>
                    <button class="btn btn-xs" style="background:#8b5cf6;color:#fff;border:none;" onclick="Services.bulkAdjustPrice()">
                        <i class="fas fa-percent mr-1"></i> Adjust Price %
                    </button>
                    <button class="btn btn-xs btn-outline" style="color:#fff;border-color:#fff;" onclick="Services.clearSelection()">
                        ✕ Deselect All
                    </button>
                </div>
            </div>

            <div class="card overflow-hidden">
                <div id="services-tabs" class="premium-tab-nav bg-surface">
                    <div class="premium-tab-item active" onclick="Services.switchTab('All')">
                        <span>All Services</span>
                        <span class="premium-tab-badge" id="badge-all">0</span>
                    </div>
                </div>
                
                <div class="card-header flex justify-between items-center px-6 py-4 border-b">
                    <h3 class="font-bold" id="current-tab-title">All Services</h3>
                    <div class="flex gap-2">
                        <div class="relative">
                            <span class="material-icons-outlined absolute left-3 top-1/2 -translate-y-1/2 text-secondary text-sm">search</span>
                            <input type="text" id="service-search" class="form-input text-sm pl-9" placeholder="Search services..." onkeyup="Services.filterServices()">
                        </div>
                    </div>
                </div>
                <div class="card-body p-0">
                    <div class="overflow-x-auto">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th style="width:32px;">
                                        <input type="checkbox" id="select-all-services" title="Select All" onchange="Services.toggleSelectAll(this.checked)">
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
                                <tr><td colspan="6" class="text-center py-8 text-secondary">Loading services...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
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
            if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-danger">Failed to load services.</td></tr>';
        }
    },

    renderTabs() {
        const tabNav = document.getElementById('services-tabs');
        if (!tabNav) return;

        // Start with standard/frequent categories, then add any custom ones from actual data
        const categories = new Set(['All', 'General', 'Labor', 'Software', 'Installation', 'Repair']);
        this.allServices.forEach(s => {
            if (s.category && s.category.trim()) categories.add(s.category.trim());
        });

        tabNav.innerHTML = Array.from(categories).map(cat => {
            const count = cat === 'All' ? this.allServices.length : this.allServices.filter(s => s.category === cat).length;
            // Only show category if it has items, OR if it's one of the core categories
            if (count === 0 && !['All', 'General', 'Labor'].includes(cat)) return '';

            return `
                <div class="premium-tab-item ${this.currentCategory === cat ? 'active' : ''}" data-category="${cat}" onclick="Services.switchTab('${cat}')">
                    <span>${cat === 'All' ? 'All Services' : cat}</span>
                    <span class="premium-tab-badge">${count}</span>
                </div>
            `;
        }).join('');
    },

    switchTab(category) {
        this.currentCategory = category;

        // Update UI
        document.querySelectorAll('.tab-item').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.category === category);
        });

        document.getElementById('current-tab-title').textContent = category === 'All' ? 'All Services' : `${category} Services`;

        this.filterServices();
    },

    renderTable(services) {
        const tbody = document.getElementById('services-list-body');
        if (!tbody) return;

        if (!services || services.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-secondary">No services found.</td></tr>';
            return;
        }

        tbody.innerHTML = services.map(s => `
            <tr class="${this.selectedIds.has(s.service_id) ? 'bg-primary/5' : ''}">
                <td>
                    <input type="checkbox" ${this.selectedIds.has(s.service_id) ? 'checked' : ''} onchange="Services.toggleSelect(${s.service_id}, this.checked)">
                </td>
                <td><strong>${s.service_name}</strong></td>
                <td><span class="badge badge-info">${s.category || 'General'}</span></td>
                <td>${Utils.currency(s.base_price)}</td>
                <td><span class="text-xs text-secondary">${s.unit_measure || 'fixed'}</span></td>
                <td>
                    <span class="status-dot ${s.is_active ? 'bg-success' : 'bg-danger'}"></span>
                    ${s.is_active ? 'Active' : 'Inactive'}
                </td>
                <td class="text-right">
                    <button class="btn btn-icon" onclick="Services.editService(${s.service_id})" title="Edit">
                        <span class="material-icons-outlined">edit</span>
                    </button>
                    <button class="btn btn-icon text-danger" onclick="Services.deleteService(${s.service_id})" title="Delete">
                        <span class="material-icons-outlined">delete</span>
                    </button>
                </td>
            </tr>
        `).join('');

        this.updateBulkToolbar();
    },

    toggleSelect(id, checked) {
        if (checked) this.selectedIds.add(id);
        else this.selectedIds.delete(id);

        // Re-render to show selection highlight
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
        const query = document.getElementById('service-search').value.toLowerCase();
        const filtered = this.allServices.filter(s => {
            const matchesSearch = s.service_name.toLowerCase().includes(query) ||
                (s.category && s.category.toLowerCase().includes(query));
            const matchesCategory = this.currentCategory === 'All' || s.category === this.currentCategory;
            return matchesSearch && matchesCategory;
        });
        this.renderTable(filtered);
    },

    async addService() {
        this.openServiceModal();
    },

    async editService(id) {
        this.openServiceModal(id);
    },

    async openServiceModal(serviceId = null) {
        try {
            let service = {};
            if (serviceId) {
                service = this.allServices.find(s => s.service_id === serviceId) || {};
            }

            // Get unique categories from current services for the dropdown
            const categories = new Set(['General', 'Installation', 'Repair', 'Software', 'Support']);
            this.allServices.forEach(s => { if (s.category) categories.add(s.category); });

            Utils.showModal(`
                <div class="modal-header">
                    <h2 class="modal-title">${serviceId ? 'Edit Service' : 'Add New Service'}</h2>
                    <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="service-form" onsubmit="Services.saveService(event)">
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
                                    <button type="button" class="btn btn-secondary btn-sm" onclick="Services.promptNewCategory()" title="Add New Category">+</button>
                                </div>
                            </div>

                            <div class="form-group">
                                <label class="form-label">Unit Measure</label>
                                <select name="unit_measure" class="form-input">
                                    <option value="fixed" ${service.unit_measure === 'fixed' ? 'selected' : ''}>Fixed Price</option>
                                    <option value="hour" ${service.unit_measure === 'hour' ? 'selected' : ''}>Per Hour</option>
                                    <option value="item" ${service.unit_measure === 'item' ? 'selected' : ''}>Per Item</option>
                                    <option value="km" ${service.unit_measure === 'km' ? 'selected' : ''}>Per KM</option>
                                </select>
                            </div>

                            <div class="form-group">
                                <label class="form-label">Base Price <span class="text-red-500">*</span></label>
                                <input type="number" name="base_price" class="form-input" step="0.01" value="${service.base_price || ''}" required placeholder="0.00">
                            </div>

                            <div class="form-group">
                                <label class="form-label">Status</label>
                                <select name="is_active" class="form-input">
                                    <option value="true" ${service.is_active !== false ? 'selected' : ''}>Active</option>
                                    <option value="false" ${service.is_active === false ? 'selected' : ''}>Inactive</option>
                                </select>
                            </div>
                        </div>

                        <div class="form-group mt-4">
                            <label class="form-label">Description (Optional)</label>
                            <textarea name="description" class="form-input" rows="2" placeholder="Brief details about the service...">${service.description || ''}</textarea>
                        </div>

                        <div class="modal-footer mt-6">
                            <button type="button" class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
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

    async saveService(e) {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        const payload = Object.fromEntries(formData.entries());

        // Validations
        if (!payload.service_name || !payload.base_price) {
            Utils.toast('Name and Base Price are required', 'warning');
            return;
        }

        // Format data
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
            App.state.services = null; // Invalidate cache
            this.loadServices();
        } catch (err) {
            console.error(err);
            Utils.toast(err.message || `Failed to ${isEdit ? 'update' : 'create'} service`, 'error');
        }
    },

    async deleteService(id) {
        if (!await Utils.confirm('Are you sure you want to delete this service?')) return;
        try {
            await API.request('delete', `/services/${id}`);
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
                <button class="modal-close" onclick="Utils.closeModal()">×</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">New Category</label>
                    <input list="bulk-service-cat-list" id="bulk-service-cat-input" class="form-input" placeholder="Type or choose a category">
                    <datalist id="bulk-service-cat-list">${options}</datalist>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="Services._confirmBulkCategory()">Apply</button>
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
                <button class="modal-close" onclick="Utils.closeModal()">×</button>
            </div>
            <div class="modal-body">
                <p class="text-secondary text-sm mb-3">Enter a percentage change. Use positive to increase, negative to decrease (e.g. 10 for +10%, -5 for -5%).</p>
                <div class="form-group">
                    <label class="form-label">% Change</label>
                    <input type="number" id="bulk-service-price-pct" class="form-input" placeholder="e.g. 10" step="0.1">
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="Services._confirmBulkPrice()">Apply</button>
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
