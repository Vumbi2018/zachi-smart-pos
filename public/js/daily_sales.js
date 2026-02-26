const DailySales = {
    filterState: {
        range: 'today',
        start: new Date().toLocaleDateString('en-CA'),
        end: new Date().toLocaleDateString('en-CA'),
        payment_method: '',
        label: 'Today'
    },

    init() {
        this.render();
    },

    async render(container) {
        if (!container) {
            container = document.getElementById('main-content') || document.getElementById('page-container');
        }

        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">Sales Report</h1>
                    <p class="text-secondary" id="sales-date-label">Today</p>
                </div>
                <div class="header-actions">
                    <div class="flex items-center">
                        <select id="sales-range-select" class="form-select text-sm mr-2" onchange="DailySales.handleRangeChange(this.value)" style="width:140px;">
                            <option value="today">Today</option>
                            <option value="yesterday">Yesterday</option>
                            <option value="7days">Last 7 Days</option>
                            <option value="30days">Last 30 Days</option>
                            <option value="this_month">This Month</option>
                            <option value="last_month">Last Month</option>
                            <option value="custom">Custom Range</option>
                        </select>

                        <div id="sales-custom-dates" class="hidden mr-2 flex items-center">
                            <input type="date" id="sales-start-date" class="form-input text-sm p-1 border rounded">
                            <span class="mx-1">-</span>
                            <input type="date" id="sales-end-date" class="form-input text-sm p-1 border rounded">
                            <button class="btn btn-sm btn-primary ml-1" onclick="DailySales.applyCustomDate()">Go</button>
                        </div>

                        <select id="sales-payment-filter" class="form-select text-sm mr-2" onchange="DailySales.handlePaymentFilter(this.value)" style="width:140px;">
                            <option value="">All Payments</option>
                            <option value="Cash">Cash</option>
                            <option value="Airtel_Money">Airtel Money</option>
                            <option value="MTN_Money">MTN Money</option>
                            <option value="Card">Card</option>
                            <option value="Bank">Bank Transfer</option>
                            <option value="Credit">Credit</option>
                        </select>

                        <button class="btn btn-outline mr-2" onclick="DailySales.exportSales()"><i class="fas fa-file-csv"></i> Export</button>
                        <button class="btn btn-secondary" onclick="DailySales.loadData()"><i class="fas fa-sync"></i> Refresh</button>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-body">
                    <div id="daily-sales-table-container">
                        <div class="loading-spinner"></div>
                    </div>
                </div>
            </div>
        `;

        // Set initial state
        document.getElementById('sales-range-select').value = this.filterState.range;
        if (this.filterState.payment_method) {
            document.getElementById('sales-payment-filter').value = this.filterState.payment_method;
        }

        await this.loadData();
    },

    handleRangeChange(range) {
        this.filterState.range = range;
        const now = new Date();
        let start = new Date();
        let end = new Date();

        if (range === 'custom') {
            document.getElementById('sales-custom-dates').classList.remove('hidden');
            return;
        } else {
            document.getElementById('sales-custom-dates').classList.add('hidden');
        }

        switch (range) {
            case 'today':
                this.filterState.label = 'Today';
                break;
            case 'yesterday':
                start.setDate(now.getDate() - 1);
                end.setDate(now.getDate() - 1);
                this.filterState.label = 'Yesterday';
                break;
            case '7days':
                start.setDate(now.getDate() - 6);
                this.filterState.label = 'Last 7 Days';
                break;
            case '30days':
                start.setDate(now.getDate() - 29);
                this.filterState.label = 'Last 30 Days';
                break;
            case 'this_month':
                start = new Date(now.getFullYear(), now.getMonth(), 1);
                this.filterState.label = 'This Month';
                break;
            case 'last_month':
                start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                end = new Date(now.getFullYear(), now.getMonth(), 0);
                this.filterState.label = 'Last Month';
                break;
        }

        this.filterState.start = start.toLocaleDateString('en-CA');
        this.filterState.end = end.toLocaleDateString('en-CA');
        this.updateDateLabel();
        this.loadData();
    },

    applyCustomDate() {
        const s = document.getElementById('sales-start-date').value;
        const e = document.getElementById('sales-end-date').value;
        if (!s || !e) return Utils.toast('Select start and end dates', 'warning');

        this.filterState.start = s;
        this.filterState.end = e;
        this.filterState.label = 'Custom Range';
        this.updateDateLabel();
        this.loadData();
    },

    handlePaymentFilter(val) {
        this.filterState.payment_method = val;
        this.loadData();
    },

    updateDateLabel() {
        const lbl = document.getElementById('sales-date-label');
        if (lbl) {
            if (this.filterState.range === 'today') {
                lbl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            } else {
                lbl.textContent = `${this.filterState.label} (${this.filterState.start} - ${this.filterState.end})`;
            }
        }
    },

    async exportSales() {
        try {
            Utils.toast('Generating CSV...', 'info');
            const { start, end, payment_method } = this.filterState;
            let url = `/reports/sales?format=csv&startDate=${start}&endDate=${end} 23:59:59`;
            if (payment_method) url += `&payment_method=${payment_method}`;

            const res = await fetch('/api' + url, {
                headers: { 'Authorization': `Bearer ${API.token}` }
            });

            if (!res.ok) throw new Error('Export failed');

            const blob = await res.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `sales_report_${start}_to_${end}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            Utils.toast('Export complete', 'success');
        } catch (err) {
            Utils.toast('Export failed: ' + err.message, 'error');
        }
    },

    async loadData() {
        try {
            const container = document.getElementById('daily-sales-table-container');
            if (container) container.innerHTML = '<div class="loading-spinner"></div>';

            const { start, end, payment_method } = this.filterState;
            let url = `/reports/sales?startDate=${start}&endDate=${end} 23:59:59`;
            if (payment_method) url += `&payment_method=${payment_method}`;

            const transactions = await API.get(url);
            this.data = transactions;

            if (!transactions || transactions.length === 0) {
                const container = document.getElementById('daily-sales-table-container');
                if (container) {
                    container.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-icon">📝</div>
                            <h3>No sales found for today</h3>
                            <p>Transactions will appear here once recorded.</p>
                        </div>
                    `;
                }
                return;
            }

            const total = transactions.reduce((sum, t) => sum + parseFloat(t.total_amount), 0);
            const totalCash = transactions.filter(t => t.payment_method === 'Cash').reduce((sum, t) => sum + parseFloat(t.total_amount), 0);
            const totalMobile = transactions.filter(t => t.payment_method.includes('Money')).reduce((sum, t) => sum + parseFloat(t.total_amount), 0);
            const totalBank = transactions.filter(t => t.payment_method === 'Bank' || t.payment_method === 'Card').reduce((sum, t) => sum + parseFloat(t.total_amount), 0);

            const rows = transactions.map((t, index) => {
                // Child Row Content (Nested Table)
                const itemsRows = t.items && t.items.length > 0
                    ? t.items.map(i => `
                        <tr>
                            <td>
                                ${i.description} 
                                ${i.item_type === 'service' ? '<span class="badge badge-sm badge-info">Service</span>' : ''}
                            </td>
                            <td class="text-right">${i.quantity}</td>
                            <td class="text-right">${Utils.currency(i.unit_price)}</td>
                            <td class="text-right font-bold">${Utils.currency(i.line_total)}</td>
                            <td>${t.staff_name || 'System'}</td>
                        </tr>`).join('')
                    : '<tr><td colspan="5" class="text-muted text-center">No items</td></tr>';

                return `
                <!-- Parent Row -->
                <tr class="bs-row-parent clickable" onclick="DailySales.toggleRow('details-${index}', this)">
                    <td class="font-bold">
                        <i class="fas fa-chevron-right row-toggle-icon mr-2 text-secondary"></i>
                        ${t.sale_number}
                    </td>
                    <td>
                        <div class="text-sm">${new Date(t.transaction_date).toLocaleDateString()}</div>
                        <div class="text-xs text-secondary detail-time">${new Date(t.transaction_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>
                    <td>${t.staff_name || 'System'}</td>
                    <td>
                        <span class="badge badge-${this.getPaymentBadge(t.payment_method)}">${t.payment_method}</span>
                        ${t.payment_reference ? `<span class="text-xs text-secondary ml-1">(${t.payment_reference})</span>` : ''}
                    </td>
                    <td class="text-right font-bold text-lg text-primary">${Utils.currency(t.total_amount)}</td>
                </tr>
                <!-- Child Row (Hidden by default) -->
                <tr id="details-${index}" class="bs-row-child hidden">
                    <td colspan="5" class="p-0">
                        <div class="child-content-wrapper">
                            <div class="flex justify-between items-center p-3 bg-gray-50 border-b">
                                <h4 class="text-sm font-bold">Transaction Items</h4>
                                <button class="btn btn-sm btn-outline" onclick="DailySales.reprintReceipt(${index})">
                                    <i class="fas fa-print mr-1"></i> Reprint Receipt
                                </button>
                            </div>
                            <table class="table w-full table-sm table-nested">
                                <thead>
                                    <tr>
                                        <th>Item Description</th>
                                        <th class="text-right" style="width:10%">Qty</th>
                                        <th class="text-right" style="width:15%">Unit Price</th>
                                        <th class="text-right" style="width:15%">Total</th>
                                        <th style="width:15%">Sales Rep</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${itemsRows}
                                </tbody>
                            </table>
                        </div>
                    </td>
                </tr>
                `;
            }).join('');

            document.getElementById('daily-sales-table-container').innerHTML = `
                <div class="summary-cards-row">
                     <div class="summary-card card-total">
                        <div class="card-icon"><i class="fas fa-coins"></i></div>
                        <div class="card-content">
                            <div class="label">Total Revenue</div>
                            <div class="value">${Utils.currency(total)}</div>
                        </div>
                     </div>
                     <div class="summary-card">
                        <div class="card-icon text-success"><i class="fas fa-money-bill-wave"></i></div>
                        <div class="card-content">
                            <div class="label">Cash Sales</div>
                            <div class="value">${Utils.currency(totalCash)}</div>
                        </div>
                     </div>
                     <div class="summary-card">
                        <div class="card-icon text-warning"><i class="fas fa-mobile-alt"></i></div>
                        <div class="card-content">
                            <div class="label">Mobile Money</div>
                            <div class="value">${Utils.currency(totalMobile)}</div>
                        </div>
                     </div>
                </div>

                <div class="table-container">
                    <table class="table w-full table-hover">
                        <thead>
                            <tr class="bg-light">
                                <th style="width:20%">Reference</th>
                                <th style="width:15%">Time</th>
                                <th style="width:20%">Staff</th>
                                <th style="width:25%">Payment Method</th>
                                <th class="text-right" style="width:20%">Total Amount</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            `;

        } catch (err) {
            console.error(err);
            const container = document.getElementById('daily-sales-table-container');
            if (container) {
                container.innerHTML = `<div class="error-state">Failed to load data</div>`;
            }
        }
    },

    reprintReceipt(index) {
        const sale = this.data[index];
        if (!sale) return;
        if (typeof POS !== 'undefined') {
            POS.printReceipt(sale);
        } else {
            Utils.toast('POS module not loaded', 'error');
        }
    },

    toggleRow(id, row) {
        const el = document.getElementById(id);
        const icon = row.querySelector('.row-toggle-icon');

        if (el.classList.contains('hidden')) {
            el.classList.remove('hidden');
            row.classList.add('expanded');
            if (icon) {
                icon.classList.remove('fa-chevron-right');
                icon.classList.add('fa-chevron-down');
            }
        } else {
            el.classList.add('hidden');
            row.classList.remove('expanded');
            if (icon) {
                icon.classList.add('fa-chevron-right');
                icon.classList.remove('fa-chevron-down');
            }
        }
    },

    getPaymentBadge(method) {
        switch (method) {
            case 'Cash': return 'success';
            case 'Airtel_Money': return 'danger';
            case 'MTN_Money': return 'warning';
            case 'Bank': return 'info';
            default: return 'secondary';
        }
    }
};

window.DailySales = DailySales;
