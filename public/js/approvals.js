const Approvals = {
    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Approval Queue</h1>
                    <p class="text-secondary">Review and approve pending requests.</p>
                </div>
                <div class="header-actions">
                    <button class="btn btn-outline" onclick="Approvals.loadRequests()">↻ Refresh</button>
                </div>
            </div>

            <div class="card overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="text-xs uppercase text-secondary border-b bg-gray-50">
                                <th class="p-4">Date</th>
                                <th class="p-4">Requester</th>
                                <th class="p-4">Type</th>
                                <th class="p-4">Reason</th>
                                <th class="p-4 text-center">Status</th>
                                <th class="p-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="approvals-tbody">
                            <tr><td colspan="6" class="p-8 text-center">Loading...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        this.loadRequests();
    },

    async loadRequests() {
        try {
            const requests = await API.get('/approvals'); // Backend filters for 'Pending'
            this.renderRequests(requests);
        } catch (err) {
            console.error(err);
            Utils.toast('Failed to load approval requests', 'error');
        }
    },

    renderRequests(requests) {
        const tbody = document.getElementById('approvals-tbody');
        if (requests.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-secondary">No pending approvals.</td></tr>`;
            return;
        }

        tbody.innerHTML = requests.map(req => `
            <tr class="border-b last:border-0 hover:bg-gray-50">
                <td class="p-4 text-sm">${Utils.dateTime(req.created_at)}</td>
                <td class="p-4 font-medium">${req.requester_name}</td>
                <td class="p-4"><span class="badge badge-info">${req.request_type}</span></td>
                <td class="p-4 text-sm text-secondary">${req.reason || '-'}</td>
                <td class="p-4 text-center"><span class="badge badge-warning">Pending</span></td>
                <td class="p-4 text-right">
                    <button class="btn btn-sm btn-success" onclick="Approvals.decide(${req.request_id}, 'Approved', 'Approved by Admin')">✅ Approve</button>
                    <button class="btn btn-sm btn-danger ml-2" onclick="Approvals.decide(${req.request_id}, 'Rejected', 'Rejected by Admin')">✕ Reject</button>
                </td>
            </tr>
        `).join('');
    },

    async decide(id, decision, defaultReason) {
        const reason = await Utils.prompt(`Reason for ${decision}?`, {
            title: 'Approval Decision',
            defaultValue: defaultReason,
            type: decision === 'Approved' ? 'primary' : 'danger'
        });
        if (reason === null) return; // Cancelled

        try {
            await API.post(`/approvals/${id}/decide`, { decision, decision_reason: reason });
            Utils.toast(`Request ${decision}`, decision === 'Approved' ? 'success' : 'info');
            this.loadRequests();
        } catch (err) {
            Utils.toast(err.message || 'Action failed', 'error');
        }
    }
};
