const Promotions = {
    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Promotions & Discounts</h1>
                    <p class="text-secondary">Manage automated pricing rules and offers.</p>
                </div>
                <button class="btn btn-primary" onclick="Promotions.showCreateModal()">+ New Promotion</button>
            </div>

            <div id="promotions-list" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <!-- Promo cards will go here -->
                <div class="text-center p-8 col-span-full"><div class="spinner"></div> Loading...</div>
            </div>
        `;

        this.loadPromotions();
    },

    async loadPromotions() {
        try {
            const promos = await API.get('/pricing/promotions');
            const list = document.getElementById('promotions-list');

            if (promos.length === 0) {
                list.innerHTML = `
                    <div class="empty-state col-span-full">
                        <div class="empty-state-icon">🏷️</div>
                        <h3>No Active Promotions</h3>
                        <p>Create a promotion to drive sales.</p>
                        <button class="btn btn-primary mt-4" onclick="Promotions.showCreateModal()">Create First Promo</button>
                    </div>
                `;
                return;
            }

            list.innerHTML = promos.map(p => `
                <div class="card relative overflow-hidden">
                    <div class="absolute top-0 right-0 p-2">
                        <button class="text-red-600 hover:bg-red-50 p-1 rounded" onclick="Promotions.deletePromo(${p.promo_id})" title="Deactivate">✕</button>
                    </div>
                    <div class="card-body">
                        <div class="flex items-center gap-2 mb-2">
                            <span class="badge badge-success">Active</span>
                            <span class="text-xs text-secondary">${p.discount_type === 'percentage' ? '%' : '$'}</span>
                        </div>
                        <h3 class="font-bold text-lg mb-1">${p.name}</h3>
                        <p class="text-sm text-secondary mb-4">${p.description || 'No description'}</p>
                        
                        <div class="text-sm space-y-2">
                            <div class="flex justify-between border-b pb-1">
                                <span>Discount:</span>
                                <strong>${p.discount_type === 'percentage' ? p.discount_value + '%' : Utils.formatCurrency(p.discount_value)}</strong>
                            </div>
                            <div class="flex justify-between border-b pb-1">
                                <span>Applies to:</span>
                                <span class="capitalize">${p.applies_to}</span>
                            </div>
                            <div class="flex justify-between border-b pb-1">
                                <span>Min. Spend:</span>
                                <span>${Utils.formatCurrency(p.min_purchase)}</span>
                            </div>
                            <div class="flex justify-between">
                                <span>Valid:</span>
                                <span>${p.end_date ? new Date(p.end_date).toLocaleDateString() : 'Indefinitely'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');

        } catch (err) {
            console.error(err);
            Utils.toast('Failed to load promotions', 'error');
        }
    },

    showCreateModal() {
        Utils.showModal(`
            <div class="modal-header">
                <h2 class="modal-title">Create Promotion</h2>
                <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                <form id="promo-form" class="space-y-4">
                    <div class="form-group">
                        <label>Promotion Name</label>
                        <input type="text" name="name" class="form-input" required placeholder="e.g. Summer Sale">
                    </div>
                    
                    <div class="form-group">
                        <label>Description</label>
                        <textarea name="description" class="form-input" rows="2" placeholder="Customer facing description"></textarea>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div class="form-group">
                            <label>Discount Type</label>
                            <select name="discount_type" class="form-select" onchange="Promotions.toggleValueLabel(this.value)">
                                <option value="percentage">Percentage (%)</option>
                                <option value="fixed_amount">Fixed Amount (Currency)</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label id="discount-label">Percentage Value</label>
                            <input type="number" name="discount_value" class="form-input" required step="0.01" min="0">
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div class="form-group">
                            <label>Applies To</label>
                            <select name="applies_to" class="form-select" onchange="Promotions.toggleAppliesTo(this.value)">
                                <option value="all">Entire Cart / Order</option>
                                <option value="category">Specific Category</option>
                                <option value="product">Specific Product</option>
                            </select>
                        </div>
                        <div class="form-group hidden" id="applies-to-id-group">
                            <label id="applies-to-label">Select Category/Product</label>
                            <input type="text" name="applies_to_id" id="applies_to_id" class="form-input" placeholder="Enter ID or Name">
                            <p class="text-xs text-secondary mt-1">For MVP, enter exact category name or product ID</p>
                        </div>
                    </div>

                    <div class="form-group">
                        <label>Minimum Purchase Amount</label>
                        <input type="number" name="min_purchase" class="form-input" value="0">
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div class="form-group">
                            <label>Start Date</label>
                            <input type="date" name="start_date" class="form-input" value="${new Date().toISOString().split('T')[0]}">
                        </div>
                        <div class="form-group">
                            <label>End Date (Optional)</label>
                            <input type="date" name="end_date" class="form-input">
                        </div>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
                <button class="btn btn-primary" onclick="Promotions.submitCreate()">Create Promotion</button>
            </div>
        `);
    },

    toggleValueLabel(type) {
        document.getElementById('discount-label').textContent = type === 'percentage' ? 'Percentage Value (%)' : 'Discount Amount';
    },

    toggleAppliesTo(type) {
        const group = document.getElementById('applies-to-id-group');
        const label = document.getElementById('applies-to-label');

        if (type === 'all') {
            group.classList.add('hidden');
        } else {
            group.classList.remove('hidden');
            label.textContent = type === 'category' ? 'Category Name' : 'Product ID';
        }
    },

    async submitCreate() {
        const form = document.getElementById('promo-form');
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        try {
            await API.post('/pricing/promotions', data);
            Utils.closeModal();
            Utils.toast('Promotion created!', 'success');
            this.loadPromotions();
        } catch (err) {
            Utils.toast(err.message || 'Failed to create promotion', 'error');
        }
    },

    async deletePromo(id) {
        if (!await Utils.confirm('Are you sure you want to deactivate this promotion?', { title: 'Deactivate Promotion', confirmText: 'Deactivate', type: 'warning' })) return;
        try {
            await API.delete(`/pricing/promotions/${id}`);
            Utils.toast('Promotion deactivated', 'info');
            this.loadPromotions();
        } catch (err) {
            Utils.toast('Failed to deactivate', 'error');
        }
    }
};
