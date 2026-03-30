const ReportsAdv = {
    // State
    currentTab: 'sales',
    dateRange: {
        start: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0], // Last 30 days
        end: new Date().toISOString().split('T')[0]
    },

    async render(container) {
        container.innerHTML = `
            <div class="report-page-header">
                <div>
                    <h1 class="page-title text-3xl font-extrabold text-slate-800 tracking-tight">Advanced Reporting</h1>
                    <p class="text-slate-500 mt-1">Enterprise business intelligence, financial insights, and inventory valuation.</p>
                </div>
                <div class="flex gap-3 items-center">
                    <div class="input-group flex items-center gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-200">
                        <input type="date" id="report-start" class="form-input py-1 border-none bg-transparent" value="\${this.dateRange.start}" onchange="ReportsAdv.updateDate('start', this.value)">
                        <span class="text-slate-400 font-medium px-2">to</span>
                        <input type="date" id="report-end" class="form-input py-1 border-none bg-transparent" value="\${this.dateRange.end}" onchange="ReportsAdv.updateDate('end', this.value)">
                    </div>
                    <button class="btn btn-primary shadow-lg shadow-blue-500/30" onclick="ReportsAdv.refresh()">
                        <i class="fas fa-sync-alt mr-2"></i> Update
                    </button>
                    <button class="btn btn-outline border-slate-300 text-slate-600 hover:bg-slate-50" onclick="ReportsAdv.exportCurrent()">
                        <i class="fas fa-file-csv mr-2"></i> Export CSV
                    </button>
                    <button class="btn btn-outline border-slate-300 text-slate-600 hover:bg-slate-50" onclick="ReportsAdv.printCurrent()">
                        🖨️ Print
                    </button>
                    <button class="btn btn-outline border-slate-300 text-slate-600 hover:bg-slate-50" onclick="ReportsAdv.downloadPdf()">
                        📄 PDF
                    </button>
                </div>
            </div>

            <div class="premium-tabs mb-6">
                <button class="premium-tab active" onclick="ReportsAdv.switchTab('sales', this)">Sales Analysis</button>
                <button class="premium-tab" onclick="ReportsAdv.switchTab('trends', this)">Sales Trends</button>
                <button class="premium-tab" onclick="ReportsAdv.switchTab('insights', this)">Business Insights</button>
                <button class="premium-tab" onclick="ReportsAdv.switchTab('stock', this)">Stock & Valuation</button>
                <button class="premium-tab" onclick="ReportsAdv.switchTab('financials', this)">Financials & Tax</button>
                <button class="premium-tab" onclick="ReportsAdv.switchTab('profit-margin', this)">Profit Margin</button>
            </div>

            <div id="report-content" class="report-page-bg">
                <!-- Dynamic Content -->
                <div class="text-center p-8"><div class="spinner"></div> Loading...</div>
            </div>
        `;

        this.loadCurrentTab();
    },

    updateDate(type, value) {
        this.dateRange[type] = value;
    },


    refresh() {
        this.loadCurrentTab();
    },

    switchTab(tab, btn) {
        this.currentTab = tab;
        document.querySelectorAll('.premium-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.loadCurrentTab();
    },

    async loadCurrentTab() {
        const content = document.getElementById('report-content');
        content.innerHTML = `<div class="text-center p-12"><div class="spinner"></div> Loading data...</div>`;

        try {
            if (this.currentTab === 'sales') await this.renderSales(content);
            else if (this.currentTab === 'trends') await this.renderTrends(content);
            else if (this.currentTab === 'insights') await this.renderInsights(content);
            else if (this.currentTab === 'stock') await this.renderStock(content);
            else if (this.currentTab === 'financials') await this.renderFinancials(content);
            else if (this.currentTab === 'profit-margin') await this.renderProfitMargin(content);
        } catch (err) {
            console.error(err);
            content.innerHTML = `<div class="p-8 text-center text-red-600">Error loading report: ${err.message}</div>`;
        }
    },

    async renderSales(container) {
        const [byDate, byCategory, byProduct] = await Promise.all([
            API.get(`/reports/sales?groupBy=date&startDate=${this.dateRange.start}&endDate=${this.dateRange.end}`),
            API.get(`/reports/sales?groupBy=category&startDate=${this.dateRange.start}&endDate=${this.dateRange.end}`),
            API.get(`/reports/sales?groupBy=product&startDate=${this.dateRange.start}&endDate=${this.dateRange.end}`)
        ]);

        const totalSales = byDate.reduce((sum, d) => sum + parseFloat(d.total), 0);
        const totalTx = byDate.reduce((sum, d) => sum + parseInt(d.count), 0);

        container.innerHTML = `
            <!-- SNPs -->
            <div class="report-grid-3">
    <div class="report-premium-card">
        <div class="report-metric-label">Total Revenue</div>
        <div class="report-metric-value">${Utils.formatCurrency(totalSales)}</div>
    </div>
    <div class="report-premium-card">
        <div class="report-metric-label">Transactions</div>
        <div class="report-metric-value">${totalTx}</div>
    </div>
    <div class="report-premium-card">
        <div class="report-metric-label">Avg. Ticket</div>
        <div class="report-metric-value">${Utils.formatCurrency(totalTx ? totalSales / totalTx : 0)}</div>
    </div>
</div>

<div class="report-grid-2">

                <!-- Sales by Date -->
                <div class="report-premium-card p-0">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Day-by-Day Performance</h3></div>
    <div class="report-table-wrapper mx-6 mb-6">
        <table class="report-table">
            <thead><tr><th>Date</th><th class="text-right">Tx</th><th class="text-right">Revenue</th></tr></thead>
            <tbody>
                ${byDate.map(d => `
                    <tr>
                        <td>${new Date(d.date).toLocaleDateString()}</td>
                        <td class="text-right">${d.count}</td>
                        <td class="text-right font-bold">${Utils.formatCurrency(d.total)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
</div>
                
                <!-- Top Products -->
                <div class="report-premium-card p-0">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Top Products</h3></div>
    <div class="report-table-wrapper mx-6 mb-6">
        <table class="report-table">
            <thead><tr><th>Product</th><th class="text-right">Qty</th><th class="text-right">Revenue</th></tr></thead>
            <tbody>
                ${byProduct.map(p => `
                    <tr>
                        <td>${p.name}</td>
                        <td class="text-right">${p.count}</td>
                        <td class="text-right font-bold">${Utils.formatCurrency(p.total)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
</div>

                 <!-- Sales by Category -->
                <div class="report-premium-card p-0 lg:col-span-2">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Category Breakdown</h3></div>
    <div class="report-table-wrapper mx-6 mb-6">
        <table class="report-table">
            <thead><tr><th>Category</th><th class="text-right">% Sales</th><th class="text-right">Revenue</th></tr></thead>
            <tbody>
                ${byCategory.map(c => `
                    <tr>
                        <td>${c.category || 'Uncategorized'}</td>
                        <td class="text-right">${totalSales > 0 ? Math.round((c.total / totalSales) * 100) : 0}%</td>
                        <td class="text-right font-bold">${Utils.formatCurrency(c.total)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
</div>
            </div>
        `;

        // Save data for export
        this.currentData = byDate;
    },

    async renderStock(container) {
        const [valuation, slowMoving] = await Promise.all([
            API.get('/reports/stock?type=valuation'),
            API.get('/reports/stock?type=slow_moving')
        ]);

        container.innerHTML = `
            <div class="report-grid-2">
    <div class="report-premium-card">
        <div class="report-metric-label">Total Stock Value (Cost)</div>
        <div class="report-metric-value" style="background: linear-gradient(135deg, #2563eb, #3b82f6); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${Utils.formatCurrency(valuation.total_cost_value)}</div>
        <div class="text-sm mt-2 text-slate-500 font-semibold">Retail Value: ${Utils.formatCurrency(valuation.total_retail_value)}</div>
    </div>
    <div class="report-premium-card">
        <div class="report-metric-label">Inventory Metrics</div>
        <div class="flex justify-between mt-2 py-2 border-b border-slate-100">
            <span class="text-slate-500">Total SKUs:</span> <strong class="text-lg">${valuation.total_items}</strong>
        </div>
        <div class="flex justify-between py-2">
            <span class="text-slate-500">Total Units:</span> <strong class="text-lg">${valuation.total_units}</strong>
        </div>
    </div>
</div>

<div class="report-premium-card p-0 mt-6">
                <div class="report-header px-6 pt-6 border-b-0"><h3 class="report-header-title text-red-600">⚠️ Slow Moving Inventory (No sales in 90 days)</h3></div>
    <div class="report-table-wrapper mx-6 mb-6">
        <table class="report-table">
            <thead><tr><th>Product</th><th>Last Sale</th><th class="text-right">Qty in Stock</th><th class="text-right">Value Tied Up</th></tr></thead>
            <tbody>
                ${slowMoving.map(p => `
                    <tr>
                        <td>${p.name}</td>
                        <td>${p.last_sale ? new Date(p.last_sale).toLocaleDateString() : 'Never'}</td>
                        <td class="text-right text-red-600 font-bold">${p.stock_quantity}</td>
                        <td class="text-right font-bold">${Utils.formatCurrency(p.stock_quantity * p.cost_price)}</td>
                    </tr>
                `).join('') || '<tr><td colspan="4" class="text-center p-8 text-slate-400 font-medium"><i class="fas fa-check-circle text-green-500 mr-2"></i>Good news! No stagnant inventory found.</td></tr>'}
            </tbody>
        </table>
    </div>
</div>
`;

        this.currentData = slowMoving;
    },

    async renderFinancials(container) {
        const [financials, tax] = await Promise.all([
            API.get(`/reports/financials?startDate=${this.dateRange.start}&endDate=${this.dateRange.end}`),
            API.get(`/reports/tax?startDate=${this.dateRange.start}&endDate=${this.dateRange.end}`)
        ]);

        const profitClass = financials.net_profit >= 0 ? 'text-green-600' : 'text-red-600';

        container.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <!-- Profit & Loss -->
                <div class="report-premium-card p-0 lg:col-span-1">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Profit & Loss Statement (Estimated)</h3></div>
    <div class="report-table-wrapper mx-6 mb-6 border-none shadow-none">
        <table class="report-table">
            <tbody>
                <tr><td class="text-slate-500">Total Revenue (excl. tax)</td><td class="text-right font-bold text-lg">${Utils.formatCurrency(financials.revenue)}</td></tr>
                <tr><td class="text-red-500">Cost of Goods Sold (COGS)</td><td class="text-right text-red-500">- ${Utils.formatCurrency(financials.cogs)}</td></tr>
                <tr style="background-color: #f8fafc;"><td class="font-bold text-slate-800 border-none">Gross Profit</td><td class="text-right font-bold text-lg border-none">${Utils.formatCurrency(financials.gross_profit)}</td></tr>
                <tr><td class="text-red-500">Operating Expenses</td><td class="text-right text-red-500">- ${Utils.formatCurrency(financials.expenses)}</td></tr>
                <tr>
                    <td class="font-bold text-slate-800 text-lg border-none">NET PROFIT</td>
                    <td class="text-right font-bold text-2xl ${profitClass} border-none">${Utils.formatCurrency(financials.net_profit)}</td>
                </tr>
            </tbody>
        </table>
        <div class="text-center pb-4 text-xs font-semibold text-slate-400">Net Margin: ${financials.margin_percent.toFixed(1)}%</div>
    </div>
</div>

<!-- Tax Summary -->
<div class="report-premium-card p-0 lg:col-span-1">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Tax Summary (VAT)</h3></div>
                       <div class="report-table-wrapper mx-6 mb-6 border-none shadow-none">
        <div class="grid grid-cols-2 gap-4 mb-8">
            <div class="bg-blue-50/50 p-4 rounded-xl border border-blue-100 text-center">
                <div class="text-xs uppercase text-blue-600/70 font-bold mb-1">Tax Collected</div>
                <div class="text-2xl font-bold text-blue-700">${Utils.formatCurrency(tax.tax_collected)}</div>
            </div>
            <div class="bg-orange-50/50 p-4 rounded-xl border border-orange-100 text-center">
                <div class="text-xs uppercase text-orange-600/70 font-bold mb-1">Tax Paid</div>
                <div class="text-2xl font-bold text-orange-700">${Utils.formatCurrency(tax.tax_paid)}</div>
            </div>
        </div>
        <div class="text-center">
            <div class="text-sm uppercase text-slate-400 font-bold tracking-wider">Net Tax Payable</div>
            <div class="text-5xl font-extrabold mt-2 text-slate-800">${Utils.formatCurrency(tax.net_tax_payable)}</div>
            <p class="text-xs text-slate-400 mt-4 px-8 leading-relaxed">This is an estimate based on system records.</p>
        </div>
    </div>
</div>
`;

        this.currentData = [financials, tax];
    },

    async renderProfitMargin(container) {
        const groupBy = this.pmGroupBy || 'category';
        const data = await API.get(`/reports/profit-margin?groupBy=${groupBy}&startDate=${this.dateRange.start}&endDate=${this.dateRange.end}`);

        container.innerHTML = `
            <div class="report-grid-3 mb-6">
                <div class="report-premium-card">
                    <div class="report-metric-label">Total Revenue</div>
                    <div class="report-metric-value text-blue-600">${Utils.formatCurrency(data.summary.revenue)}</div>
                </div>
                <div class="report-premium-card">
                    <div class="report-metric-label">Total COGS</div>
                    <div class="report-metric-value text-red-500">${Utils.formatCurrency(data.summary.cogs)}</div>
                </div>
                <div class="report-premium-card">
                    <div class="report-metric-label">Avg. Margin %</div>
                    <div class="report-metric-value ${data.summary.margin_pct >= 30 ? 'text-green-600' : 'text-orange-500'}">
                        ${data.summary.margin_pct.toFixed(2)}%
                    </div>
                </div>
            </div>

            <div class="report-premium-card p-0">
                <div class="report-header px-6 pt-6 mb-0 border-none flex justify-between items-center">
                    <h3 class="report-header-title">Profit Margin Details</h3>
                    <select class="form-input py-1.5 px-3 text-sm font-medium bg-slate-50 border-slate-200 rounded-lg text-slate-700 focus:ring-blue-500 focus:border-blue-500" onchange="ReportsAdv.pmGroupBy = this.value; ReportsAdv.loadCurrentTab()">
                        <option value="category" ${groupBy === 'category' ? 'selected' : ''}>Group by Category</option>
                        <option value="product" ${groupBy === 'product' ? 'selected' : ''}>Group by Product</option>
                    </select>
                </div>
                <div class="report-table-wrapper mx-6 mb-6">
                    <table class="report-table">
                        <thead>
                            <tr>
                                <th>${groupBy === 'product' ? 'Product Name' : 'Category'}</th>
                                ${groupBy === 'product' ? '<th>Category</th>' : ''}
                                <th class="text-right">Qty Sold</th>
                                <th class="text-right">Revenue</th>
                                <th class="text-right">COGS</th>
                                <th class="text-right">Gross Profit</th>
                                <th class="text-right">Margin %</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.data.map(item => `
                                <tr>
                                    <td class="font-medium">${item.item_name || 'Uncategorized'}</td>
                                    ${groupBy === 'product' ? `<td><span class="px-2 py-1 text-xs rounded-full bg-slate-100 text-slate-600">${item.category_name || '-'}</span></td>` : ''}
                                    <td class="text-right">${item.items_sold}</td>
                                    <td class="text-right">${Utils.formatCurrency(item.revenue)}</td>
                                    <td class="text-right text-red-500">${Utils.formatCurrency(item.cogs)}</td>
                                    <td class="text-right font-bold text-slate-800">${Utils.formatCurrency(item.gross_profit)}</td>
                                    <td class="text-right">
                                        <span class="report-badge ${parseFloat(item.margin_pct) >= 30 ? 'report-badge-success' : 'report-badge-warning'}">
                                            ${parseFloat(item.margin_pct).toFixed(1)}%
                                        </span>
                                    </td>
                                </tr>
                            `).join('')}
                            ${data.data.length === 0 ? `<tr><td colspan="${groupBy === 'product' ? 7 : 6}" class="text-center py-8 text-slate-500"><i class="fas fa-inbox text-2xl mb-2 block opcaity-50"></i>No sales data found for this period.</td></tr>` : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        this.currentData = data.data; // Store table array for CSV export
    },

    async renderTrends(container) {
        const type = this.aggType || 'month';
        const data = await API.get(`/reports/aggregated?type=${type}`);

        container.innerHTML = `
            <div class="report-premium-card p-0 mb-6">
    <div class="report-header px-6 pt-6 mb-0 border-none">
        <h3 class="report-header-title">Sales Trends (${type.toUpperCase()})</h3>
        <select class="form-input py-1.5 px-3 text-sm font-medium bg-slate-50 border-slate-200 rounded-lg text-slate-700 focus:ring-blue-500 focus:border-blue-500" onchange="ReportsAdv.aggType = this.value; ReportsAdv.loadCurrentTab()">
            <option value="day" ${type === 'day' ? 'selected' : ''}>Daily</option>
            <option value="week" ${type === 'week' ? 'selected' : ''}>Weekly</option>
            <option value="month" ${type === 'month' ? 'selected' : ''}>Monthly</option>
            <option value="quarter" ${type === 'quarter' ? 'selected' : ''}>Quarterly</option>
            <option value="year" ${type === 'year' ? 'selected' : ''}>Annual</option>
        </select>
    </div>
    <div id="sales-chart" class="px-2" style="min-height: 350px;"></div>
</div>

            <div class="report-premium-card p-0">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Aggregated Data Table</h3></div>
    <div class="report-table-wrapper mx-6 mb-6">
        <table class="report-table">
            <thead><tr><th>Period</th><th class="text-right">Transactions</th><th class="text-right">Revenue</th></tr></thead>
            <tbody>
                ${data.map(d => `
                    <tr>
                        <td>${(() => {
                const date = new Date(d.period);
                if (type === 'day') return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                if (type === 'week') {
                    const endOfWeek = new Date(date);
                    endOfWeek.setDate(date.getDate() + 6);
                    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' - ' + endOfWeek.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                }
                if (type === 'month') return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
                if (type === 'quarter') return 'Q' + Math.ceil((date.getMonth() + 1) / 3) + ' ' + date.getFullYear();
                return date.getFullYear().toString();
            })()}</td>
                        <td class="text-right">${d.transactions}</td>
                        <td class="text-right font-bold text-slate-800">${Utils.formatCurrency(d.revenue)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
</div>
`;

        // Render Chart
        const options = {
            series: [{
                name: 'Revenue',
                data: data.map(d => parseFloat(d.revenue))
            }],
            chart: {
                type: 'bar',
                height: 350,
                toolbar: { show: false }
            },
            plotOptions: {
                bar: {
                    borderRadius: 4,
                    horizontal: false,
                    columnWidth: '55%',
                }
            },
            dataLabels: { enabled: false },
            colors: ['#1B3A5C'],
            xaxis: {
                categories: data.map(d => {
                    const date = new Date(d.period);
                    if (type === 'day') return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
                    if (type === 'week') {
                        const endOfWeek = new Date(date);
                        endOfWeek.setDate(date.getDate() + 6);
                        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' - ' + endOfWeek.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                    }
                    if (type === 'month') return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
                    if (type === 'quarter') return 'Q' + Math.ceil((date.getMonth() + 1) / 3) + ' ' + date.getFullYear();
                    return date.getFullYear().toString();
                }),
            },
            yaxis: {
                title: { text: 'Revenue (K)' },
                labels: { formatter: (val) => val.toFixed(0) }
            },
            tooltip: {
                y: { formatter: (val) => Utils.formatCurrency(val) }
            }
        };

        if (typeof ApexCharts !== 'undefined') {
            const chart = new ApexCharts(document.querySelector("#sales-chart"), options);
            chart.render();
        } else {
            const chartEl = document.querySelector("#sales-chart");
            if (chartEl) chartEl.innerHTML = '<div class="p-8 text-center text-slate-400">Chart library failed to load. Please ensure <code>apexcharts.min.js</code> is in <code>/public/js/lib/</code></div>';
        }

        this.currentData = data;
    },

    async renderInsights(container) {
        const [staff, customers, margin, hourly] = await Promise.all([
            API.get(`/reports/staff-performance?startDate=${this.dateRange.start}&endDate=${this.dateRange.end}`),
            API.get(`/reports/customer-insights?startDate=${this.dateRange.start}&endDate=${this.dateRange.end}`),
            API.get(`/reports/category-margin?startDate=${this.dateRange.start}&endDate=${this.dateRange.end}`),
            API.get(`/reports/hourly-trend?startDate=${this.dateRange.start}&endDate=${this.dateRange.end}`)
        ]);

        container.innerHTML = `
            <div class="report-grid-2">
<!-- Staff Performance -->
<div class="report-premium-card p-0">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Staff Sales Performance</h3></div>
    <div class="report-table-wrapper mx-6 mb-6">
                        <table class="report-table">
                            <thead><tr><th>Staff Name</th><th class="text-right">Sales</th><th class="text-right">Revenue</th></tr></thead>
                            <tbody>
                                ${staff.map(s => `
                                    <tr>
                                        <td>${s.staff_name}</td>
                                        <td class="text-right">${s.total_transactions}</td>
                                        <td class="text-right font-bold">${Utils.formatCurrency(s.total_revenue)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
</div>
<!-- Top Customers -->
<div class="report-premium-card p-0">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Top Customer Insights</h3></div>
    <div class="report-table-wrapper mx-6 mb-6">
                        <table class="report-table">
                            <thead><tr><th>Customer</th><th class="text-right">Visits</th><th class="text-right">Total Spent</th></tr></thead>
                            <tbody>
                                ${customers.map(c => `
                                    <tr>
                                        <td>${c.customer_name}</td>
                                        <td class="text-right">${c.visitation_count}</td>
                                        <td class="text-right font-bold">${Utils.formatCurrency(c.total_spent)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
</div>
</div>
<div class="report-grid-2">
<!-- Category Profitability -->
<div class="report-premium-card p-0">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Category Gross Margins</h3></div>
    <div class="report-table-wrapper mx-6 mb-6">
                        <table class="report-table">
                            <thead><tr><th>Category</th><th class="text-right">Profit</th><th class="text-right">Margin %</th></tr></thead>
                            <tbody>
                                ${margin.map(m => `
                                    <tr>
                                        <td>${m.category || 'Uncategorized'}</td>
                                        <td class="text-right font-bold">${Utils.formatCurrency(m.gross_profit)}</td>
                                        <td class="text-right">
                                            <span class="report-badge ${parseFloat(m.margin_pct) > 30 ? 'report-badge-success' : 'report-badge-warning'}">
                                                ${parseFloat(m.margin_pct).toFixed(1)}%
                                            </span>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
</div>
<!-- Hourly Sales Trend -->
<div class="report-premium-card p-0">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Hourly Sales Activity</h3></div>
    <div class="px-2 pb-6">
                        <div id="hourly-chart" style="min-height: 250px;"></div>
                    </div>
                </div>
            </div>
        `;

        // Render Hourly Chart
        const hourlyOptions = {
            series: [{
                name: 'Sales Count',
                data: hourly.map(h => parseInt(h.transaction_count))
            }],
            chart: { type: 'area', height: 250, toolbar: { show: false } },
            dataLabels: { enabled: false },
            stroke: { curve: 'smooth' },
            colors: ['#0D9488'],
            xaxis: {
                categories: hourly.map(h => `${h.hour}:00`),
            }
        };

        const hChart = new ApexCharts(document.querySelector("#hourly-chart"), hourlyOptions);

        this.currentData = staff;
    },

    exportCurrent() {
        if (!this.currentData) return Utils.toast('No data to export', 'error');

        let csv = '';
        let filename = `zachipos_${this.currentTab}_${this.dateRange.start}_${this.dateRange.end}.csv`;

        if (this.currentTab === 'trends') {
            csv = 'Period,Transactions,Revenue\n';
            this.currentData.forEach(d => {
                const date = new Date(d.period);
                csv += `"${date.toLocaleDateString()}", ${d.transactions},${parseFloat(d.revenue).toFixed(2)} \n`;
            });
        } else if (this.currentTab === 'sales') {
            csv = 'Date,Transactions,Revenue (K)\n';
            this.currentData.forEach(d => {
                csv += `"${new Date(d.date).toLocaleDateString()}", ${d.count},${parseFloat(d.total).toFixed(2)} \n`;
            });
        } else if (this.currentTab === 'insights') {
            csv = 'Staff Name,Total Sales,Total Revenue (K),Avg Sale Value (K)\n';
            this.currentData.forEach(s => {
                csv += `"${s.staff_name}", ${s.total_transactions},${parseFloat(s.total_revenue).toFixed(2)},${parseFloat(s.avg_sale_value).toFixed(2)} \n`;
            });
        } else if (this.currentTab === 'stock') {
            csv = 'Product,Last Sale Date,Qty In Stock,Value Tied Up (K)\n';
            this.currentData.forEach(p => {
                const lastSale = p.last_sale ? new Date(p.last_sale).toLocaleDateString() : 'Never';
                csv += `"${p.name}", ${lastSale},${p.stock_quantity},${(p.stock_quantity * parseFloat(p.cost_price)).toFixed(2)} \n`;
            });
        } else if (this.currentTab === 'financials') {
            // currentData is [financials, tax]
            const [fin, tax] = Array.isArray(this.currentData) ? this.currentData : [this.currentData, null];
            csv = 'Line Item,Amount (K)\n';
            if (fin) {
                csv += `"Net Revenue", ${parseFloat(fin.revenue || 0).toFixed(2)} \n`;
                csv += `"Cost of Goods Sold", ${parseFloat(fin.cogs || 0).toFixed(2)} \n`;
                csv += `"Gross Profit", ${parseFloat(fin.gross_profit || 0).toFixed(2)} \n`;
                csv += `"Operating Expenses", ${parseFloat(fin.expenses || 0).toFixed(2)} \n`;
                csv += `"Net Profit", ${parseFloat(fin.net_profit || 0).toFixed(2)} \n`;
            }
            if (tax) csv += `"VAT Collected", ${parseFloat(tax.tax_collected || 0).toFixed(2)} \n`;
        } else if (this.currentTab === 'profit-margin') {
            const isProduct = this.pmGroupBy === 'product';
            if (isProduct) {
                csv = 'Product,Category,Qty Sold,Revenue,COGS,Gross Profit,Margin %\n';
            } else {
                csv = 'Category,Qty Sold,Revenue,COGS,Gross Profit,Margin %\n';
            }
            this.currentData.forEach(item => {
                if (isProduct) {
                    csv += `"${item.item_name || 'Uncategorized'}","${item.category_name || '-'}",${item.items_sold},${parseFloat(item.revenue).toFixed(2)},${parseFloat(item.cogs).toFixed(2)},${parseFloat(item.gross_profit).toFixed(2)},${parseFloat(item.margin_pct).toFixed(2)}\n`;
                } else {
                    csv += `"${item.item_name || 'Uncategorized'}",${item.items_sold},${parseFloat(item.revenue).toFixed(2)},${parseFloat(item.cogs).toFixed(2)},${parseFloat(item.gross_profit).toFixed(2)},${parseFloat(item.margin_pct).toFixed(2)}\n`;
                }
            });
        } else {
            // Fallback: generic JSON-to-CSV
            if (!Array.isArray(this.currentData) || !this.currentData.length) return Utils.toast('No data to export', 'warning');
            const keys = Object.keys(this.currentData[0]);
            csv = keys.join(',') + '\n';
            this.currentData.forEach(row => {
                csv += keys.map(k => {
                    let val = row[k];
                    if (typeof val === 'string' && val.includes(',')) val = `"${val}"`;
                    return val ?? '';
                }).join(',') + '\n';
            });
        }

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    },

    printCurrent() {
        const content = document.getElementById('report-content');
        if (!content) return;
        const win = window.open('', '_blank', 'width=900,height=700');
        win.document.write(`
            <html><head><title>Zachi POS — Advanced Report</title>
            <style>
                body { font-family: sans-serif; padding: 24px; color: #1e293b; }
                h1 { color: #1B3A5C; font-size: 1.4rem; }
                table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
                th { background: #1B3A5C; color: #fff; padding: 7px 10px; text-align: left; font-size: 0.8rem; }
                td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; font-size: 0.8rem; }
                tr:nth-child(even) td { background: #f8fafc; }
                .report-premium-card { border: 1px solid #e2e8f0; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; }
                @media print { body { margin: 0; } }
            </style></head>
            <body>
                <div style="display:flex;align-items:center;gap:15px;margin-bottom:5px;">
                    <img src="/logo.jpg" style="height:40px; border-radius:4px;" alt="Logo">
                    <h1 style="margin:0;">Zachi Smart-POS — ${this.currentTab.charAt(0).toUpperCase() + this.currentTab.slice(1)} Report</h1>
                </div>
                <p style="color:#64748b;margin-top:0;">Period: ${this.dateRange.start} to ${this.dateRange.end}</p>
                ${content.innerHTML}
            </body></html > `);
        win.document.close();
        win.focus();
        win.print();
    },

    downloadPdf() {
        // Map current tab to a PDF type the backend understands
        const typeMap = { sales: 'sales', trends: 'sales', financials: 'financials', stock: 'financials', insights: 'daily', 'profit-margin': 'financials' };
        const pdfType = typeMap[this.currentTab] || 'daily';
        const url = `/api/reports/pdf?type=${pdfType}&startDate=${this.dateRange.start}&endDate=${this.dateRange.end}`;
        const a = document.createElement('a');
        a.href = url;
        a.download = `zachipos_${pdfType}_${this.dateRange.start}.pdf`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
    }
};
