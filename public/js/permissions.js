const Permissions = {
  async render(container) {
    container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Access Control (RBAC)</h1>
                    <p class="text-secondary">Manage system permissions for each user role.</p>
                </div>
            </div>

            <div class="card overflow-hidden">
                <div class="p-4 border-b bg-gray-50 flex justify-between items-center">
                    <h3 class="font-bold">Permission Matrix</h3>
                    <button class="btn btn-sm btn-primary" onclick="Permissions.saveChanges()">Save Changes</button>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse" id="permissions-table">
                        <thead>
                            <tr class="text-xs uppercase text-secondary border-b">
                                <th class="p-4 w-1/3">Permission / Resource</th>
                                <th class="p-4 text-center">Director</th>
                                <th class="p-4 text-center">Manager</th>
                                <th class="p-4 text-center">Cashier</th>
                                <th class="p-4 text-center">Designer</th>
                            </tr>
                        </thead>
                        <tbody id="permissions-tbody">
                            <tr><td colspan="5" class="p-8 text-center">Loading...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
            
             <div class="mt-4 text-xs text-secondary p-2">
                * Note: 'Director' role typically has full access regardless of these settings.
            </div>
        `;

    this.loadMatrix();
  },

  async loadMatrix() {
    try {
      const [params, matrix] = await Promise.all([
        API.get('/permissions'),     // Get all definitions
        API.get('/permissions/matrix') // Get current assignments
      ]);

      this.renderMatrix(params, matrix);
    } catch (err) {
      console.error(err);
      Utils.toast('Failed to load permissions. Ensure database is initialized.', 'error');
      document.getElementById('permissions-tbody').innerHTML = `
                <tr><td colspan="5" class="p-8 text-center text-red-500">
                    Failed to load permissions. <br>
                    <span class="text-xs text-secondary">Database tables 'permissions' or 'role_permissions' might be missing.</span>
                </td></tr>
            `;
    }
  },

  renderMatrix(permissions, matrix) {
    const tbody = document.getElementById('permissions-tbody');
    const roles = ['director', 'manager', 'cashier', 'designer'];

    // Group permissions by resource/module if possible, or just list
    // Assuming permissions have names like 'products.create', 'sales.view'

    tbody.innerHTML = permissions.map(perm => {
      return `
                <tr class="border-b last:border-0 hover:bg-gray-50">
                    <td class="p-4">
                        <div class="font-medium">${perm.name}</div>
                        <div class="text-xs text-secondary">${perm.description || ''}</div>
                    </td>
                    ${roles.map(role => {
        const hasPerm = (matrix[role] || []).includes(perm.permission_id);
        const disabled = role === 'director' ? 'disabled checked' : ''; // Director always has access
        const checked = hasPerm ? 'checked' : '';

        return `
                            <td class="p-4 text-center">
                                <input type="checkbox" class="form-checkbox h-5 w-5 text-primary" 
                                    data-role="${role}" 
                                    data-perm="${perm.permission_id}"
                                    ${disabled || checked}>
                            </td>
                        `;
      }).join('')}
                </tr>
            `;
    }).join('');
  },

  async saveChanges() {
    const checkboxes = document.querySelectorAll('#permissions-table input[type="checkbox"]:not(:disabled)');
    const updates = {}; // role -> [perm_ids]

    checkboxes.forEach(cb => {
      const role = cb.dataset.role;
      const permId = parseInt(cb.dataset.perm);

      if (!updates[role]) updates[role] = [];
      if (cb.checked) updates[role].push(permId);
    });

    // Send updates per role
    const roles = Object.keys(updates);
    let successCount = 0;

    try {
      for (const role of roles) {
        await API.put(`/permissions/role/${role}`, { permissionIds: updates[role] });
        successCount++;
      }
      Utils.toast(`Updated permissions for ${successCount} roles.`, 'success');
      this.loadMatrix(); // Reload to confirm
    } catch (err) {
      Utils.toast('Failed to save permissions', 'error');
    }
  }
};
