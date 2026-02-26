const Payments = {
    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Payment Methods</h1>
                    <p class="text-secondary">Manage accepted payment types and configurations.</p>
                </div>
                <button class="btn btn-primary" onclick="Payments.showModal()">
                    + Add Method
                </button>
            </div>

            <div class="card">
                <div class="card-body">
                    <div class="table-responsive">
                        <table class="table" id="payments-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Type</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr><td colspan="4" class="text-center">Loading...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;

        await this.loadPayments();
    },

    async loadPayments() {
        try {
            const methods = await API.get('/payments?all=true');
            const tbody = document.querySelector('#payments-table tbody');

            if (methods.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No payment methods found</td></tr>';
                return;
            }

            tbody.innerHTML = methods.map(p => `
                <tr class="${!p.is_active ? 'opacity-50' : ''}">
                    <td class="font-medium">${p.name}</td>
                    <td><span class="badge badge-outline">${p.type}</span></td>
                    <td>
                        <span class="badge ${p.is_active ? 'badge-success' : 'badge-secondary'}">
                            ${p.is_active ? 'Active' : 'Inactive'}
                        </span>
                    </td>
                    <td>
                        <div class="flex gap-2">
                            <button class="btn btn-sm btn-outline" onclick="Payments.showModal(${p.id})">Edit</button>
                            ${p.is_active
                    ? `<button class="btn btn-sm btn-outline-danger" onclick="Payments.toggleStatus(${p.id}, false)">Deactivate</button>`
                    : `<button class="btn btn-sm btn-outline-success" onclick="Payments.toggleStatus(${p.id}, true)">Activate</button>`
                }
                        </div>
                    </td>
                </tr>
            `).join('');

            // Save data for editing
            this.methods = methods;
        } catch (err) {
            console.error(err);
            Utils.toast('Failed to load payment methods', 'error');
        }
    },

    showModal(id = null) {
        const method = id ? this.methods.find(m => m.id === id) : null;
        const isEdit = !!method;

        const content = `
            <form id="payment-form">
                <div class="form-group">
                    <label>Method Name</label>
                    <input type="text" name="name" class="form-input" required value="${method ? method.name : ''}" placeholder="e.g. M-Pesa">
                </div>
                
                <div class="form-group">
                    <label>Type</label>
                    <select name="type" class="form-select" required>
                        <option value="cash" ${method?.type === 'cash' ? 'selected' : ''}>Cash</option>
                        <option value="card" ${method?.type === 'card' ? 'selected' : ''}>Card / POS</option>
                        <option value="mobile" ${method?.type === 'mobile' ? 'selected' : ''}>Mobile Money</option>
                        <option value="bank" ${method?.type === 'bank' ? 'selected' : ''}>Bank Transfer</option>
                        <option value="credit" ${method?.type === 'credit' ? 'selected' : ''}>Store Credit</option>
                    </select>
                </div>

                <div class="form-group">
                    <label class="flex items-center gap-2">
                        <input type="checkbox" name="is_active" ${!method || method.is_active ? 'checked' : ''}>
                        <span>Active</span>
                    </label>
                </div>

                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">${isEdit ? 'Update' : 'Create'}</button>
                </div>
            </form>
        `;

        Utils.showModal(`
            <div class="modal-header">
                <h3>${isEdit ? 'Edit Payment Method' : 'New Payment Method'}</h3>
                <button class="modal-close" onclick="Utils.closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                ${content}
            </div>
        `);

        // Wait for DOM
        setTimeout(() => {
            const form = document.getElementById('payment-form');
            if (!form) return;

            form.onsubmit = async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const data = {
                    name: formData.get('name'),
                    type: formData.get('type'),
                    is_active: formData.get('is_active') === 'on'
                };

                try {
                    if (isEdit) {
                        await API.put(`/payments/${id}`, data);
                        Utils.toast('Payment method updated', 'success');
                    } else {
                        await API.post('/payments', data);
                        Utils.toast('Payment method created', 'success');
                    }
                    Utils.closeModal();
                    this.loadPayments();
                } catch (err) {
                    console.error(err);
                    Utils.toast(err.response?.data?.error || 'Operation failed', 'error');
                }
            };
        }, 100);
    },

    async toggleStatus(id, isActive) {
        try {
            await API.put(`/payments/${id}`, { is_active: isActive });
            Utils.toast(`Payment method ${isActive ? 'activated' : 'deactivated'}`, 'success');
            this.loadPayments();
        } catch (err) {
            console.error(err);
            Utils.toast('Failed to update status', 'error');
        }
    }
};
