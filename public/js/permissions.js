const Permissions = {
  _allPermissions: [],
  _matrix: {},

  async render(container) {
    container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Access Control (RBAC)</h1>
                    <p class="text-secondary">Tick a box to grant a permission to that role. Director always has full access.</p>
                </div>
            </div>

            <div class="card overflow-hidden">
                <div class="p-4 border-b bg-white/5 flex flex-wrap gap-3 justify-between items-center">
                    <div class="flex items-center gap-3 flex-wrap">
                        <h3 class="font-bold">Permission Matrix</h3>
                        <input type="search" id="perm-search" class="form-input form-input-sm"
                               placeholder="Search permissions…" data-style="min-width:240px;"
                               data-on-input="Permissions.filterMatrix($value)">
                    </div>
                    <div class="flex gap-2">
                        <button class="btn btn-sm btn-secondary" data-on-click="Permissions.toggleColumn('manager', true)">All to Manager</button>
                        <button class="btn btn-sm btn-secondary" data-on-click="Permissions.toggleColumn('manager', false)">Clear Manager</button>
                        <button class="btn btn-sm btn-primary" data-on-click="Permissions.saveChanges()">Save Changes</button>
                    </div>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse" id="permissions-table">
                        <thead>
                            <tr class="text-xs uppercase text-secondary border-b border-white/10">
                                <th class="p-4 w-1/3">Permission / Resource</th>
                                <th class="p-4 text-center">Director</th>
                                <th class="p-4 text-center">Manager</th>
                                <th class="p-4 text-center">Cashier</th>
                                <th class="p-4 text-center">Designer</th>
                                <th class="p-4 text-center">Consultant</th>
                            </tr>
                        </thead>
                        <tbody id="permissions-tbody">
                            <tr><td colspan="6" class="p-8 text-center">Loading...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

             <div class="mt-4 text-xs text-secondary p-2">
                Tip: type in the search box to filter rows by permission name.
                Director role short-circuits every permission check, so its column is locked on.
            </div>
        `;

    this.loadMatrix();
  },

  /** Live filter — keeps rows whose permission name or description
   *  contains the typed substring (case-insensitive). */
  filterMatrix(term) {
    const q = String(term || '').trim().toLowerCase();
    document.querySelectorAll('#permissions-tbody tr').forEach((row) => {
      const text = (row.dataset.permName || '') + ' ' + (row.dataset.permDesc || '');
      row.style.display = !q || text.toLowerCase().includes(q) ? '' : 'none';
    });
  },

  /** Bulk grant/revoke a column for the given role. Director column is
   *  locked, so this only ever runs for manager/cashier/designer/consultant. */
  toggleColumn(role, on) {
    if (role === 'director') return;
    document
      .querySelectorAll(`#permissions-table input[type="checkbox"][data-role="${role}"]:not(:disabled)`)
      .forEach((cb) => {
        // Only flip rows that are currently visible (respect search).
        const tr = cb.closest('tr');
        if (tr && tr.style.display !== 'none') cb.checked = !!on;
      });
  },

  async loadMatrix() {
    try {
      const [params, matrix] = await Promise.all([
        API.get('/permissions'),     // Get all definitions
        API.get('/permissions/matrix') // Get current assignments
      ]);
      this._allPermissions = params || [];
      this._matrix = matrix || {};
      this.renderMatrix(params, matrix);
    } catch (err) {
      console.error(err);
      Utils.toast('Failed to load permissions. Ensure database is initialized.', 'error');
      document.getElementById('permissions-tbody').innerHTML = `
                <tr><td colspan="6" class="p-8 text-center text-red-500">
                    Failed to load permissions. <br>
                    <span class="text-xs text-secondary">Database tables 'permissions' or 'role_permissions' might be missing.</span>
                </td></tr>
            `;
    }
  },

  renderMatrix(permissions, matrix) {
    const tbody = document.getElementById('permissions-tbody');
    const roles = ['director', 'manager', 'cashier', 'designer', 'consultant'];

    // Group permissions by resource/module if possible, or just list
    // Assuming permissions have names like 'products.create', 'sales.view'

    // Sort by module/resource (text before the dot) then by full name
    // so related rows cluster together — much easier to scan + tick.
    const sorted = [...permissions].sort((a, b) => {
      const an = (a.name || '').toLowerCase();
      const bn = (b.name || '').toLowerCase();
      const am = an.split('.')[0]; const bm = bn.split('.')[0];
      return am === bm ? an.localeCompare(bn) : am.localeCompare(bm);
    });
    let lastModule = null;
    tbody.innerHTML = sorted.map(perm => {
      const module = (perm.name || '').split('.')[0] || 'misc';
      const moduleHeader = module !== lastModule
        ? `<tr class="bg-white/5"><td colspan="6" class="px-4 py-2 text-xs uppercase tracking-wider text-white/60 font-semibold">${module}</td></tr>`
        : '';
      lastModule = module;
      const escName = String(perm.name || '').replace(/"/g, '&quot;');
      const escDesc = String(perm.description || '').replace(/"/g, '&quot;');
      return moduleHeader + `
                <tr class="border-b border-white/5 last:border-0 hover:bg-white/5"
                    data-perm-name="${escName}" data-perm-desc="${escDesc}">
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
      // Pass through as a string — permission_id is a UUID in prod.
      const permId = cb.dataset.perm;
      if (!permId || permId === 'undefined' || permId === 'null') return;

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

// Expose to global scope for delegated event handlers (data-on-* attributes).
window.Permissions = Permissions;
