/**
 * Zachi Smart-POS - Reports Module
 */
const Reports = {
    async render(container) {
        container.innerHTML = `
      <div class="page-header">
        <h2>📈 Reports</h2>
        <div class="header-actions">
          <input type="date" id="report-date" value="${new Date().toISOString().slice(0, 10)}" class="btn btn-secondary" style="padding:0.5rem 0.8rem;">
        </div>
      </div>

      <!-- Profit Summary -->
      <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);">
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
          <div class="card-value" id="rpt-profit" style="color:var(--success);">—</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
        <!-- Revenue by Payment -->
        <div class="card">
          <div class="card-header"><span class="card-title">Revenue by Payment Method</span></div>
          <div id="rpt-payment-breakdown"><p class="text-muted text-center loading" style="padding:1rem;">Loading...</p></div>
        </div>

        <!-- Top Services -->
        <div class="card">
          <div class="card-header"><span class="card-title">Top Services (30 Days)</span></div>
          <div id="rpt-top-services"><p class="text-muted text-center loading" style="padding:1rem;">Loading...</p></div>
        </div>
      </div>

      <div class="card mt-2">
        <div class="card-header"><span class="card-title">Low Stock Alerts</span></div>
        <div id="rpt-low-stock"><p class="text-muted text-center loading" style="padding:1rem;">Loading...</p></div>
      </div>
    `;

        document.getElementById('report-date').addEventListener('change', () => this.loadData());
        await this.loadData();
    },

    async loadData() {
        const date = document.getElementById('report-date').value;

        try {
            const [profit, revenue, topServices, lowStock] = await Promise.all([
                API.get(`/reports/daily-profit?date=${date}`),
                API.get(`/reports/daily-revenue?date=${date}`),
                API.get('/reports/top-services'),
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
                paymentEl.innerHTML = '<p class="text-muted text-center" style="padding:1rem;">No sales data</p>';
            } else {
                paymentEl.innerHTML = revenue.by_payment_method.map(r => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0;border-bottom:1px solid var(--border);">
            <div>
              <div style="font-weight:600;font-size:0.85rem;">${r.payment_method.replace('_', ' ')}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);">${r.total_transactions} transactions</div>
            </div>
            <div style="font-weight:700;">${Utils.currency(r.gross_revenue)}</div>
          </div>
        `).join('');
            }

            // Top services
            const servicesEl = document.getElementById('rpt-top-services');
            if (!topServices.services.length) {
                servicesEl.innerHTML = '<p class="text-muted text-center" style="padding:1rem;">No service data</p>';
            } else {
                servicesEl.innerHTML = topServices.services.map((s, i) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0;border-bottom:1px solid var(--border);">
            <div>
              <div style="font-weight:600;font-size:0.85rem;">${i + 1}. ${s.service_name}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);">${s.category} · ${s.total_orders} orders</div>
            </div>
            <div style="font-weight:700;color:var(--accent);">${Utils.currency(s.total_revenue)}</div>
          </div>
        `).join('');
            }

            // Low stock
            const stockEl = document.getElementById('rpt-low-stock');
            if (lowStock.count === 0) {
                stockEl.innerHTML = '<p class="text-success text-center" style="padding:1rem;">✓ All items well stocked</p>';
            } else {
                stockEl.innerHTML = `
          <table style="width:100%;">
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
    }
};
