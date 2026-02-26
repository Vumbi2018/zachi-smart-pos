/**
 * Zachi Smart-POS — Cash Drawer Module (Frontend)
 * Full cash session management with proper modals, EOD reconciliation, session history
 */
const CashDrawer = {
    session: null,

    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h2>💰 Cash Drawer</h2>
                    <p class="page-subtitle">Shift management, movements & reconciliation</p>
                </div>
                <div class="page-actions">
                    <button class="btn btn-primary" id="btn-cash-action">Loading...</button>
                    <button class="btn btn-outline" id="btn-cash-history">📊 History</button>
                </div>
            </div>

            <div id="cash-session-content">
                <div class="loading">Loading session...</div>
            </div>
        `;

        document.getElementById('btn-cash-action').addEventListener('click', () => this.handleSessionAction());
        document.getElementById('btn-cash-history').addEventListener('click', () => this.showHistory());
        this.loadCurrentSession();
    },

    async loadCurrentSession() {
        try {
            this.session = await API.get('/cash/current');
            this.renderSession();
        } catch (err) {
            Utils.toast('Failed to load session.', 'error');
        }
    },

    renderSession() {
        const content = document.getElementById('cash-session-content');
        const actionBtn = document.getElementById('btn-cash-action');

        if (!this.session) {
            actionBtn.textContent = '🔓 Open Cash Drawer';
            actionBtn.className = 'btn btn-primary';
            content.innerHTML = `
                <div class="empty-state" style="padding:3rem">
                    <div class="empty-state-icon">💰</div>
                    <h3>No Active Session</h3>
                    <p style="max-width:400px;margin:0.5rem auto">Open a cash drawer session to start recording transactions. All sales will be tracked against the active session.</p>
                    <button class="btn btn-primary" style="margin-top:1rem" onclick="CashDrawer.showOpenDrawerModal()">🔓 Open Cash Drawer</button>
                </div>
            `;
            return;
        }

        actionBtn.textContent = '🔒 Close & Reconcile';
        actionBtn.className = 'btn btn-danger';

        const movements = this.session.movements || [];
        const paidIn = movements.filter(m => m.movement_type === 'paid_in').reduce((s, m) => s + parseFloat(m.amount), 0);
        const paidOut = movements.filter(m => m.movement_type === 'paid_out').reduce((s, m) => s + parseFloat(m.amount), 0);
        const salesCount = movements.filter(m => m.movement_type === 'sale').length;
        const duration = this.getSessionDuration(this.session.opened_at);

        content.innerHTML = `
            <!-- KPI Cards -->
            <div class="cash-kpi-grid">
                <div class="cash-kpi" style="--kpi-color: linear-gradient(90deg, #1B3A5C, #2A6B8A)">
                    <div class="cash-kpi-label">Opening Float</div>
                    <div class="cash-kpi-value">${Utils.currency(this.session.opening_float)}</div>
                    <div class="cash-kpi-sub">Set at ${new Date(this.session.opened_at).toLocaleTimeString()}</div>
                </div>
                <div class="cash-kpi" style="--kpi-color: linear-gradient(90deg, #10b981, #059669)">
                    <div class="cash-kpi-label">Expected Cash</div>
                    <div class="cash-kpi-value">${Utils.currency(this.session.expected_cash)}</div>
                    <div class="cash-kpi-sub">Float + In − Out</div>
                </div>
                <div class="cash-kpi" style="--kpi-color: linear-gradient(90deg, #2A6B8A, #34A77F)">
                    <div class="cash-kpi-label">Session Duration</div>
                    <div class="cash-kpi-value" style="font-size:1.2rem">${duration}</div>
                    <div class="cash-kpi-sub">Opened by ${this.session.opened_by_name}</div>
                </div>
                <div class="cash-kpi" style="--kpi-color: linear-gradient(90deg, #f59e0b, #d97706)">
                    <div class="cash-kpi-label">Movements</div>
                    <div class="cash-kpi-value">${movements.length}</div>
                    <div class="cash-kpi-sub">${salesCount} sales</div>
                </div>
            </div>

            <!-- Quick Actions -->
            <div class="cash-actions-row">
                <button class="btn btn-outline" onclick="CashDrawer.showPaidInModal()">💵 Paid In</button>
                <button class="btn btn-outline" onclick="CashDrawer.showPaidOutModal()">💸 Paid Out</button>
            </div>

            <!-- Movement Log -->
            <div class="table-container">
                <div style="display:flex; justify-content:space-between; align-items:center; padding:0.75rem 1rem; border-bottom:1px solid var(--border)">
                    <h3 style="margin:0; font-size:0.95rem">Cash Movements</h3>
                    <div style="display:flex; gap:0.5rem; font-size:0.78rem; color:var(--text-secondary)">
                        <span>In: <strong style="color:var(--success)">${Utils.currency(paidIn)}</strong></span>
                        <span>Out: <strong style="color:var(--danger)">${Utils.currency(paidOut)}</strong></span>
                    </div>
                </div>
                <table class="data-table">
                    <thead>
                        <tr><th>Time</th><th>Type</th><th>Amount</th><th>Description</th></tr>
                    </thead>
                    <tbody>
                        ${movements.length ? movements.map(m => `
                            <tr>
                                <td>${new Date(m.created_at).toLocaleTimeString()}</td>
                                <td><span class="movement-badge ${m.movement_type}">${this.formatMovementType(m.movement_type)}</span></td>
                                <td style="font-weight:600; color:${['paid_out', 'refund'].includes(m.movement_type) ? 'var(--danger)' : 'var(--text-primary)'}">
                                    ${['paid_out', 'refund'].includes(m.movement_type) ? '-' : '+'}${Utils.currency(m.amount)}
                                </td>
                                <td>${m.description || '—'}</td>
                            </tr>
                        `).join('') : '<tr><td colspan="4" class="empty-state">No movements yet. Record paid-in/out or make a sale.</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;
    },

    formatMovementType(type) {
        const labels = { float: '🏦 Float', sale: '💳 Sale', paid_in: '💵 In', paid_out: '💸 Out', refund: '↩️ Refund' };
        return labels[type] || type;
    },

    getSessionDuration(openedAt) {
        const diff = Date.now() - new Date(openedAt).getTime();
        const hrs = Math.floor(diff / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        return `${hrs}h ${mins}m`;
    },

    handleSessionAction() {
        if (!this.session) {
            this.showOpenDrawerModal();
        } else {
            this.showCloseModal();
        }
    },

    // ── OPEN DRAWER MODAL ──

    showOpenDrawerModal() {
        Utils.showModal(`
            <div class="modal-header">
                <h3>🔓 Open Cash Drawer</h3>
                <button class="modal-close" onclick="Utils.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <p style="margin-bottom:1rem; color:var(--text-secondary); font-size:0.85rem">
                    Enter the opening float amount — the cash in the drawer at the start of this shift. All sales and movements will be tracked against this session.
                </p>
                <div class="form-group">
                    <label>Opening Float (ZMW) *</label>
                    <input type="number" id="open-float" class="form-input" step="0.01" min="0" value="500" style="font-size:1.5rem; font-weight:700; text-align:center" autofocus>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="Utils.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="btn-confirm-open">Open Session</button>
            </div>
        `);
        document.getElementById('btn-confirm-open').addEventListener('click', async () => {
            const btn = document.getElementById('btn-confirm-open');
            btn.disabled = true; btn.textContent = 'Opening...';
            try {
                const opening_float = parseFloat(document.getElementById('open-float').value) || 0;
                await API.post('/cash/open', { opening_float });
                Utils.closeModal();
                Utils.toast('Cash drawer opened!', 'success');
                this.loadCurrentSession();
            } catch (err) {
                Utils.toast(err.message || 'Failed to open session.', 'error');
                btn.disabled = false; btn.textContent = 'Open Session';
            }
        });
    },

    // ── CLOSE & RECONCILE MODAL ──

    showCloseModal() {
        const expected = parseFloat(this.session.expected_cash) || 0;
        Utils.showModal(`
            <div class="modal-header">
                <h3>🔒 Close & Reconcile</h3>
                <button class="modal-close" onclick="Utils.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <div style="text-align:center; margin-bottom:1.25rem; padding:1rem; background:#f0f4f8; border-radius:var(--radius-md)">
                    <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; font-weight:600">Expected Cash in Drawer</div>
                    <div style="font-size:2rem; font-weight:800; color:var(--primary)">${Utils.currency(expected)}</div>
                </div>
                <div class="form-group">
                    <label>Actual Cash Counted (ZMW) *</label>
                    <input type="number" id="close-actual" class="form-input" step="0.01" min="0" value="${expected.toFixed(2)}" style="font-size:1.3rem; font-weight:700; text-align:center" oninput="CashDrawer.updateVariancePreview()">
                </div>
                <div id="variance-preview" style="margin-bottom:1rem"></div>
                <div class="form-group" id="variance-reason-group" style="display:none">
                    <label>Variance Reason *</label>
                    <textarea id="close-variance-reason" class="form-input" rows="2" placeholder="Explain the variance..."></textarea>
                </div>
                <div class="form-group">
                    <label>Notes (optional)</label>
                    <input type="text" id="close-notes" class="form-input" placeholder="Shift notes...">
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="Utils.closeModal()">Cancel</button>
                <button class="btn btn-danger" id="btn-confirm-close">Close Session</button>
            </div>
        `);
        this.updateVariancePreview();
        document.getElementById('btn-confirm-close').addEventListener('click', () => this.confirmClose());
    },

    updateVariancePreview() {
        const expected = parseFloat(this.session.expected_cash) || 0;
        const actual = parseFloat(document.getElementById('close-actual')?.value) || 0;
        const variance = actual - expected;
        const preview = document.getElementById('variance-preview');
        const reasonGroup = document.getElementById('variance-reason-group');

        if (Math.abs(variance) < 0.01) {
            preview.innerHTML = `<div style="text-align:center; color:var(--success); font-weight:700">✅ No variance — perfect match!</div>`;
            if (reasonGroup) reasonGroup.style.display = 'none';
        } else {
            const color = variance > 0 ? 'var(--success)' : 'var(--danger)';
            const label = variance > 0 ? 'OVER' : 'SHORT';
            preview.innerHTML = `
                <div style="text-align:center; padding:0.5rem; background:${variance > 0 ? '#f0fdf4' : '#fef2f2'}; border-radius:var(--radius-sm); border:1px solid ${color}">
                    <span style="font-weight:700; color:${color}; font-size:1.1rem">${label}: ${Utils.currency(Math.abs(variance))}</span>
                </div>
            `;
            if (reasonGroup) reasonGroup.style.display = 'block';
        }
    },

    async confirmClose() {
        const btn = document.getElementById('btn-confirm-close');
        btn.disabled = true; btn.textContent = 'Closing...';
        try {
            const actual_cash = parseFloat(document.getElementById('close-actual').value) || 0;
            const variance_reason = document.getElementById('close-variance-reason')?.value || null;
            const notes = document.getElementById('close-notes')?.value || null;
            await API.post('/cash/close', { actual_cash, variance_reason, notes });
            Utils.closeModal();
            Utils.toast('Session closed successfully!', 'success');
            // Ask to show EOD report
            this.loadCurrentSession();
        } catch (err) {
            Utils.toast(err.message || 'Failed to close session.', 'error');
            btn.disabled = false; btn.textContent = 'Close Session';
        }
    },

    // ── PAID IN MODAL ──

    showPaidInModal() {
        Utils.showModal(`
            <div class="modal-header">
                <h3>💵 Record Paid-In</h3>
                <button class="modal-close" onclick="Utils.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <p style="margin-bottom:1rem; color:var(--text-secondary); font-size:0.85rem">
                    Cash added to the drawer (e.g. float top-up, change from bank, petty cash deposit).
                </p>
                <div class="form-group">
                    <label>Amount (ZMW) *</label>
                    <input type="number" id="pi-amount" class="form-input" step="0.01" min="0.01" style="font-size:1.2rem; font-weight:700; text-align:center" autofocus>
                </div>
                <div class="form-group">
                    <label>Description *</label>
                    <input type="text" id="pi-desc" class="form-input" placeholder="e.g. Change from bank, float top-up">
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="Utils.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="btn-confirm-pi">Record Paid-In</button>
            </div>
        `);
        document.getElementById('btn-confirm-pi').addEventListener('click', async () => {
            const amount = parseFloat(document.getElementById('pi-amount').value);
            const description = document.getElementById('pi-desc').value;
            if (!amount || amount <= 0) { Utils.toast('Enter a valid amount.', 'warning'); return; }
            if (!description) { Utils.toast('Enter a description.', 'warning'); return; }
            const btn = document.getElementById('btn-confirm-pi');
            btn.disabled = true; btn.textContent = 'Recording...';
            try {
                await API.post('/cash/paid-in', { amount, description });
                Utils.closeModal();
                Utils.toast('Paid-in recorded.', 'success');
                this.loadCurrentSession();
            } catch (err) {
                Utils.toast(err.message || 'Failed.', 'error');
                btn.disabled = false; btn.textContent = 'Record Paid-In';
            }
        });
    },

    // ── PAID OUT MODAL ──

    showPaidOutModal() {
        Utils.showModal(`
            <div class="modal-header">
                <h3>💸 Record Paid-Out</h3>
                <button class="modal-close" onclick="Utils.closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <p style="margin-bottom:1rem; color:var(--text-secondary); font-size:0.85rem">
                    Cash removed from the drawer (e.g. change given, expense purchase, bank run).
                </p>
                <div class="form-group">
                    <label>Amount (ZMW) *</label>
                    <input type="number" id="po-amount" class="form-input" step="0.01" min="0.01" style="font-size:1.2rem; font-weight:700; text-align:center" autofocus>
                </div>
                <div class="form-group">
                    <label>Description *</label>
                    <input type="text" id="po-desc" class="form-input" placeholder="e.g. Cleaning supplies, bank deposit">
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="Utils.closeModal()">Cancel</button>
                <button class="btn btn-primary" id="btn-confirm-po">Record Paid-Out</button>
            </div>
        `);
        document.getElementById('btn-confirm-po').addEventListener('click', async () => {
            const amount = parseFloat(document.getElementById('po-amount').value);
            const description = document.getElementById('po-desc').value;
            if (!amount || amount <= 0) { Utils.toast('Enter a valid amount.', 'warning'); return; }
            if (!description) { Utils.toast('Enter a description.', 'warning'); return; }
            const btn = document.getElementById('btn-confirm-po');
            btn.disabled = true; btn.textContent = 'Recording...';
            try {
                await API.post('/cash/paid-out', { amount, description });
                Utils.closeModal();
                Utils.toast('Paid-out recorded.', 'success');
                this.loadCurrentSession();
            } catch (err) {
                Utils.toast(err.message || 'Failed.', 'error');
                btn.disabled = false; btn.textContent = 'Record Paid-Out';
            }
        });
    },

    // ── SESSION HISTORY MODAL ──

    async showHistory() {
        try {
            const sessions = await API.get('/cash/history');
            Utils.showModal(`
                <div class="modal-header">
                    <h3>📊 Session History</h3>
                    <button class="modal-close" onclick="Utils.closeModal()">✕</button>
                </div>
                <div class="modal-body" style="max-height:60vh; overflow-y:auto">
                    ${sessions.length ? sessions.map(s => {
                const variance = parseFloat(s.variance) || 0;
                const varClass = Math.abs(variance) < 0.01 ? '' : variance > 0 ? 'variance-positive' : 'variance-negative';
                return `
                            <div class="session-card" onclick="CashDrawer.showSessionDetail(${s.session_id})">
                                <div class="session-card-header">
                                    <span class="session-card-date">${new Date(s.opened_at).toLocaleDateString('en-ZM', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</span>
                                    <span class="badge" style="background:${s.status === 'Open' ? '#10b981' : '#6b7280'}; color:white">${s.status}</span>
                                </div>
                                <div class="session-card-cashier">Opened by ${s.opened_by_name}${s.closed_by_name ? ' · Closed by ' + s.closed_by_name : ''}</div>
                                <div class="session-card-stats">
                                    <div class="session-stat"><label>Float</label><span>${Utils.currency(s.opening_float)}</span></div>
                                    <div class="session-stat"><label>Expected</label><span>${Utils.currency(s.expected_cash)}</span></div>
                                    <div class="session-stat"><label>Actual</label><span>${s.actual_cash != null ? Utils.currency(s.actual_cash) : '—'}</span></div>
                                    <div class="session-stat"><label>Variance</label><span class="${varClass}">${s.variance != null ? (variance >= 0 ? '+' : '') + Utils.currency(variance) : '—'}</span></div>
                                </div>
                            </div>
                        `;
            }).join('') : '<div class="empty-state">No session history yet.</div>'}
                </div>
            `);
        } catch (err) {
            Utils.toast('Failed to load history.', 'error');
        }
    },

    // ── SESSION DETAIL (DRILL-DOWN) ──

    async showSessionDetail(id) {
        try {
            const session = await API.get(`/cash/history/${id}`);
            const movements = session.movements || [];
            Utils.showModal(`
                <div class="modal-header">
                    <h3>Session — ${new Date(session.opened_at).toLocaleDateString()}</h3>
                    <button class="modal-close" onclick="Utils.closeModal()">✕</button>
                </div>
                <div class="modal-body" style="max-height:65vh; overflow-y:auto">
                    <div class="job-info-grid" style="margin-bottom:1rem">
                        <div class="info-block"><label>Opened</label><span>${new Date(session.opened_at).toLocaleString()}</span></div>
                        <div class="info-block"><label>Closed</label><span>${session.closed_at ? new Date(session.closed_at).toLocaleString() : 'Still open'}</span></div>
                        <div class="info-block"><label>Opened By</label><span>${session.opened_by_name}</span></div>
                        <div class="info-block"><label>Closed By</label><span>${session.closed_by_name || '—'}</span></div>
                    </div>

                    <div class="job-finance-grid" style="margin-bottom:1rem">
                        <div class="finance-item"><label>Float</label><span>${Utils.currency(session.opening_float)}</span></div>
                        <div class="finance-item"><label>Expected</label><span>${Utils.currency(session.expected_cash)}</span></div>
                        <div class="finance-item"><label>Actual</label><span>${session.actual_cash != null ? Utils.currency(session.actual_cash) : '—'}</span></div>
                        <div class="finance-item ${parseFloat(session.variance || 0) !== 0 ? (parseFloat(session.variance) > 0 ? '' : 'finance-total') : 'finance-total'}">
                            <label>Variance</label>
                            <span>${session.variance != null ? Utils.currency(session.variance) : '—'}</span>
                        </div>
                    </div>

                    ${session.variance_reason ? `<p style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:1rem"><strong>Variance reason:</strong> ${session.variance_reason}</p>` : ''}

                    <h4 style="font-size:0.85rem; margin-bottom:0.5rem">Movements (${movements.length})</h4>
                    <table class="data-table data-table-compact">
                        <thead><tr><th>Time</th><th>Type</th><th>Amount</th><th>Description</th><th>By</th></tr></thead>
                        <tbody>
                            ${movements.map(m => `
                                <tr>
                                    <td>${new Date(m.created_at).toLocaleTimeString()}</td>
                                    <td><span class="movement-badge ${m.movement_type}">${this.formatMovementType(m.movement_type)}</span></td>
                                    <td style="font-weight:600">${Utils.currency(m.amount)}</td>
                                    <td>${m.description || '—'}</td>
                                    <td>${m.performed_by_name || '—'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="modal-footer">
                    ${session.status === 'Closed' ? `<button class="btn btn-outline" onclick="CashDrawer.showEodReport(${id})">📄 EOD Report</button>` : ''}
                    <button class="btn btn-outline" onclick="CashDrawer.showHistory()">← Back</button>
                </div>
            `);
        } catch (err) {
            Utils.toast('Failed to load session details.', 'error');
        }
    },

    // ── EOD RECONCILIATION REPORT ──

    async showEodReport(id) {
        try {
            const report = await API.get(`/cash/eod/${id}`);
            const s = report.summary;
            const variance = s.variance;
            const varColor = Math.abs(variance) < 0.01 ? 'var(--success)' : variance > 0 ? 'var(--success)' : 'var(--danger)';
            const varLabel = Math.abs(variance) < 0.01 ? '✅ BALANCED' : variance > 0 ? '⬆️ OVER' : '⬇️ SHORT';

            Utils.showModal(`
                <div class="modal-header">
                    <h3>📄 End of Day Report</h3>
                    <button class="modal-close" onclick="Utils.closeModal()">✕</button>
                </div>
                <div class="modal-body eod-report" id="eod-report-content">
                    <div style="text-align:center; margin-bottom:1.25rem">
                        <h2 style="margin:0; font-size:1.1rem">ZACHI SMART-POS</h2>
                        <div style="font-size:0.78rem; color:var(--text-secondary)">Cash Reconciliation Report</div>
                        <div style="font-size:0.82rem; color:var(--text-primary); font-weight:600; margin-top:0.25rem">
                            ${new Date(report.session.opened_at).toLocaleDateString('en-ZM', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                        </div>
                    </div>

                    <!-- Session Info -->
                    <div class="eod-section">
                        <div class="eod-section-header">Session Details</div>
                        <div class="eod-row"><span>Opened</span><span>${new Date(report.session.opened_at).toLocaleTimeString()}</span></div>
                        <div class="eod-row"><span>Closed</span><span>${new Date(report.session.closed_at).toLocaleTimeString()}</span></div>
                        <div class="eod-row"><span>Cashier (Open)</span><span>${report.session.opened_by_name}</span></div>
                        <div class="eod-row"><span>Cashier (Close)</span><span>${report.session.closed_by_name || '—'}</span></div>
                    </div>

                    <!-- Sales -->
                    <div class="eod-section">
                        <div class="eod-section-header">Sales Summary</div>
                        <div class="eod-row"><span>Transactions</span><span>${report.sales.count}</span></div>
                        <div class="eod-row eod-total"><span>Total Sales</span><span>${Utils.currency(report.sales.total)}</span></div>
                    </div>

                    <!-- Cash Flow -->
                    <div class="eod-section">
                        <div class="eod-section-header">Cash Flow</div>
                        <div class="eod-row"><span>Opening Float</span><span>${Utils.currency(s.opening_float)}</span></div>
                        <div class="eod-row" style="color:var(--success)"><span>+ Cash Sales</span><span>${Utils.currency(s.total_sales_cash)}</span></div>
                        <div class="eod-row" style="color:var(--success)"><span>+ Paid In</span><span>${Utils.currency(s.total_paid_in)}</span></div>
                        <div class="eod-row" style="color:var(--danger)"><span>− Paid Out</span><span>${Utils.currency(s.total_paid_out)}</span></div>
                        <div class="eod-row" style="color:var(--danger)"><span>− Refunds</span><span>${Utils.currency(s.total_refunds)}</span></div>
                        <div class="eod-row eod-total"><span>Expected Cash</span><span>${Utils.currency(s.expected_cash)}</span></div>
                    </div>

                    <!-- Reconciliation -->
                    <div class="eod-section">
                        <div class="eod-section-header">Reconciliation</div>
                        <div class="eod-row"><span>Expected Cash</span><span>${Utils.currency(s.expected_cash)}</span></div>
                        <div class="eod-row"><span>Actual Cash</span><span>${Utils.currency(s.actual_cash)}</span></div>
                        <div class="eod-row eod-total" style="color:${varColor}">
                            <span>Variance ${varLabel}</span>
                            <span>${(variance >= 0 ? '+' : '')}${Utils.currency(variance)}</span>
                        </div>
                        ${s.variance_reason ? `<div class="eod-row"><span>Reason</span><span style="font-style:italic">${s.variance_reason}</span></div>` : ''}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline" onclick="CashDrawer.printEod()">🖨️ Print</button>
                    <button class="btn btn-outline" onclick="CashDrawer.showSessionDetail(${id})">← Back</button>
                </div>
            `);
        } catch (err) {
            Utils.toast('Failed to load EOD report.', 'error');
        }
    },

    printEod() {
        const content = document.getElementById('eod-report-content');
        if (!content) return;
        const w = window.open('', '_blank');
        w.document.write(`
            <html><head><title>EOD Report</title>
            <style>
                body { font-family: 'Inter', 'Segoe UI', sans-serif; max-width:500px; margin:0 auto; padding:1rem; }
                .eod-section { border:1px solid #ddd; border-radius:6px; margin-bottom:0.75rem; overflow:hidden; }
                .eod-section-header { background:#f5f5f5; padding:0.5rem 0.75rem; font-weight:700; font-size:0.85rem; border-bottom:1px solid #ddd; }
                .eod-row { display:flex; justify-content:space-between; padding:0.35rem 0.75rem; font-size:0.82rem; border-bottom:1px solid #f0f0f0; }
                .eod-row:last-child { border-bottom:none; }
                .eod-row.eod-total { font-weight:800; background:#f5f5f5; }
                h2 { margin:0; text-align:center; }
            </style></head><body>${content.innerHTML}</body></html>
        `);
        w.document.close();
        w.print();
    }
};
