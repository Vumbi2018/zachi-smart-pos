/**
 * Zachi Smart-POS - Customers Module
 */
const Customers = {
  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h2>👥 Customers</h2>
        <div class="header-actions">
          <button class="btn btn-outline" onclick="Customers.downloadTemplate()" title="Download CSV Template">📄 Template</button>
          <button class="btn btn-outline" onclick="Customers.exportCustomers()">⬇️ Export</button>
          <button class="btn btn-outline" onclick="Customers.triggerImport()">⬆️ Import</button>
          <input type="file" id="cust-import-input" accept=".csv" class="hidden" onchange="Customers.handleFileSelect(event)">
          <button class="btn btn-primary" id="btn-add-customer">+ Add Customer</button>
        </div>
      </div>
      
      <div class="search-bar">
        <input type="text" id="cust-search" placeholder="Search by name, phone, or company...">
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Company</th>
              <th>Type</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="cust-table-body">
            <tr><td colspan="6" class="text-center text-muted" style="padding:2rem;">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('cust-search').addEventListener('input', Utils.debounce(() => this.loadCustomers(), 300));
    document.getElementById('btn-add-customer').addEventListener('click', () => this.showCustomerModal());
    await this.loadCustomers();
  },

  async loadCustomers() {
    try {
      const search = document.getElementById('cust-search').value;
      const data = await API.get(`/customers?search=${encodeURIComponent(search)}`);
      const tbody = document.getElementById('cust-table-body');

      if (!data.customers.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:2rem;">No customers found</td></tr>';
        return;
      }

      tbody.innerHTML = data.customers.map(c => `
        <tr>
          <td><strong>${c.full_name}</strong></td>
          <td>${c.phone || '—'}</td>
          <td>${c.email || '—'}</td>
          <td>${c.company_name || '—'}</td>
          <td><span class="badge badge-${c.customer_type === 'corporate' ? 'info' : c.customer_type === 'regular' ? 'success' : 'neutral'}">${c.customer_type}</span></td>
          <td>
            <button class="btn btn-ghost btn-sm" onclick="Customers.showCustomerModal(${c.customer_id})" title="Edit">✏️</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      Utils.toast('Failed to load customers', 'error');
    }
  },

  async showCustomerModal(customerId) {
    let customer = null;
    const isEdit = !!customerId;

    if (isEdit) {
      try { customer = await API.get(`/customers/${customerId}`); } catch { return; }
    }

    Utils.showModal(`
      <div class="modal-header">
        <h3>${isEdit ? '✏️ Edit Customer' : '+ New Customer'}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Full Name *</label>
          <input type="text" id="cf-name" value="${customer?.full_name || ''}" required>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Phone</label>
            <input type="text" id="cf-phone" value="${customer?.phone || ''}">
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="cf-email" value="${customer?.email || ''}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Company</label>
            <input type="text" id="cf-company" value="${customer?.company_name || ''}">
          </div>
          <div class="form-group">
            <label>Type</label>
            <select id="cf-type">
              <option value="walk-in" ${customer?.customer_type === 'walk-in' ? 'selected' : ''}>Walk-in</option>
              <option value="regular" ${customer?.customer_type === 'regular' ? 'selected' : ''}>Regular</option>
              <option value="corporate" ${customer?.customer_type === 'corporate' ? 'selected' : ''}>Corporate</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>T-PIN (ZRA)</label>
          <input type="text" id="cf-tpin" value="${customer?.t_pin || ''}">
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea id="cf-notes" rows="2">${customer?.notes || ''}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="btn-save-customer">${isEdit ? 'Update' : 'Create'}</button>
      </div>
    `);

    document.getElementById('btn-save-customer').addEventListener('click', async () => {
      const payload = {
        full_name: document.getElementById('cf-name').value.trim(),
        phone: document.getElementById('cf-phone').value.trim() || null,
        email: document.getElementById('cf-email').value.trim() || null,
        company_name: document.getElementById('cf-company').value.trim() || null,
        customer_type: document.getElementById('cf-type').value,
        t_pin: document.getElementById('cf-tpin').value.trim() || null,
        notes: document.getElementById('cf-notes').value.trim() || null
      };

      if (!payload.full_name) {
        Utils.toast('Name is required', 'warning');
        return;
      }

      try {
        if (isEdit) {
          await API.put(`/customers/${customerId}`, payload);
          Utils.toast('Customer updated!', 'success');
        } else {
          await API.post('/customers', payload);
          Utils.toast('Customer created!', 'success');
        }
        Utils.closeModal();
        this.loadCustomers();
      } catch (err) {
        Utils.toast(err.message || 'Failed to save customer', 'error');
      }
    });
  },

  async exportCustomers() {
    try {
      Utils.toast('Preparing export...', 'info');
      const res = await fetch('/api/customers/export', {
        headers: { 'Authorization': `Bearer ${API.token}` }
      });
      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `customers_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      Utils.toast('Export complete', 'success');
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  },

  triggerImport() {
    document.getElementById('cust-import-input').click();
  },

  async handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      Utils.toast('Importing customers...', 'info');
      const res = await fetch('/api/customers/import', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API.token}` },
        body: formData
      });
      const data = await res.json();

      if (res.ok) {
        Utils.toast(`Imported: ${data.imported}, Updated: ${data.updated}`, 'success');
        if (data.errors) {
          console.warn('Import errors:', data.errors);
          Utils.toast('Some rows failed. Check console.', 'warning');
        }
        this.loadCustomers();
      } else {
        throw new Error(data.error || 'Import failed');
      }
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
    event.target.value = ''; // Reset
  },

  async downloadTemplate() {
    try {
      const res = await fetch('/api/customers/import-template', {
        headers: { 'Authorization': `Bearer ${API.token}` }
      });
      if (!res.ok) throw new Error('Failed to download template');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'customer_import_template.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }
};
