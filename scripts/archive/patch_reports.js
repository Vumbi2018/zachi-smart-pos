const fs = require('fs');

try {
let content = fs.readFileSync('public/js/reports_adv.js', 'utf8');

// Container bg
content = content.replace('<div id="report-content">', '<div id="report-content" class="report-page-bg">');

// renderSales top section
content = content.replace(/<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">[\s\S]*?<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">/m, 
`<div class="report-grid-3">
    <div class="report-premium-card">
        <div class="report-metric-label">Total Revenue</div>
        <div class="report-metric-value">\${Utils.formatCurrency(totalSales)}</div>
    </div>
    <div class="report-premium-card">
        <div class="report-metric-label">Transactions</div>
        <div class="report-metric-value">\${totalTx}</div>
    </div>
    <div class="report-premium-card">
        <div class="report-metric-label">Avg. Ticket</div>
        <div class="report-metric-value">\${Utils.formatCurrency(totalTx ? totalSales / totalTx : 0)}</div>
    </div>
</div>

<div class="report-grid-2">
`);

content = content.replace(/<div class="card">\s*<div class="card-header"><h3 class="card-title">Day-by-Day Performance[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, 
`<div class="report-premium-card p-0">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Day-by-Day Performance</h3></div>
    <div class="report-table-wrapper mx-6 mb-6">
        <table class="report-table">
            <thead><tr><th>Date</th><th class="text-right">Tx</th><th class="text-right">Revenue</th></tr></thead>
            <tbody>
                \${byDate.map(d => \`
                    <tr>
                        <td>\${new Date(d.date).toLocaleDateString()}</td>
                        <td class="text-right">\${d.count}</td>
                        <td class="text-right font-bold">\${Utils.formatCurrency(d.total)}</td>
                    </tr>
                \`).join('')}
            </tbody>
        </table>
    </div>
</div>`);

content = content.replace(/<div class="card">\s*<div class="card-header"><h3 class="card-title">Top Products[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, 
`<div class="report-premium-card p-0">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Top Products</h3></div>
    <div class="report-table-wrapper mx-6 mb-6">
        <table class="report-table">
            <thead><tr><th>Product</th><th class="text-right">Qty</th><th class="text-right">Revenue</th></tr></thead>
            <tbody>
                \${byProduct.map(p => \`
                    <tr>
                        <td>\${p.name}</td>
                        <td class="text-right">\${p.count}</td>
                        <td class="text-right font-bold">\${Utils.formatCurrency(p.total)}</td>
                    </tr>
                \`).join('')}
            </tbody>
        </table>
    </div>
</div>`);

content = content.replace(/<div class="card">\s*<div class="card-header"><h3 class="card-title">Category Breakdown[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, 
`<div class="report-premium-card p-0 lg:col-span-2">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Category Breakdown</h3></div>
    <div class="report-table-wrapper mx-6 mb-6">
        <table class="report-table">
            <thead><tr><th>Category</th><th class="text-right">% Sales</th><th class="text-right">Revenue</th></tr></thead>
            <tbody>
                \${byCategory.map(c => \`
                    <tr>
                        <td>\${c.category || 'Uncategorized'}</td>
                        <td class="text-right">\${totalSales > 0 ? Math.round((c.total / totalSales) * 100) : 0}%</td>
                        <td class="text-right font-bold">\${Utils.formatCurrency(c.total)}</td>
                    </tr>
                \`).join('')}
            </tbody>
        </table>
    </div>
</div>`);

// Stock
content = content.replace(/<div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">[\s\S]*?<div class="card">/, 
`<div class="report-grid-2">
    <div class="report-premium-card">
        <div class="report-metric-label">Total Stock Value (Cost)</div>
        <div class="report-metric-value" style="background: linear-gradient(135deg, #2563eb, #3b82f6); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">\${Utils.formatCurrency(valuation.total_cost_value)}</div>
        <div class="text-sm mt-2 text-slate-500 font-semibold">Retail Value: \${Utils.formatCurrency(valuation.total_retail_value)}</div>
    </div>
    <div class="report-premium-card">
        <div class="report-metric-label">Inventory Metrics</div>
        <div class="flex justify-between mt-2 py-2 border-b border-slate-100">
            <span class="text-slate-500">Total SKUs:</span> <strong class="text-lg">\${valuation.total_items}</strong>
        </div>
        <div class="flex justify-between py-2">
            <span class="text-slate-500">Total Units:</span> <strong class="text-lg">\${valuation.total_units}</strong>
        </div>
    </div>
</div>

<div class="report-premium-card p-0 mt-6">`);

content = content.replace(/<div class="card-header bg-red-50">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*`;/m, 
`<div class="report-header px-6 pt-6 border-b-0"><h3 class="report-header-title text-red-600">⚠️ Slow Moving Inventory (No sales in 90 days)</h3></div>
    <div class="report-table-wrapper mx-6 mb-6">
        <table class="report-table">
            <thead><tr><th>Product</th><th>Last Sale</th><th class="text-right">Qty in Stock</th><th class="text-right">Value Tied Up</th></tr></thead>
            <tbody>
                \${slowMoving.map(p => \`
                    <tr>
                        <td>\${p.name}</td>
                        <td>\${p.last_sale ? new Date(p.last_sale).toLocaleDateString() : 'Never'}</td>
                        <td class="text-right text-red-600 font-bold">\${p.stock_quantity}</td>
                        <td class="text-right font-bold">\${Utils.formatCurrency(p.stock_quantity * p.cost_price)}</td>
                    </tr>
                \`).join('') || '<tr><td colspan="4" class="text-center p-8 text-slate-400 font-medium"><i class="fas fa-check-circle text-green-500 mr-2"></i>Good news! No stagnant inventory found.</td></tr>'}
            </tbody>
        </table>
    </div>
</div>
\`;`);


// Financials
content = content.replace(/<div class="card">\s*<div class="card-header border-b-4 border-blue-500"><h3 class="card-title">Profit & Loss Statement[\s\S]*?<\/div>\s*<\/div>\s*<!-- Tax Summary -->\s*<div class="card">\s*<div class="card-header"><h3 class="card-title">Tax Summary \(VAT\)<\/h3><\/div>/m, 
`<div class="report-premium-card p-0 lg:col-span-1">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Profit & Loss Statement (Estimated)</h3></div>
    <div class="report-table-wrapper mx-6 mb-6 border-none shadow-none">
        <table class="report-table">
            <tbody>
                <tr><td class="text-slate-500">Total Revenue (excl. tax)</td><td class="text-right font-bold text-lg">\${Utils.formatCurrency(financials.revenue)}</td></tr>
                <tr><td class="text-red-500">Cost of Goods Sold (COGS)</td><td class="text-right text-red-500">- \${Utils.formatCurrency(financials.cogs)}</td></tr>
                <tr style="background-color: #f8fafc;"><td class="font-bold text-slate-800 border-none">Gross Profit</td><td class="text-right font-bold text-lg border-none">\${Utils.formatCurrency(financials.gross_profit)}</td></tr>
                <tr><td class="text-red-500">Operating Expenses</td><td class="text-right text-red-500">- \${Utils.formatCurrency(financials.expenses)}</td></tr>
                <tr>
                    <td class="font-bold text-slate-800 text-lg border-none">NET PROFIT</td>
                    <td class="text-right font-bold text-2xl \${profitClass} border-none">\${Utils.formatCurrency(financials.net_profit)}</td>
                </tr>
            </tbody>
        </table>
        <div class="text-center pb-4 text-xs font-semibold text-slate-400">Net Margin: \${financials.margin_percent.toFixed(1)}%</div>
    </div>
</div>

<!-- Tax Summary -->
<div class="report-premium-card p-0 lg:col-span-1">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Tax Summary (VAT)</h3></div>`);

content = content.replace(/<div class="card-body">\s*<div class="grid grid-cols-2 gap-4 mb-6">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*`;/,
`   <div class="report-table-wrapper mx-6 mb-6 border-none shadow-none">
        <div class="grid grid-cols-2 gap-4 mb-8">
            <div class="bg-blue-50/50 p-4 rounded-xl border border-blue-100 text-center">
                <div class="text-xs uppercase text-blue-600/70 font-bold mb-1">Tax Collected</div>
                <div class="text-2xl font-bold text-blue-700">\${Utils.formatCurrency(tax.tax_collected)}</div>
            </div>
            <div class="bg-orange-50/50 p-4 rounded-xl border border-orange-100 text-center">
                <div class="text-xs uppercase text-orange-600/70 font-bold mb-1">Tax Paid</div>
                <div class="text-2xl font-bold text-orange-700">\${Utils.formatCurrency(tax.tax_paid)}</div>
            </div>
        </div>
        <div class="text-center">
            <div class="text-sm uppercase text-slate-400 font-bold tracking-wider">Net Tax Payable</div>
            <div class="text-5xl font-extrabold mt-2 text-slate-800">\${Utils.formatCurrency(tax.net_tax_payable)}</div>
            <p class="text-xs text-slate-400 mt-4 px-8 leading-relaxed">This is an estimate based on system records.</p>
        </div>
    </div>
</div>
\`;`);

// Trends
content = content.replace(/<div class="card mb-6">[\s\S]*?<div id="sales-chart" style="min-height: 350px;"><\/div>\s*<\/div>\s*<\/div>/m, 
`<div class="report-premium-card p-0 mb-6">
    <div class="report-header px-6 pt-6 mb-0 border-none">
        <h3 class="report-header-title">Sales Trends (\${type.toUpperCase()})</h3>
        <select class="form-input py-1.5 px-3 text-sm font-medium bg-slate-50 border-slate-200 rounded-lg text-slate-700 focus:ring-blue-500 focus:border-blue-500" onchange="ReportsAdv.aggType = this.value; ReportsAdv.loadCurrentTab()">
            <option value="day" \${type === 'day' ? 'selected' : ''}>Daily</option>
            <option value="week" \${type === 'week' ? 'selected' : ''}>Weekly</option>
            <option value="month" \${type === 'month' ? 'selected' : ''}>Monthly</option>
            <option value="quarter" \${type === 'quarter' ? 'selected' : ''}>Quarterly</option>
            <option value="year" \${type === 'year' ? 'selected' : ''}>Annual</option>
        </select>
    </div>
    <div id="sales-chart" class="px-2" style="min-height: 350px;"></div>
</div>`);

content = content.replace(/<div class="card">\s*<div class="card-header"><h3 class="card-title">Aggregated Data Table[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*`;/m,
`<div class="report-premium-card p-0">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Aggregated Data Table</h3></div>
    <div class="report-table-wrapper mx-6 mb-6">
        <table class="report-table">
            <thead><tr><th>Period</th><th class="text-right">Transactions</th><th class="text-right">Revenue</th></tr></thead>
            <tbody>
                \${data.map(d => \`
                    <tr>
                        <td>\${new Date(d.period).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: type === 'day' ? 'numeric' : undefined })}</td>
                        <td class="text-right">\${d.transactions}</td>
                        <td class="text-right font-bold text-slate-800">\${Utils.formatCurrency(d.revenue)}</td>
                    </tr>
                \`).join('')}
            </tbody>
        </table>
    </div>
</div>
\`;`);

// Insights
content = content.replace(/<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">\s*<!-- Staff Performance -->\s*<div class="card">\s*<div class="card-header"><h3 class="card-title">Staff Sales Performance<\/h3><\/div>\s*<div class="card-body p-0">/m, `<div class="report-grid-2">
<!-- Staff Performance -->
<div class="report-premium-card p-0">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Staff Sales Performance</h3></div>
    <div class="report-table-wrapper mx-6 mb-6">`);
content = content.replace(/<\/div>\s*<\/div>\s*<!-- Top Customers -->\s*<div class="card">\s*<div class="card-header"><h3 class="card-title">Top Customer Insights<\/h3><\/div>\s*<div class="card-body p-0">/m, `</div>
</div>
<!-- Top Customers -->
<div class="report-premium-card p-0">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Top Customer Insights</h3></div>
    <div class="report-table-wrapper mx-6 mb-6">`);
content = content.replace(/<\/div>\s*<\/div>\s*<\/div>\s*<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">\s*<!-- Category Profitability -->\s*<div class="card">\s*<div class="card-header"><h3 class="card-title">Category Gross Margins<\/h3><\/div>\s*<div class="card-body p-0">/m, `</div>
</div>
</div>
<div class="report-grid-2">
<!-- Category Profitability -->
<div class="report-premium-card p-0">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Category Gross Margins</h3></div>
    <div class="report-table-wrapper mx-6 mb-6">`);
content = content.replace(/<span class="badge/g, '<span class="report-badge');
content = content.replace(/badge-success/g, 'report-badge-success');
content = content.replace(/badge-warning/g, 'report-badge-warning');
content = content.replace(/<\/div>\s*<\/div>\s*<!-- Hourly Sales Trend -->\s*<div class="card">\s*<div class="card-header"><h3 class="card-title">Hourly Sales Activity \(Heatmap\)<\/h3><\/div>\s*<div class="card-body">/m, `</div>
</div>
<!-- Hourly Sales Trend -->
<div class="report-premium-card p-0">
    <div class="report-header px-6 pt-6"><h3 class="report-header-title">Hourly Sales Activity</h3></div>
    <div class="px-2 pb-6">`);

fs.writeFileSync('public/js/reports_adv.js', content);
console.log('Patch complete.');
} catch (err) { console.error('Error:', err); }
