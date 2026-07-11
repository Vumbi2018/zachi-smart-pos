/**
 * Zachi Smart-POS - Reports Module (Basic)
 */
const Reports = {
  async render(container) {
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

    container.innerHTML = `
      <div class="page-header">
        <h2>📈 Reports</h2>
        <div class="header-actions" data-style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
          <label data-style="font-size:0.8rem;color:var(--text-muted);">From</label>
          <input type="date" id="report-start" value="${weekAgo}" class="btn btn-secondary" data-style="padding:0.5rem 0.8rem;">
          <label data-style="font-size:0.8rem;color:var(--text-muted);">To</label>
          <input type="date" id="report-end" value="${today}" class="btn btn-secondary" data-style="padding:0.5rem 0.8rem;">
          <button class="btn btn-primary" data-on-click="Reports.loadData()">Update</button>
          <button class="btn btn-secondary" data-on-click="Reports.print()" title="Print this report">🖨️ Print</button>
          <button class="btn btn-secondary" data-on-click="Reports.downloadPdf('daily')" title="Download PDF">📄 PDF</button>
        </div>
      </div>

      <div id="report-printable">
        <p id="report-period-label" data-style="color:var(--text-muted);font-size:0.85rem;margin-bottom:0.75rem;"></p>

        <!-- Profit Summary -->
        <div class="stats-grid" data-style="grid-template-columns:repeat(3,1fr);">
          <div class="stat-card">
            <div class="stat-icon green">💰</div>
            <div class="card-title">Total Revenue</div>
            <div class="card-value" id="rpt-revenue">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon red">📉</div>
            <div class="card-title">Total Expenses</div>
            <div class="card-value" id="rpt-expenses">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-icon blue">📊</div>
            <div class="card-title">Net Profit</div>
            <div class="card-value" id="rpt-profit" data-style="color:var(--success);">—</div>
          </div>
        </div>

        <div data-style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <!-- Revenue by Payment -->
          <div class="card">
            <div class="card-header"><span class="card-title">Revenue by Payment Method</span></div>
            <div id="rpt-payment-breakdown"><p class="text-muted text-center loading" data-style="padding:1rem;">Loading...</p></div>
          </div>

          <!-- Top Services -->
          <div class="card">
            <div class="card-header"><span class="card-title">Top Services (Period)</span></div>
            <div id="rpt-top-services"><p class="text-muted text-center loading" data-style="padding:1rem;">Loading...</p></div>
          </div>
        </div>

        <div class="card mt-2">
          <div class="card-header"><span class="card-title">Low Stock Alerts</span></div>
          <div id="rpt-low-stock"><p class="text-muted text-center loading" data-style="padding:1rem;">Loading...</p></div>
        </div>
      </div>
    `;

    await this.loadData();
  },

  getDateRange() {
    const start = document.getElementById('report-start').value;
    const end = document.getElementById('report-end').value;
    return { start, end: `${end} 23:59:59`, endDisplay: end };
  },

  async loadData() {
    const { start, end, endDisplay } = this.getDateRange();

    // Update period label
    const label = document.getElementById('report-period-label');
    if (label) label.textContent = `Showing: ${new Date(start).toLocaleDateString()} – ${new Date(endDisplay).toLocaleDateString()}`;

    try {
      const [profit, revenue, topServices, lowStock] = await Promise.all([
        API.get(`/reports/daily-profit?startDate=${start}&endDate=${end}`),
        API.get(`/reports/daily-revenue?startDate=${start}&endDate=${end}`),
        API.get(`/reports/top-services?startDate=${start}&endDate=${end}`),
        API.get('/reports/low-stock')
      ]);

      // Profit summary
      document.getElementById('rpt-revenue').textContent = Utils.currency(profit.total_revenue);
      document.getElementById('rpt-expenses').textContent = Utils.currency(profit.total_costs);
      const profitEl = document.getElementById('rpt-profit');
      const netProfit = parseFloat(profit.net_profit);
      profitEl.textContent = Utils.currency(netProfit);
      profitEl.style.color = netProfit >= 0 ? 'var(--success)' : 'var(--danger)';

      // Payment breakdown
      const paymentEl = document.getElementById('rpt-payment-breakdown');
      if (revenue.by_payment_method.length === 0) {
        paymentEl.innerHTML = '<p class="text-muted text-center" data-style="padding:1rem;">No sales in this period</p>';
      } else {
        paymentEl.innerHTML = revenue.by_payment_method.map(r => `
          <div data-style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0;border-bottom:1px solid var(--border);">
            <div>
              <div data-style="font-weight:600;font-size:0.85rem;">${r.payment_method.replace('_', ' ')}</div>
              <div data-style="font-size:0.75rem;color:var(--text-muted);">${r.total_transactions} transactions</div>
            </div>
            <div data-style="font-weight:700;">${Utils.currency(r.gross_revenue)}</div>
          </div>
        `).join('');
      }

      // Top services
      const servicesEl = document.getElementById('rpt-top-services');
      if (!topServices.services.length) {
        servicesEl.innerHTML = '<p class="text-muted text-center" data-style="padding:1rem;">No service data in this period</p>';
      } else {
        servicesEl.innerHTML = topServices.services.map((s, i) => `
          <div data-style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0;border-bottom:1px solid var(--border);">
            <div>
              <div data-style="font-weight:600;font-size:0.85rem;">${i + 1}. ${s.service_name}</div>
              <div data-style="font-size:0.75rem;color:var(--text-muted);">${s.category} · ${s.total_orders} orders</div>
            </div>
            <div data-style="font-weight:700;color:var(--accent);">${Utils.currency(s.total_revenue)}</div>
          </div>
        `).join('');
      }

      // Low stock
      const stockEl = document.getElementById('rpt-low-stock');
      if (lowStock.count === 0) {
        stockEl.innerHTML = '<p class="text-success text-center" data-style="padding:1rem;">✓ All items well stocked</p>';
      } else {
        stockEl.innerHTML = `
          <table data-style="width:100%;">
            <thead><tr><th>Product</th><th>Category</th><th>Stock</th><th>Reorder Level</th><th>Shortage</th></tr></thead>
            <tbody>
              ${lowStock.alerts.map(item => `
                <tr>
                  <td><strong>${item.name}</strong></td>
                  <td>${item.category || '—'}</td>
                  <td class="text-danger font-semibold">${item.stock_quantity}</td>
                  <td>${item.reorder_level}</td>
                  <td><span class="badge badge-danger">${item.shortage} short</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }
    } catch (err) {
      Utils.toast('Failed to load reports', 'error');
    }
  },

  print() {
    const printContent = document.getElementById('report-printable');
    const win = window.open('', '_blank', 'width=800,height=600');
    // Stylesheet loaded externally so the print window does not need
    // style-src 'unsafe-inline' (Task #7).
    win.document.write(`
            <html><head><title>Zachi POS Report</title>
            <link rel="stylesheet" href="${location.origin}/css/print-report.css">
            </head>
            <body>
                <h2>Zachi Smart-POS — Report</h2>
                <p>${document.getElementById('report-period-label').textContent}</p>
                ${printContent.innerHTML}
            </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  },

  downloadPdf(type) {
    const { start, end } = this.getDateRange();
    const url = `/api/reports/pdf?type=${type}&startDate=${start}&endDate=${end}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `zachipos_report_${type}_${start}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
};

// Expose to global scope for delegated event handlers (data-on-* attributes).
window.Reports = Reports;
