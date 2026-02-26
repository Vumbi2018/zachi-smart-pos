const Audit = {
    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Audit Trail</h1>
                    <p class="text-secondary">View system logs and user activity.</p>
                </div>
            </div>

            <div class="card p-4 mb-6">
                <form id="audit-filter-form" class="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div class="form-group mb-0">
                        <label>User</label>
                        <select id="filter-user" class="form-select">
                            <option value="">All Users</option>
                        </select>
                    </div>
                    <div class="form-group mb-0">
                        <label>Action</label>
                        <input type="text" id="filter-action" class="form-input" placeholder="e.g. LOGIN, UPDATE...">
                    </div>
                    <div class="form-group mb-0">
                        <label>Date</label>
                        <input type="date" id="filter-date" class="form-input">
                    </div>
                    <div>
                        <button type="submit" class="btn btn-primary w-full">Apply Filters</button>
                    </div>
                </form>
            </div>

            <div class="card overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse text-sm">
                        <thead>
                            <tr class="text-xs uppercase text-secondary border-b bg-gray-50">
                                <th class="p-3">Time</th>
                                <th class="p-3">User</th>
                                <th class="p-3">Action</th>
                                <th class="p-3">Table/Entity</th>
                                <th class="p-3 w-1/3">Details (Diff)</th>
                                <th class="p-3">IP</th>
                            </tr>
                        </thead>
                        <tbody id="audit-logs-body">
                            <tr><td colspan="6" class="p-4 text-center">Loading...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        this.loadUsers();
        this.loadLogs();

        document.getElementById('audit-filter-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.loadLogs();
        });
    },

    async loadUsers() {
        try {
            const users = await API.get('/users');
            const select = document.getElementById('filter-user');
            users.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.user_id;
                opt.textContent = u.full_name;
                select.appendChild(opt);
            });
        } catch (e) {
            console.error('Failed to load users for filter');
        }
    },

    async loadLogs() {
        const user = document.getElementById('filter-user').value;
        const action = document.getElementById('filter-action').value;
        const date = document.getElementById('filter-date').value;

        const params = new URLSearchParams();
        if (user) params.append('user_id', user);
        if (action) params.append('action', action);
        if (date) params.append('start_date', date);

        try {
            const logs = await API.get(`/audit?${params.toString()}`);
            this.renderLogs(logs);
        } catch (err) {
            console.error(err);
            Utils.toast('Failed to load audit logs', 'error');
        }
    },

    renderLogs(logs) {
        const tbody = document.getElementById('audit-logs-body');
        if (logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-secondary">No logs found matching criteria.</td></tr>`;
            return;
        }

        tbody.innerHTML = logs.map(log => {
            let details = '';
            if (log.old_value || log.new_value) {
                // Simple diff view logic could go here
                // For now, just show formatted JSON if new_value exists
                try {
                    const newVal = JSON.parse(log.new_value);
                    details = `<pre class="text-xs bg-gray-50 p-1 rounded overflow-x-auto" style="max-height:100px;">${JSON.stringify(newVal, null, 2)}</pre>`;
                } catch (e) {
                    details = log.new_value || '';
                }
            }

            return `
                <tr class="border-b last:border-0 hover:bg-gray-50">
                    <td class="p-3 text-secondary whitespace-nowrap">${Utils.dateTime(log.created_at)}</td>
                    <td class="p-3 font-medium">${log.full_name || 'System'}</td>
                    <td class="p-3"><span class="badge badge-secondary">${log.action}</span></td>
                    <td class="p-3 text-secondary">
                        ${log.table_name || '-'}<br>
                        <span class="text-xs">ID: ${log.record_id || '-'}</span>
                    </td>
                    <td class="p-3 font-mono text-xs text-gray-600">${details}</td>
                    <td class="p-3 text-xs text-secondary">${log.ip_address || '-'}</td>
                </tr>
            `;
        }).join('');
    }
};
