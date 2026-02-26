/**
 * Zachi Smart-POS — Jobs Module (Frontend)
 * Full job card management with Kanban board, create/edit modals, detail views
 */
const Jobs = {
    jobs: [],
    services: [],
    customers: [],
    users: [],
    stats: null,
    currentView: 'kanban', // 'kanban' or 'list'

    STATUSES: ['Pending', 'Designing', 'Proof Sent', 'Printing', 'Finishing', 'Ready', 'Delivered', 'Collected'],
    STATUS_COLORS: {
        Pending: '#6b7280', Designing: '#8b5cf6', 'Proof Sent': '#3b82f6',
        Printing: '#f59e0b', Finishing: '#10b981', Ready: '#059669',
        Delivered: '#047857', Collected: '#1B3A5C'
    },
    STATUS_ICONS: {
        Pending: '⏳', Designing: '🎨', 'Proof Sent': '📋',
        Printing: '🖨️', Finishing: '✂️', Ready: '✅',
        Delivered: '🚚', Collected: '📦'
    },
    PRIORITY_COLORS: { Low: '#6b7280', Normal: '#2563eb', High: '#f59e0b', Urgent: '#ef4444' },

    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h2>Job Cards</h2>
                    <p class="page-subtitle">Production pipeline — print & graphics jobs</p>
                </div>
                <div class="page-actions">
                    <div class="view-toggle" id="job-view-toggle">
                        <button class="view-btn active" data-view="kanban" title="Kanban Board">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="10" rx="1"/></svg>
                        </button>
                        <button class="view-btn" data-view="list" title="List View">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>
                        </button>
                    </div>
                    <select id="job-filter-priority" class="form-select" style="min-width:120px">
                        <option value="">All Priority</option>
                        <option value="Urgent">🔴 Urgent</option>
                        <option value="High">🟠 High</option>
                        <option value="Normal">🔵 Normal</option>
                        <option value="Low">⚪ Low</option>
                    </select>
                    <button class="btn btn-primary" id="btn-new-job">+ New Job</button>
                </div>
            </div>

            <!-- Pipeline Stats -->
            <div class="job-pipeline-stats" id="job-pipeline-stats"></div>

            <!-- Kanban Board -->
            <div class="job-kanban" id="job-kanban" style="display:block"></div>

            <!-- List View (hidden by default) -->
            <div class="table-container" id="job-list-view" style="display:none">
                <table class="data-table" id="jobs-table">
                    <thead>
                        <tr>
                            <th>Job #</th><th>Service</th><th>Customer</th><th>Assigned</th>
                            <th>Priority</th><th>Status</th><th>Deadline</th><th>Balance</th><th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="jobs-tbody"></tbody>
                </table>
            </div>
        `;

        // View toggle
        document.querySelectorAll('#job-view-toggle .view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#job-view-toggle .view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentView = btn.dataset.view;
                document.getElementById('job-kanban').style.display = this.currentView === 'kanban' ? 'block' : 'none';
                document.getElementById('job-list-view').style.display = this.currentView === 'list' ? 'block' : 'none';
            });
        });

        document.getElementById('btn-new-job').addEventListener('click', () => this.showCreateModal());
        document.getElementById('job-filter-priority').addEventListener('change', () => this.applyFilters());

        // Load reference data + jobs
        await Promise.all([this.loadRefData(), this.loadJobs(), this.loadStats()]);
    },

    async loadRefData() {
        try {
            const [servicesData, customersData, usersData] = await Promise.all([
                API.get('/services').catch(() => ({ services: [] })),
                API.get('/customers').catch(() => ({ customers: [] })),
                API.get('/users').catch(() => [])
            ]);
            this.services = servicesData.services || [];
            this.customers = customersData.customers || [];
            this.users = Array.isArray(usersData) ? usersData : (usersData?.users || []);
        } catch { /* silent */ }
    },

    async loadStats() {
        try {
            this.stats = await API.get('/jobs/stats/pipeline');
            this.renderStats();
        } catch { /* silent */ }
    },

    renderStats() {
        const el = document.getElementById('job-pipeline-stats');
        if (!this.stats) { el.innerHTML = ''; return; }
        const s = this.stats;
        el.innerHTML = `
            <div class="stats-row">
                <div class="stat-chip"><span class="stat-num">${s.active || 0}</span><span class="stat-label">Active</span></div>
                <div class="stat-chip stat-urgent"><span class="stat-num">${s.urgent || 0}</span><span class="stat-label">Urgent</span></div>
                <div class="stat-chip"><span class="stat-num">${Utils.currency(s.total_balance_due || 0)}</span><span class="stat-label">Balance Due</span></div>
                ${(s.pipeline || []).map(p => `
                    <div class="stat-chip" style="border-color: ${this.STATUS_COLORS[p.status] || '#6b7280'}">
                        <span class="stat-num">${p.count}</span><span class="stat-label">${this.STATUS_ICONS[p.status] || ''} ${p.status}</span>
                    </div>
                `).join('')}
            </div>
        `;
    },

    async loadJobs() {
        try {
            this.jobs = await API.get('/jobs');
            this.applyFilters();
        } catch (err) {
            Utils.toast('Failed to load jobs.', 'error');
        }
    },

    applyFilters() {
        const priority = document.getElementById('job-filter-priority')?.value || '';
        let filtered = this.jobs;
        if (priority) filtered = filtered.filter(j => j.priority === priority);
        this.renderKanban(filtered);
        this.renderTable(filtered);
    },

    // ── KANBAN BOARD ──

    renderKanban(jobs) {
        const el = document.getElementById('job-kanban');
        el.innerHTML = `<div class="kanban-board">${this.STATUSES.map(status => {
            const items = jobs.filter(j => j.status === status);
            return `
                <div class="kanban-column" data-status="${status}">
                    <div class="kanban-header" style="border-top: 3px solid ${this.STATUS_COLORS[status]}">
                        <span>${this.STATUS_ICONS[status]} ${status}</span>
                        <span class="kanban-count">${items.length}</span>
                    </div>
                    <div class="kanban-cards">
                        ${items.length ? items.map(j => this.renderKanbanCard(j)).join('') : '<div class="kanban-empty">No jobs</div>'}
                    </div>
                </div>
            `;
        }).join('')}</div>`;
    },

    renderKanbanCard(j) {
        const deadline = j.deadline ? new Date(j.deadline) : null;
        const overdue = deadline && deadline < new Date() && !['Ready', 'Delivered', 'Collected'].includes(j.status);
        return `
            <div class="kanban-card ${j.priority === 'Urgent' ? 'kanban-urgent' : ''} ${overdue ? 'kanban-overdue' : ''}" onclick="Jobs.showDetailModal(${j.job_id})">
                <div class="kanban-card-header">
                    <span class="kanban-job-num">${j.job_number}</span>
                    <span class="badge badge-sm" style="background:${this.PRIORITY_COLORS[j.priority]}">${j.priority}</span>
                </div>
                <div class="kanban-card-service">${j.service_name || 'General'}</div>
                <div class="kanban-card-customer">
                    ${j.customer_name || 'Walk-in'}
                    ${j.customer_type && j.customer_type !== 'Walk-in' ? `<span style="font-size:0.65em; opacity:0.7">(${j.customer_type})</span>` : ''}
                </div>
                <div class="kanban-card-footer">
                    ${j.assigned_name ? `<span class="kanban-assignee" title="${j.assigned_name}">${j.assigned_name.charAt(0)}</span>` : ''}
                    ${deadline ? `<span class="kanban-deadline ${overdue ? 'text-danger' : ''}">${deadline.toLocaleDateString('en-ZM', { month: 'short', day: 'numeric' })}</span>` : ''}
                    ${j.balance_due > 0 ? `<span class="kanban-balance">${Utils.currency(j.balance_due)}</span>` : ''}
                </div>
            </div>
        `;
    },

    // ── LIST VIEW ──

    renderTable(jobs) {
        const tbody = document.getElementById('jobs-tbody');
        if (!jobs.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No job cards found. Create your first job!</td></tr>';
            return;
        }
        tbody.innerHTML = jobs.map(j => `
            <tr class="clickable-row" onclick="Jobs.showDetailModal(${j.job_id})">
                <td><strong>${j.job_number || '—'}</strong></td>
                <td>${j.service_name || '—'}</td>
                <td>
                    ${j.customer_name || 'Walk-in'}
                    ${j.customer_type ? `<small class="text-secondary d-block" style="font-size:0.7em">${j.customer_type}</small>` : ''}
                </td>
                <td>${j.assigned_name || '<em>Unassigned</em>'}</td>
                <td><span class="badge" style="background:${this.PRIORITY_COLORS[j.priority]}">${j.priority}</span></td>
                <td><span class="badge" style="background:${this.STATUS_COLORS[j.status]}">${j.status}</span></td>
                <td>${j.deadline ? new Date(j.deadline).toLocaleDateString() : '—'}</td>
                <td>${Utils.currency(j.balance_due || 0)}</td>
                <td>
                    <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); Jobs.advanceStatus(${j.job_id}, '${j.status}')" title="Advance status">▶</button>
                </td>
            </tr>
        `).join('');
    },

    // ── CREATE JOB MODAL ──

    showCreateModal() {
        const serviceOptions = this.services.map(s => `<option value="${s.service_id}">${s.service_name} — ${Utils.currency(s.base_price || 0)}</option>`).join('');
        const customerOptions = this.customers.map(c => `<option value="${c.customer_id}" data-type="${c.customer_type || 'Walk-in'}">${c.full_name}${c.phone ? ' (' + c.phone + ')' : ''}</option>`).join('');
        const userOptions = this.users.map(u => `<option value="${u.user_id}">${u.full_name} (${u.role})</option>`).join('');

        Utils.showModal(`
            <div class="modal-header">
                <h3>Create New Job Card</h3>
                <button class="modal-close" onclick="Utils.closeModal()">✕</button>
            </div>
            <form id="create-job-form" class="modal-body">
                <div class="form-row">
                    <div class="form-group">
                        <label>Service *</label>
                        <select id="job-service" class="form-select" required>
                            <option value="">Select service...</option>
                            ${serviceOptions}
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Customer</label>
                        <select id="job-customer" class="form-select">
                            <option value="">Walk-in</option>
                            ${customerOptions}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Customer Type</label>
                        <select id="job-customer-type" class="form-select">
                            <option value="Walk-in">Walk-in</option>
                            <option value="Regular">Regular</option>
                            <option value="Corporate">Corporate</option>
                            <option value="Government">Government</option>
                            <option value="NGO">NGO</option>
                        </select>
                    </div>
                </div>
                <!-- ... rest of form ... -->
                <div class="form-row">
                    <div class="form-group">
                        <label>Assigned To</label>
                        <select id="job-assigned" class="form-select">
                            <option value="">Unassigned</option>
                            ${userOptions}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Priority</label>
                        <select id="job-priority" class="form-select">
                            <option value="Normal">Normal</option>
                            <option value="Low">Low</option>
                            <option value="High">High</option>
                            <option value="Urgent">Urgent</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label>Specifications / Instructions</label>
                    <textarea id="job-specs" class="form-input" rows="3" placeholder="e.g. 500 business cards, double-sided, glossy finish"></textarea>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Deadline</label>
                        <input type="date" id="job-deadline" class="form-input">
                    </div>
                    <div class="form-group">
                        <label>Estimated Cost (K)</label>
                        <input type="number" id="job-cost" class="form-input" step="0.01" min="0" placeholder="0.00">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Deposit (K)</label>
                        <input type="number" id="job-deposit" class="form-input" step="0.01" min="0" placeholder="0.00">
                    </div>
                    <div class="form-group">
                        <label>Rush Fee (K)</label>
                        <input type="number" id="job-rush" class="form-input" step="0.01" min="0" placeholder="0.00">
                    </div>
                </div>
                <div class="form-group">
                    <label>File/Design URL</label>
                    <input type="url" id="job-file-url" class="form-input" placeholder="https://drive.google.com/...">
                </div>
            </form>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="Utils.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="btn-save-job">Create Job</button>
            </div>
        `);

        // Auto-select customer type
        document.getElementById('job-customer').addEventListener('change', (e) => {
            const selected = e.target.options[e.target.selectedIndex];
            const type = selected.dataset.type;
            const typeSelect = document.getElementById('job-customer-type');

            if (e.target.value && type) {
                // Map API type to Select type (case insensitive logic or direct map)
                // Assuming customers.customer_type matches or we map it
                const map = { 'walk-in': 'Walk-in', 'regular': 'Regular', 'corporate': 'Corporate' };
                const match = map[type.toLowerCase()] || 'Walk-in';
                typeSelect.value = match;
            } else {
                typeSelect.value = 'Walk-in';
            }
        });

        document.getElementById('btn-save-job').addEventListener('click', () => this.saveNewJob());
    },

    async saveNewJob() {
        const btn = document.getElementById('btn-save-job');
        btn.disabled = true; btn.textContent = 'Creating...';
        try {
            const body = {
                service_id: document.getElementById('job-service').value || null,
                customer_id: document.getElementById('job-customer').value || null,
                customer_type: document.getElementById('job-customer-type').value,
                assigned_to: document.getElementById('job-assigned').value || null,
                priority: document.getElementById('job-priority').value,
                specifications: document.getElementById('job-specs').value,
                deadline: document.getElementById('job-deadline').value || null,
                estimated_cost: parseFloat(document.getElementById('job-cost').value) || 0,
                deposit_amount: parseFloat(document.getElementById('job-deposit').value) || 0,
                rush_fee: parseFloat(document.getElementById('job-rush').value) || 0,
                file_attachment_url: document.getElementById('job-file-url').value || null
            };
            if (!body.service_id) { Utils.toast('Please select a service.', 'warning'); btn.disabled = false; btn.textContent = 'Create Job'; return; }
            await API.post('/jobs', body);
            Utils.closeModal();
            Utils.toast('Job created successfully!', 'success');
            await Promise.all([this.loadJobs(), this.loadStats()]);
        } catch (err) {
            Utils.toast(err.message || 'Failed to create job.', 'error');
            btn.disabled = false; btn.textContent = 'Create Job';
        }
    },

    // ── DETAIL MODAL ──

    async showDetailModal(id) {
        try {
            const job = await API.get(`/jobs/${id}`);
            const userOptions = this.users.map(u => `<option value="${u.user_id}" ${u.user_id === job.assigned_to ? 'selected' : ''}>${u.full_name}</option>`).join('');

            // Status pipeline
            const allStatuses = [...this.STATUSES, 'Delivered', 'Collected'];
            const currentIdx = allStatuses.indexOf(job.status);
            const pipelineHtml = allStatuses.map((s, i) => {
                const cls = i < currentIdx ? 'step-done' : i === currentIdx ? 'step-active' : 'step-pending';
                return `<div class="pipeline-step ${cls}" onclick="Jobs.changeStatus(${job.job_id}, '${s}')" title="Set to ${s}">
                    <span class="step-icon">${this.STATUS_ICONS[s]}</span><span class="step-label">${s}</span>
                </div>`;
            }).join('<div class="step-connector"></div>');

            // Proofs
            const proofsHtml = (job.proofs || []).length ? job.proofs.map(p => `
                <div class="proof-item">
                    <div class="proof-header">
                        <strong>v${p.version}</strong>
                        <span class="badge badge-sm" style="background:${p.status === 'Approved' ? '#10b981' : p.status === 'Rejected' ? '#ef4444' : '#f59e0b'}">${p.status}</span>
                    </div>
                    ${p.file_url ? `<a href="${p.file_url}" target="_blank" class="proof-link">📎 View file</a>` : ''}
                    ${p.notes ? `<p class="proof-notes">${p.notes}</p>` : ''}
                    ${p.status === 'Pending' ? `
                        <div class="proof-actions">
                            <button class="btn btn-sm btn-primary" onclick="Jobs.approveProof(${job.job_id}, ${p.proof_id})">✓ Approve</button>
                            <button class="btn btn-sm btn-outline" onclick="Jobs.rejectProof(${job.job_id}, ${p.proof_id})">✕ Reject</button>
                        </div>
                    ` : ''}
                </div>
            `).join('') : '<p class="text-muted">No proofs uploaded yet.</p>';

            // Costs
            const costsHtml = (job.costs || []).length ? `
                <table class="data-table data-table-compact">
                    <thead><tr><th>Type</th><th>Desc</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>
                    <tbody>
                        ${job.costs.map(c => `<tr><td>${c.cost_type}</td><td>${c.description || '—'}</td><td>${c.quantity}</td><td>${Utils.currency(c.unit_cost)}</td><td><strong>${Utils.currency(c.total_cost)}</strong></td></tr>`).join('')}
                    </tbody>
                    <tfoot><tr><td colspan="4"><strong>Total Actual Cost</strong></td><td><strong>${Utils.currency(job.actual_cost || 0)}</strong></td></tr></tfoot>
                </table>
            ` : '<p class="text-muted">No costs recorded yet.</p>';

            // Financial summary
            const totalCharge = (parseFloat(job.estimated_cost) || 0) + (parseFloat(job.rush_fee) || 0);
            const balanceDue = totalCharge - (parseFloat(job.deposit_amount) || 0);

            Utils.showModal(`
                <div class="modal-header">
                    <h3>${job.job_number} — ${job.service_name || 'Job'}</h3>
                    <button class="modal-close" onclick="Utils.closeModal()">✕</button>
                </div>
                <div class="modal-body job-detail-modal">
                    <!-- Status Pipeline -->
                    <div class="status-pipeline">${pipelineHtml}</div>

                    <!-- Info Grid -->
                    <div class="job-info-grid">
                        <div class="info-block">
                            <label>Customer</label>
                            <span>${job.customer_name || 'Walk-in'}${job.customer_phone ? ' · ' + job.customer_phone : ''}</span>
                        </div>
                        <div class="info-block">
                            <label>Assigned To</label>
                            <select id="detail-assigned" class="form-select form-select-sm" onchange="Jobs.quickUpdate(${job.job_id}, 'assigned_to', this.value)">
                                <option value="">Unassigned</option>${userOptions}
                            </select>
                        </div>
                        <div class="info-block">
                            <label>Priority</label>
                            <select id="detail-priority" class="form-select form-select-sm" onchange="Jobs.quickUpdate(${job.job_id}, 'priority', this.value)">
                                ${['Low', 'Normal', 'High', 'Urgent'].map(p => `<option value="${p}" ${p === job.priority ? 'selected' : ''}>${p}</option>`).join('')}
                            </select>
                        </div>
                        <div class="info-block">
                            <label>Deadline</label>
                            <span>${job.deadline ? new Date(job.deadline).toLocaleDateString() : 'None set'}</span>
                        </div>
                    </div>

                    ${job.specifications ? `<div class="specs-block"><label>Specifications</label><p>${job.specifications}</p></div>` : ''}
                    ${job.file_attachment_url ? `<div class="specs-block"><label>Design File</label><a href="${job.file_attachment_url}" target="_blank">📎 ${job.file_attachment_url}</a></div>` : ''}

                    <!-- Financial Summary -->
                    <div class="job-finance-grid">
                        <div class="finance-item"><label>Est. Cost</label><span>${Utils.currency(job.estimated_cost)}</span></div>
                        <div class="finance-item"><label>Rush Fee</label><span>${Utils.currency(job.rush_fee)}</span></div>
                        <div class="finance-item"><label>Deposit</label><span class="text-success">- ${Utils.currency(job.deposit_amount)}</span></div>
                        <div class="finance-item finance-total"><label>Balance Due</label><span>${Utils.currency(balanceDue)}</span></div>
                    </div>

                    <!-- Tabs: Proofs & Costs -->
                    <div class="job-tabs">
                        <button class="tab-btn active" onclick="Jobs.switchTab('proofs')">📋 Proofs (${(job.proofs || []).length})</button>
                        <button class="tab-btn" onclick="Jobs.switchTab('costs')">💰 Costs (${(job.costs || []).length})</button>
                    </div>
                    <div id="tab-proofs" class="tab-content active">
                        ${proofsHtml}
                        <button class="btn btn-sm btn-outline" style="margin-top:0.75rem" onclick="Jobs.showAddProofForm(${job.job_id})">+ Upload Proof</button>
                    </div>
                    <div id="tab-costs" class="tab-content" style="display:none">
                        ${costsHtml}
                        <button class="btn btn-sm btn-outline" style="margin-top:0.75rem" onclick="Jobs.showAddCostForm(${job.job_id})">+ Add Cost</button>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline btn-danger" onclick="Jobs.deleteJob(${job.job_id})">Delete</button>
                    <button class="btn btn-outline" onclick="Utils.closeModal()">Close</button>
                </div>
            `);
        } catch (err) {
            Utils.toast('Failed to load job details.', 'error');
        }
    },

    switchTab(tab) {
        document.querySelectorAll('.job-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => { c.style.display = 'none'; c.classList.remove('active'); });
        event.target.classList.add('active');
        const el = document.getElementById(`tab-${tab}`);
        if (el) { el.style.display = 'block'; el.classList.add('active'); }
    },

    // ── INLINE ACTIONS ──

    async quickUpdate(id, field, value) {
        try {
            await API.patch(`/jobs/${id}`, { [field]: value || null });
            Utils.toast('Updated!', 'success');
            this.loadJobs();
        } catch (err) {
            Utils.toast(err.message || 'Update failed.', 'error');
        }
    },

    async changeStatus(id, newStatus) {
        try {
            await API.patch(`/jobs/${id}/status`, { status: newStatus });
            Utils.toast(`Status → ${newStatus}`, 'success');
            Utils.closeModal();
            await Promise.all([this.loadJobs(), this.loadStats()]);
        } catch (err) {
            Utils.toast(err.message || 'Status change failed.', 'error');
        }
    },

    async advanceStatus(id, currentStatus) {
        const allStatuses = [...this.STATUSES, 'Delivered', 'Collected'];
        const idx = allStatuses.indexOf(currentStatus);
        if (idx < 0 || idx >= allStatuses.length - 1) return;
        const next = allStatuses[idx + 1];
        if (!await Utils.confirm(`Advance to "${next}"?`, { title: 'Advance Status', confirmText: 'Advance', type: 'primary' })) return;
        this.changeStatus(id, next);
    },

    async deleteJob(id) {
        if (!await Utils.confirm('Delete this job card permanently?', { title: 'Delete Job', confirmText: 'Delete', type: 'danger' })) return;
        try {
            await API.delete(`/jobs/${id}`);
            Utils.closeModal();
            Utils.toast('Job deleted.', 'success');
            await Promise.all([this.loadJobs(), this.loadStats()]);
        } catch (err) {
            Utils.toast(err.message || 'Delete failed.', 'error');
        }
    },

    // ── PROOFS ──

    showAddProofForm(jobId) {
        const proofsTab = document.getElementById('tab-proofs');
        proofsTab.innerHTML += `
            <div class="inline-form" id="proof-form" style="margin-top:0.75rem; padding:0.75rem; background:var(--bg-secondary); border-radius:var(--radius-md);">
                <div class="form-group"><label>File URL</label><input type="url" id="proof-url" class="form-input" placeholder="https://drive.google.com/..."></div>
                <div class="form-group"><label>Notes</label><input type="text" id="proof-notes" class="form-input" placeholder="Version notes..."></div>
                <div class="form-row" style="gap:0.5rem">
                    <button class="btn btn-sm btn-primary" onclick="Jobs.saveProof(${jobId})">Upload</button>
                    <button class="btn btn-sm btn-outline" onclick="document.getElementById('proof-form').remove()">Cancel</button>
                </div>
            </div>
        `;
    },

    async saveProof(jobId) {
        const file_url = document.getElementById('proof-url').value;
        const notes = document.getElementById('proof-notes').value;
        try {
            await API.post(`/jobs/${jobId}/proofs`, { file_url, notes });
            Utils.toast('Proof uploaded!', 'success');
            this.showDetailModal(jobId); // Refresh
        } catch (err) {
            Utils.toast(err.message || 'Failed to upload proof.', 'error');
        }
    },

    async approveProof(jobId, proofId) {
        const approved_by = 'Customer';
        try {
            await API.patch(`/jobs/${jobId}/proofs/${proofId}`, { status: 'Approved', approved_by });
            Utils.toast('Proof approved! Job auto-advanced to Printing.', 'success');
            this.showDetailModal(jobId);
            this.loadJobs();
        } catch (err) { Utils.toast(err.message, 'error'); }
    },

    async rejectProof(jobId, proofId) {
        try {
            await API.patch(`/jobs/${jobId}/proofs/${proofId}`, { status: 'Rejected', approved_by: 'Customer' });
            Utils.toast('Proof rejected. Upload a revised version.', 'warning');
            this.showDetailModal(jobId);
        } catch (err) { Utils.toast(err.message, 'error'); }
    },

    // ── COSTS ──

    showAddCostForm(jobId) {
        const costsTab = document.getElementById('tab-costs');
        costsTab.innerHTML += `
            <div class="inline-form" id="cost-form" style="margin-top:0.75rem; padding:0.75rem; background:var(--bg-secondary); border-radius:var(--radius-md);">
                <div class="form-row">
                    <div class="form-group">
                        <label>Type</label>
                        <select id="cost-type" class="form-select">
                            <option value="material">Material</option>
                            <option value="labour">Labour</option>
                            <option value="machine_time">Machine Time</option>
                            <option value="wastage">Wastage</option>
                            <option value="other">Other</option>
                        </select>
                    </div>
                    <div class="form-group"><label>Description</label><input type="text" id="cost-desc" class="form-input" placeholder="e.g. A4 paper x 2 reams"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Qty</label><input type="number" id="cost-qty" class="form-input" value="1" min="1"></div>
                    <div class="form-group"><label>Unit Cost (K)</label><input type="number" id="cost-unit" class="form-input" step="0.01" min="0"></div>
                </div>
                <div class="form-row" style="gap:0.5rem">
                    <button class="btn btn-sm btn-primary" onclick="Jobs.saveCost(${jobId})">Save Cost</button>
                    <button class="btn btn-sm btn-outline" onclick="document.getElementById('cost-form').remove()">Cancel</button>
                </div>
            </div>
        `;
    },

    async saveCost(jobId) {
        try {
            await API.post(`/jobs/${jobId}/costs`, {
                cost_type: document.getElementById('cost-type').value,
                description: document.getElementById('cost-desc').value,
                quantity: parseFloat(document.getElementById('cost-qty').value) || 1,
                unit_cost: parseFloat(document.getElementById('cost-unit').value) || 0
            });
            Utils.toast('Cost recorded!', 'success');
            this.showDetailModal(jobId);
        } catch (err) {
            Utils.toast(err.message || 'Failed to save cost.', 'error');
        }
    }
};
