/**
 * Zachi Smart-POS - Smart Director's Dashboard
 * 5 Business Intelligence Widgets:
 *   1. Daily Revenue Reconciliation (by payment method)
 *   2. Production Heat Map (Job Card Monitor)
 *   3. Low-Stock Smart Alert
 *   4. Service vs Retail Profitability
 *   5. Daily Net Profit Estimate
 */
const Dashboard = {
  data: {},
  isLoading: false,
  filterState: {
    range: 'today', // today, yesterday, 7days, 30days, this_month, last_month, custom
    start: null,
    end: null,
    label: 'Today'
  },

  init() {
    this.filterState.start = new Date().toLocaleDateString('en-CA');
    this.filterState.end = new Date().toLocaleDateString('en-CA');
  },

  async render(container) {
    const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    container.innerHTML = `
      <div class="page-header">
        <h2>📊 Director's Dashboard</h2>
        <div class="header-actions">
           <div class="flex gap-2 items-center bg-white p-1 rounded border border-gray-200">
              <select id="dash-range-select" class="p-1 text-sm border-none bg-transparent font-medium text-gray-700 focus:ring-0" data-on-change="Dashboard.handleRangeChange($value)">
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="7days">Last 7 Days</option>
                <option value="30days">Last 30 Days</option>
                <option value="this_month">This Month</option>
                <option value="last_month">Last Month</option>
                <option value="custom">Custom Range</option>
              </select>
              <div id="dash-custom-dates" class="hidden flex gap-1 items-center border-l pl-2 ml-1">
                <input type="date" id="dash-start-date" class="p-1 text-xs border rounded">
                <span class="text-gray-400">-</span>
                <input type="date" id="dash-end-date" class="p-1 text-xs border rounded">
                <button class="btn btn-xs btn-primary" data-on-click="Dashboard.applyCustomDate()">Go</button>
              </div>
           </div>
           <span class="text-muted" data-style="font-size:0.82rem;" id="dash-date-label">${dateStr}</span>
        </div>
      </div>

      <!-- ── Row 1: KPI Summary Cards ── -->
      <div class="stats-grid" id="stats-grid">
        <div class="stat-card stat-gradient-revenue clickable" data-on-click="Dashboard.showDrillDown('revenue')">
          <div class="stat-icon-wrap"><span class="stat-icon-emoji">💰</span></div>
          <div class="stat-body">
            <div class="stat-label">Revenue <span class="text-xs opacity-75 font-normal" id="lbl-revenue">(Today)</span></div>
            <div class="stat-value" id="stat-revenue">—</div>
            <div class="stat-sub" id="stat-transactions">Loading...</div>
          </div>
        </div>
        <div class="stat-card stat-gradient-profit clickable" data-on-click="Dashboard.showDrillDown('profit')">
          <div class="stat-icon-wrap"><span class="stat-icon-emoji">📈</span></div>
          <div class="stat-body">
            <div class="stat-label">Net Profit</div>
            <div class="stat-value" id="stat-profit">—</div>
            <div class="stat-sub" id="stat-expenses">Loading...</div>
          </div>
        </div>
        <div class="stat-card stat-gradient-stock clickable" data-on-click="Dashboard.showDrillDown('low_stock')">
          <div class="stat-icon-wrap"><span class="stat-icon-emoji">⚠️</span></div>
          <div class="stat-body">
            <div class="stat-label">Low Stock</div>
            <div class="stat-value" id="stat-low-stock">—</div>
            <div class="stat-sub">Items need reorder</div>
          </div>
        </div>
        <div class="stat-card stat-gradient-jobs clickable" data-on-click="Dashboard.showDrillDown('jobs')">
          <div class="stat-icon-wrap"><span class="stat-icon-emoji">🔧</span></div>
          <div class="stat-body">
            <div class="stat-label">Active Jobs</div>
            <div class="stat-value" id="stat-jobs">—</div>
            <div class="stat-sub">In production</div>
          </div>
        </div>
      </div>

      <!-- ── Row 1.5: AI & Business Intelligence ── -->
      <div class="dash-grid-2 mb-6" id="ai-intelligence-row">
        <div class="card dash-card border-l-4 border-teal-500">
           <div class="card-header">
                <span class="card-title"><i class="fas fa-robot text-teal-600"></i> Zachi-AI Market Insights</span>
                <span class="badge badge-success">Live</span>
           </div>
           <div id="ai-insights-container" class="dash-card-body p-4">
                <div class="animate-pulse flex space-x-4">
                    <div class="flex-1 space-y-4 py-1">
                        <div class="h-4 bg-gray-200 rounded w-3/4"></div>
                        <div class="space-y-2">
                            <div class="h-4 bg-gray-200 rounded"></div>
                            <div class="h-4 bg-gray-200 rounded w-5/6"></div>
                        </div>
                    </div>
                </div>
           </div>
        </div>
        
        <div class="card dash-card border-l-4 border-red-500">
           <div class="card-header">
                <span class="card-title"><i class="fas fa-shield-alt text-red-600"></i> Security & Fraud Monitor</span>
                <span id="fraud-alert-count" class="badge badge-neutral">0 Alerts</span>
           </div>
           <div id="ai-fraud-container" class="dash-card-body p-4">
                <div class="text-muted text-xs text-center p-4">Scanning transaction patterns...</div>
           </div>
        </div>
      </div>

      <!-- ── Row 1.55: Line Removal Outlier Alerts (Task #61) ── -->
      <div class="card dash-card border-l-4 border-amber-500 mb-6">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-user-minus text-amber-600"></i> Line Removal Outliers (last 24h)</span>
          <span id="line-removal-alert-count" class="badge badge-neutral">—</span>
        </div>
        <div id="line-removal-alerts" class="dash-card-body p-4">
          <div class="text-muted text-xs text-center p-4">Scanning cashier removal patterns...</div>
        </div>
      </div>

      <!-- ── Row 1.6: Ask Zachi-AI (LLM-powered NL report query) ── -->
      <div class="card dash-card border-l-4 border-purple-500 mb-6">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-magic text-purple-600"></i> Ask Zachi-AI</span>
          <span class="badge bg-purple-100 text-purple-700">Beta</span>
        </div>
        <div class="dash-card-body p-4">
          <div class="text-xs text-muted mb-2">Ask in plain English. Examples: <em>"Top 5 products this week"</em> · <em>"Revenue by payment method today"</em> · <em>"Which customers spent the most this month?"</em></div>
          <form data-on-submit="Dashboard.askAI($event)" class="flex gap-2">
            <input type="text" id="ask-ai-input" class="form-input flex-1" placeholder="e.g. What were my best sellers last week?" maxlength="500" autocomplete="off">
            <button type="submit" class="btn btn-primary" id="ask-ai-submit"><i class="fas fa-paper-plane"></i> Ask</button>
          </form>
          <div id="ask-ai-result" class="mt-3"></div>
        </div>
      </div>

      <!-- ── Row 2: Revenue Reconciliation + Production Heat Map ── -->
      <div class="dash-grid-2">
        <div class="card dash-card">
          <div class="card-header">
            <span class="card-title">💵 Revenue Reconciliation</span>
            <span class="badge badge-info" id="revenue-date">Today</span>
          </div>
          <div id="revenue-breakdown" class="dash-card-body">
            <p class="text-muted text-center" data-style="padding:1.5rem;">Loading...</p>
          </div>
        </div>

        <div class="card dash-card">
          <div class="card-header">
            <span class="card-title">🔥 Production Heat Map</span>
            <span class="badge badge-warning" id="job-count">—</span>
          </div>
          <div id="production-heatmap" class="dash-card-body">
            <p class="text-muted text-center" data-style="padding:1.5rem;">Loading...</p>
          </div>
        </div>
      </div>

      <!-- ── Row 3: Service vs Retail + Top Services ── -->
      <div class="dash-grid-2">
        <div class="card dash-card">
          <div class="card-header">
            <span class="card-title">⚖️ Service vs Retail (30 days)</span>
          </div>
            <div id="service-vs-retail" class="dash-card-body">
            <p class="text-muted text-center" data-style="padding:1.5rem;">Loading...</p>
          </div>
        </div>

        <div class="card dash-card">
          <div class="card-header">
            <span class="card-title">🏆 Top Services</span>
          </div>
          <div id="top-services-list" class="dash-card-body">
            <p class="text-muted text-center" data-style="padding:1.5rem;">Loading...</p>
          </div>
        </div>
      </div>

      <!-- ── Row 3.5: Trend & Mix Charts ── -->
      <div class="dash-grid-2" data-style="margin-top:1rem;">
        <div class="card dash-card">
          <div class="card-header">
            <span class="card-title">📈 14-Day Sales Trend</span>
            <span class="badge badge-info" id="chart-trend-total">—</span>
          </div>
          <div class="dash-card-body" data-style="padding:0.5rem;">
            <div id="chart-sales-trend" data-style="min-height:240px;"></div>
          </div>
        </div>
        <div class="card dash-card">
          <div class="card-header">
            <span class="card-title">🏆 Top Products (30 days)</span>
            <span class="badge badge-success" id="chart-top-count">—</span>
          </div>
          <div class="dash-card-body" data-style="padding:0.5rem;">
            <div id="chart-top-products" data-style="min-height:240px;"></div>
          </div>
        </div>
      </div>

      <div class="card dash-card" data-style="margin-top:1rem;">
        <div class="card-header">
          <span class="card-title">💳 Payment Method Breakdown (30 days)</span>
        </div>
        <div class="dash-card-body" data-style="padding:0.5rem;">
          <div id="chart-payment-mix" data-style="min-height:280px;"></div>
        </div>
      </div>

      <!-- ── Row 4: Low Stock Alerts ── -->
      <div class="card dash-card" data-style="margin-top:1rem;">
        <div class="card-header">
          <span class="card-title">📦 Smart Stock Alerts</span>
          <span class="badge badge-danger" id="stock-alert-count">—</span>
        </div>
        <div id="low-stock-list" class="dash-card-body">
          <p class="text-muted text-center" data-style="padding:1.5rem;">Loading...</p>
        </div>
      </div>
    `;

    // Initialize dates if not set
    if (!this.filterState.start) this.init();

    // Set initial UI state
    document.getElementById('dash-range-select').value = this.filterState.range;
    if (this.filterState.range === 'custom') {
      document.getElementById('dash-custom-dates').classList.remove('hidden');
      document.getElementById('dash-start-date').value = this.filterState.start;
      document.getElementById('dash-end-date').value = this.filterState.end;
    }

    await this.loadAll();
  },

  handleRangeChange(range) {
    this.filterState.range = range;
    const now = new Date();
    let start = new Date();
    let end = new Date();

    if (range === 'custom') {
      document.getElementById('dash-custom-dates').classList.remove('hidden');
      return; // Wait for user to click Go
    } else {
      document.getElementById('dash-custom-dates').classList.add('hidden');
    }

    switch (range) {
      case 'today':
        // start/end already now
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

    // Update label text
    const dateLabel = document.getElementById('dash-date-label');
    if (dateLabel) {
      if (range === 'today') dateLabel.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      else dateLabel.textContent = `${this.filterState.label} (${this.filterState.start} - ${this.filterState.end})`;
    }

    this.loadAll();
  },

  applyCustomDate() {
    const s = document.getElementById('dash-start-date').value;
    const e = document.getElementById('dash-end-date').value;
    if (!s || !e) return Utils.toast('Please select both start and end dates', 'warning');

    this.filterState.start = s;
    this.filterState.end = e;
    this.filterState.label = 'Custom Range';

    document.getElementById('dash-date-label').textContent = `${s} to ${e}`;
    this.loadAll();
  },

  async loadAll() {
    if (this.isLoading) return;
    this.isLoading = true;

    Utils.toast('Updating dashboard...', 'info');
    document.getElementById('stat-revenue').innerHTML = '<span class="spinner-sm"></span>';

    const { start, end, label } = this.filterState;
    const q = `?startDate=${start}&endDate=${end} 23:59:59`;

    // Update Headers
    const lbl = label === 'Today' ? '(Today)' : (label === 'Yesterday' ? '(Yesterday)' : '');
    document.getElementById('lbl-revenue').textContent = lbl || `(${start} - ${end})`;
    document.getElementById('revenue-date').textContent = label;

    // Fire all requests in parallel
    const [summary, revenue, profit, production, lowStock, topServices, svr, aiInsights, aiFraud, charts, lineRemovalAlerts] = await Promise.allSettled([
      API.get(`/reports/summary${q}`),
      API.get(`/reports/daily-revenue${q}`),
      API.get(`/reports/daily-profit${q}`),
      API.get('/reports/production-status'),
      API.get('/reports/low-stock'),
      API.get(`/reports/top-services${q}`),
      API.get(`/reports/service-vs-retail${q}`),
      API.get('/ai/insights'),
      API.get('/ai/fraud-alerts'),
      API.get('/reports/dashboard-charts'),
      API.get('/reports/line-removal-alerts')
    ]);

    this.data = {
      summary: summary.status === 'fulfilled' ? summary.value : null,
      revenue: revenue.status === 'fulfilled' ? revenue.value : null,
      profit: profit.status === 'fulfilled' ? profit.value : null,
      production: production.status === 'fulfilled' ? production.value : null,
      lowStock: lowStock.status === 'fulfilled' ? lowStock.value : null,
      topServices: topServices.status === 'fulfilled' ? topServices.value : null,
      svr: svr.status === 'fulfilled' ? svr.value : null,
      aiInsights: aiInsights.status === 'fulfilled' ? aiInsights.value : null,
      aiFraud: aiFraud.status === 'fulfilled' ? aiFraud.value : null,
      charts: charts.status === 'fulfilled' ? charts.value : null,
      lineRemovalAlerts: lineRemovalAlerts.status === 'fulfilled' ? lineRemovalAlerts.value : null
    };

    // Render charts (kept separate so a chart-render error never blocks the rest)
    if (this.data.charts) { try { this.renderCharts(this.data.charts); } catch (e) { console.error('Chart render failed:', e); } }

    this.isLoading = false;

    // Render AI First
    this.renderAI();

    // 1. KPI Cards
    if (this.data.summary) {
      const s = this.data.summary;
      // Updated: salesSummary now returns 'sales' instead of 'today_sales'
      const sales = s.sales || s.today_sales || { total: 0, count: 0 };
      const totalRevenue = sales.total || 0;
      const totalTxns = sales.count || 0;

      document.getElementById('stat-revenue').textContent = Utils.currency(totalRevenue);
      document.getElementById('stat-transactions').textContent = `${totalTxns} transactions`;
      document.getElementById('stat-low-stock').textContent = s.low_stock_items;
      document.getElementById('stat-jobs').textContent = s.pending_jobs;
    }

    // 2. Net Profit KPI
    if (this.data.profit) {
      const p = this.data.profit;
      const netProfit = parseFloat(p.net_profit) || 0;
      const el = document.getElementById('stat-profit');
      el.textContent = Utils.currency(netProfit);
      el.classList.add(netProfit >= 0 ? 'text-safe' : 'text-danger');
      document.getElementById('stat-expenses').textContent = `Expenses: ${Utils.currency(p.total_costs || 0)}`;
    }

    // 3. Revenue Reconciliation Table
    if (this.data.revenue) {
      this.renderRevenueReconciliation(this.data.revenue);
    }

    // 4. Production Heat Map
    if (this.data.production) {
      this.renderProductionHeatmap(this.data.production);
    } else {
      document.getElementById('production-heatmap').innerHTML = '<p class="text-muted text-center" data-style="padding:1rem;">No job card data available</p>';
    }

    // 5. Service vs Retail
    if (this.data.svr) {
      this.renderServiceVsRetail(this.data.svr);
    }

    // 6. Top Services
    if (this.data.topServices) {
      this.renderTopServices(this.data.topServices);
    }

    // 7. Low Stock Alerts
    if (this.data.lowStock) {
      this.renderLowStock(this.data.lowStock);
    }

    // 8. Line Removal Outliers (Task #61)
    this.renderLineRemovalAlerts(this.data.lineRemovalAlerts);
  },

  /**
   * Task #61 — Render the "cashiers removing an unusual number of
   * lines" tile. Each row is clickable and deep-links into the
   * Reports → Line Removals tab pre-filtered to that staff member.
   *
   * All DB-derived strings (staff_name) flow through Utils.escapeHtml
   * before being interpolated into innerHTML to keep this XSS-safe.
   */
  renderLineRemovalAlerts(data) {
    const container = document.getElementById('line-removal-alerts');
    const countEl   = document.getElementById('line-removal-alert-count');
    if (!container) return;

    if (!data) {
      if (countEl) {
        countEl.textContent = 'Unavailable';
        countEl.className   = 'badge badge-neutral';
      }
      container.innerHTML = `
        <div class="text-muted text-xs text-center p-4">
          Could not load line-removal outlier alerts.
        </div>`;
      return;
    }

    const alerts = Array.isArray(data.alerts) ? data.alerts : [];
    if (countEl) {
      countEl.textContent = alerts.length === 1 ? '1 Cashier' : `${alerts.length} Cashiers`;
      countEl.className   = `badge ${alerts.length > 0 ? 'bg-amber-100 text-amber-700' : 'badge-neutral'}`;
    }

    if (!alerts.length) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center p-4 text-center">
          <i class="fas fa-check-circle text-safe text-2xl mb-2"></i>
          <div class="text-sm font-bold text-safe">No outliers detected</div>
          <div class="text-xs text-muted">All cashiers are within their usual line-removal range.</div>
        </div>`;
      return;
    }

    const esc = (v) => (typeof Utils !== 'undefined' && Utils.escapeHtml)
      ? Utils.escapeHtml(v == null ? '' : String(v))
      : String(v == null ? '' : v).replace(/[&<>"']/g, c =>
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    container.innerHTML = `
      <div class="text-xs text-muted mb-3">
        Cashiers whose line-removals in the last
        ${esc(data.window?.hours || 24)}h are
        ≥ ${esc(data.thresholds?.multiplier || 3)}× their
        ${esc(data.window?.baselineDays || 30)}-day average
        (floor: ${esc(data.thresholds?.floor || 5)} lines).
      </div>
      <div class="space-y-2">
        ${alerts.map(a => {
          const sev = a.severity === 'high' ? 'bg-red-50 border-red-500 text-red-700'
                                            : 'bg-amber-50 border-amber-500 text-amber-700';
          const mult = a.multiple == null
            ? 'no prior baseline'
            : `${esc(a.multiple)}× usual`;
          const refunded = (typeof Utils !== 'undefined' && Utils.currency)
            ? Utils.currency(a.current_refunded || 0)
            : `K${Number(a.current_refunded || 0).toFixed(2)}`;
          return `
            <div class="flex justify-between items-center p-3 rounded border-l-4 ${sev} clickable"
                 data-on-click="Dashboard.openLineRemovalsFor('${esc(a.staff_id)}')">
              <div class="text-xs">
                <div class="font-bold">${esc(a.staff_name)}</div>
                <div class="text-secondary">
                  ${esc(a.current_count)} lines removed · ${refunded} refunded
                </div>
              </div>
              <div class="text-right text-xs">
                <div class="font-bold">${mult}</div>
                <div class="text-muted">baseline: ${esc(a.baseline_daily_avg)}/day</div>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  },

  /**
   * Deep-link to Reports → Line Removals, pre-filtered to a cashier.
   * ReportsAdv reads window.__lrDeepLink on render (see reports_adv.js).
   */
  openLineRemovalsFor(staffId) {
    window.__lrDeepLink = { staffId: staffId || '', tab: 'line-removals' };
    window.location.hash = '#/reports';
  },

  // ── Widget 1: Revenue Reconciliation ──
  renderRevenueReconciliation(data) {
    const el = document.getElementById('revenue-breakdown');
    document.getElementById('revenue-date').textContent = data.date;

    if (data.by_payment_method.length === 0) {
      el.innerHTML = '<div class="empty-widget"><span>💵</span><p>No sales recorded today yet</p></div>';
      return;
    }

    const totalRev = parseFloat(data.totals.gross_revenue) || 1;

    el.innerHTML = `
      <div class="reconciliation-bars">
        ${data.by_payment_method.map(r => {
      const pct = Math.round((parseFloat(r.gross_revenue) / totalRev) * 100);
      const icon = r.payment_method === 'Cash' ? '💵' : (r.payment_method === 'Mobile Money' ? '📱' : '💳');
      return `
            <div class="recon-row clickable" data-on-click="Dashboard.showDrillDown('revenue_method', '${r.payment_method}')">
              <div class="recon-label">
                <span class="recon-icon">${icon}</span>
                <span>${r.payment_method}</span>
                <span class="recon-txn">${r.total_transactions} txn</span>
              </div>
              <div class="recon-bar-track">
                <div class="recon-bar-fill" data-style="width:${pct}%"></div>
              </div>
              <div class="recon-amount">${Utils.currency(r.gross_revenue)}</div>
            </div>`;
    }).join('')}
      </div>
      <div class="recon-total">
        <span>TOTAL</span>
        <span>${data.totals.total_transactions} transactions</span>
        <span class="recon-total-amount">${Utils.currency(data.totals.gross_revenue)}</span>
      </div>
    `;
  },

  // ── Widget 2: Production Heat Map ──
  renderProductionHeatmap(data) {
    const el = document.getElementById('production-heatmap');
    const totalJobs = data.statuses.reduce((sum, s) => sum + parseInt(s.number_of_jobs), 0);
    document.getElementById('job-count').textContent = `${totalJobs} active`;

    if (data.statuses.length === 0) {
      el.innerHTML = '<div class="empty-widget"><span>✅</span><p>No active jobs — production is clear</p></div>';
      return;
    }

    const statusColors = {
      'Pending': { bg: '#fef3c7', color: '#92400e', icon: '⏳' },
      'Designing': { bg: '#dbeafe', color: '#1e40af', icon: '🎨' },
      'Printing': { bg: '#ede9fe', color: '#5b21b6', icon: '🖨️' },
      'Completed': { bg: '#d1fae5', color: '#065f46', icon: '✅' }
    };

    el.innerHTML = `
      <div class="heatmap-grid">
        ${data.statuses.map(s => {
      const style = statusColors[s.status] || { bg: '#f1f5f9', color: '#475569', icon: '📋' };
      const deadlineStr = s.earliest_deadline ? `Due: ${new Date(s.earliest_deadline).toLocaleDateString()}` : 'No deadline';
      return `
            <div class="heatmap-tile clickable" data-on-click="Dashboard.showDrillDown('jobs_status', '${s.status}')" data-style="background:${style.bg};color:${style.color};">
              <div class="heatmap-icon">${style.icon}</div>
              <div class="heatmap-count">${s.number_of_jobs}</div>
              <div class="heatmap-label">${s.status}</div>
              <div class="heatmap-deadline">${deadlineStr}</div>
            </div>`;
    }).join('')}
      </div>
    `;
  },

  // ── Widget 3: Service vs Retail ──
  renderServiceVsRetail(data) {
    const el = document.getElementById('service-vs-retail');

    if (data.total_revenue === 0) {
      el.innerHTML = '<div class="empty-widget"><span>📊</span><p>No sales data in the last 30 days</p></div>';
      return;
    }

    el.innerHTML = `
      <div class="svr-container">
        <div class="svr-bar-track">
          <div class="svr-bar-retail" data-style="width:${data.retail.pct}%" title="Retail: ${data.retail.pct}%">
            ${data.retail.pct > 10 ? `${data.retail.pct}%` : ''}
          </div>
          <div class="svr-bar-service" data-style="width:${data.service.pct}%" title="Services: ${data.service.pct}%">
            ${data.service.pct > 10 ? `${data.service.pct}%` : ''}
          </div>
        </div>
        <div class="svr-details">
          <div class="svr-detail clickable" data-on-click="Dashboard.showDrillDown('sales_type', 'retail')">
            <div class="svr-dot" data-style="background:#1B3A5C;"></div>
            <div>
              <div class="svr-type">Retail (Products)</div>
              <div class="svr-val">${Utils.currency(data.retail.revenue)} <span class="text-muted">• ${data.retail.orders} orders</span></div>
            </div>
          </div>
          <div class="svr-detail clickable" data-on-click="Dashboard.showDrillDown('sales_type', 'service')">
            <div class="svr-dot" data-style="background:#1DAA6E;"></div>
            <div>
              <div class="svr-type">Services</div>
              <div class="svr-val">${Utils.currency(data.service.revenue)} <span class="text-muted">• ${data.service.orders} orders</span></div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  // ── Charts (ApexCharts) ──
  // Persist chart instances so we update in-place rather than re-creating
  // the SVGs every refresh (prevents flicker + leaks).
  _charts: {},

  renderCharts(d) {
    if (typeof ApexCharts === 'undefined') return;
    const fmt = (n) => Utils.currency ? Utils.currency(n) : `${(Number(n)||0).toFixed(2)}`;

    // 1. 14-day sales trend (area chart)
    const trend = d.sales_trend || [];
    const trendCategories = trend.map(r => {
      const dt = new Date(r.day);
      return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    });
    const trendSeries = [{ name: 'Revenue', data: trend.map(r => Math.round(Number(r.revenue) * 100) / 100) }];
    const trendTotal = trend.reduce((s, r) => s + Number(r.revenue || 0), 0);
    const trendBadge = document.getElementById('chart-trend-total');
    if (trendBadge) trendBadge.textContent = fmt(trendTotal);

    const trendOpts = {
      chart: { type: 'area', height: 240, toolbar: { show: false }, animations: { enabled: true, dynamicAnimation: { enabled: true } }, sparkline: { enabled: false } },
      series: trendSeries,
      xaxis: { categories: trendCategories, labels: { style: { fontSize: '11px' } } },
      yaxis: { labels: { formatter: (v) => fmt(v), style: { fontSize: '11px' } } },
      stroke: { curve: 'smooth', width: 2 },
      colors: ['#1B3A5C'],
      fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.5, opacityTo: 0.05 } },
      dataLabels: { enabled: false },
      tooltip: { y: { formatter: (v) => fmt(v) } },
      grid: { borderColor: '#f1f5f9' }
    };

    if (this._charts.trend) {
      this._charts.trend.updateOptions(trendOpts, false, true);
    } else {
      const el = document.getElementById('chart-sales-trend');
      if (el) { this._charts.trend = new ApexCharts(el, trendOpts); this._charts.trend.render(); }
    }

    // 2. Top 5 products (horizontal bar)
    const top = d.top_products || [];
    const topBadge = document.getElementById('chart-top-count');
    if (topBadge) topBadge.textContent = `${top.length} item${top.length === 1 ? '' : 's'}`;
    const topOpts = {
      chart: { type: 'bar', height: 240, toolbar: { show: false } },
      series: [{ name: 'Revenue', data: top.map(r => Math.round(Number(r.revenue) * 100) / 100) }],
      xaxis: { categories: top.map(r => r.name), labels: { formatter: (v) => fmt(v), style: { fontSize: '11px' } } },
      yaxis: { labels: { style: { fontSize: '11px' } } },
      plotOptions: { bar: { horizontal: true, borderRadius: 4, dataLabels: { position: 'top' } } },
      dataLabels: { enabled: true, formatter: (v) => fmt(v), style: { fontSize: '10px' }, offsetX: 30 },
      colors: ['#1DAA6E'],
      tooltip: { y: { formatter: (v) => fmt(v) } },
      grid: { borderColor: '#f1f5f9' }
    };
    if (top.length === 0) {
      const el = document.getElementById('chart-top-products');
      if (el) el.innerHTML = '<div class="empty-widget"><span>📭</span><p>No product sales yet in the last 30 days.</p></div>';
    } else if (this._charts.top) {
      this._charts.top.updateOptions(topOpts, false, true);
    } else {
      const el = document.getElementById('chart-top-products');
      if (el) { this._charts.top = new ApexCharts(el, topOpts); this._charts.top.render(); }
    }

    // 3. Payment method donut
    const mix = d.payment_mix || [];
    const mixOpts = {
      chart: { type: 'donut', height: 280 },
      series: mix.map(r => Math.round(Number(r.revenue) * 100) / 100),
      labels: mix.map(r => (r.method || 'Other').charAt(0).toUpperCase() + (r.method || 'Other').slice(1)),
      colors: ['#1B3A5C', '#1DAA6E', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16'],
      legend: { position: 'bottom' },
      dataLabels: { enabled: true, formatter: (v) => `${Math.round(v)}%` },
      tooltip: { y: { formatter: (v) => fmt(v) } },
      plotOptions: { pie: { donut: { size: '60%', labels: { show: true, total: { show: true, label: 'Total', formatter: () => fmt(mix.reduce((s, r) => s + Number(r.revenue || 0), 0)) } } } } }
    };
    if (mix.length === 0) {
      const el = document.getElementById('chart-payment-mix');
      if (el) el.innerHTML = '<div class="empty-widget"><span>💳</span><p>No payment data yet.</p></div>';
    } else if (this._charts.mix) {
      this._charts.mix.updateOptions(mixOpts, false, true);
    } else {
      const el = document.getElementById('chart-payment-mix');
      if (el) { this._charts.mix = new ApexCharts(el, mixOpts); this._charts.mix.render(); }
    }
  },

  // ── Widget 4: Top Services ──
  renderTopServices(data) {
    const el = document.getElementById('top-services-list');

    if (!data.services || data.services.length === 0) {
      el.innerHTML = '<div class="empty-widget"><span>🏆</span><p>No service sales in the last 30 days</p></div>';
      return;
    }

    const maxRev = Math.max(...data.services.map(s => parseFloat(s.total_revenue)));

    el.innerHTML = data.services.slice(0, 6).map((s, i) => {
      const pct = Math.round((parseFloat(s.total_revenue) / maxRev) * 100);
      const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : ''));
      return `
        <div class="top-svc-row clickable" data-on-click="Utils.toast('Feature coming soon: Service details', 'info')">
          <span class="top-svc-rank">${medal || (i + 1)}</span>
          <div class="top-svc-info">
            <div class="top-svc-name">${s.service_name}</div>
            <div class="top-svc-bar-track">
              <div class="top-svc-bar-fill" data-style="width:${pct}%"></div>
            </div>
          </div>
          <div class="top-svc-stats">
            <div class="top-svc-rev">${Utils.currency(s.total_revenue)}</div>
            <div class="top-svc-orders">${s.total_orders} orders</div>
          </div>
        </div>`;
    }).join('');
  },

  // ── Widget 5: Low Stock ──
  renderLowStock(data) {
    const el = document.getElementById('low-stock-list');
    document.getElementById('stock-alert-count').textContent = data.count;

    if (data.count === 0) {
      el.innerHTML = '<div class="empty-widget"><span>✅</span><p>All items are well stocked!</p></div>';
      return;
    }

    el.innerHTML = `
      <div class="stock-grid">
        ${data.alerts.slice(0, 12).map(item => {
      const urgency = item.stock_quantity === 0 ? 'critical' : (item.shortage >= 5 ? 'high' : 'medium');
      const urgencyLabel = item.stock_quantity === 0 ? 'OUT OF STOCK' : `${item.stock_quantity} left`;
      // Escape product name for safe use in onclick attribute
      const safeName = item.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
      return `
            <div class="stock-alert-card stock-${urgency} clickable"
                 title="Click to view in Inventory"
                 data-on-click="Inventory.openWithSearch('${safeName}')">
              <div class="stock-alert-header">
                <span class="stock-alert-name">${item.name}</span>
                <span class="stock-alert-badge stock-badge-${urgency}">${urgencyLabel}</span>
              </div>
              <div class="stock-alert-meta">
                <span>${item.category || 'General'}</span>
                <span>Reorder at: ${item.reorder_level}</span>
              </div>
            </div>`;
    }).join('')}
      </div>
    `;
  },

  renderAI() {
    const { aiInsights, aiFraud } = this.data;
    const insightsContainer = document.getElementById('ai-insights-container');
    const fraudContainer = document.getElementById('ai-fraud-container');

    if (aiInsights && insightsContainer) {
      const { sales_trend, stock_alerts, summary } = aiInsights;
      const trendColor = sales_trend.growth_pct >= 0 ? 'text-teal-600' : 'text-red-600';
      const trendIcon = sales_trend.growth_pct >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';

      insightsContainer.innerHTML = `
                <div class="mb-4">
                    <div class="text-xs text-muted uppercase font-bold mb-1">Sales Performance</div>
                    <div class="flex items-center gap-2">
                        <span class="text-2xl font-bold ${trendColor}">${Math.abs(Math.round(sales_trend.growth_pct))}%</span>
                        <i class="fas ${trendIcon} ${trendColor}"></i>
                        <span class="text-sm text-secondary">${summary}</span>
                    </div>
                </div>
                <div>
                    <div class="text-xs text-muted uppercase font-bold mb-2">Inventory Risk (Days of Coverage)</div>
                    <div class="space-y-2">
                        ${stock_alerts.length ? stock_alerts.map(s => `
                            <div class="flex justify-between items-center text-sm p-2 bg-gray-50 rounded">
                                <span class="font-medium">${s.name}</span>
                                <span class="badge ${s.days_left < 3 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}">
                                    ${Math.round(s.days_left)} days left
                                </span>
                            </div>
                        `).join('') : '<div class="text-xs text-secondary italic">No immediate inventory risks detected.</div>'}
                    </div>
                </div>
            `;
    }

    if (aiFraud && fraudContainer) {
      const { alerts } = aiFraud;
      const countEl = document.getElementById('fraud-alert-count');
      if (countEl) {
        countEl.textContent = `${alerts.length} Alerts`;
        countEl.className = `badge ${alerts.length > 0 ? 'bg-red-100 text-red-700' : 'badge-neutral'}`;
      }

      if (!alerts.length) {
        fraudContainer.innerHTML = `
                    <div class="flex flex-col items-center justify-center p-6 text-center">
                        <i class="fas fa-check-circle text-safe text-3xl mb-2"></i>
                        <div class="text-sm font-bold text-safe">System Secure</div>
                        <div class="text-xs text-muted">No suspicious patterns detected in the last 24h.</div>
                    </div>
                `;
      } else {
        fraudContainer.innerHTML = `
                    <div class="space-y-3">
                        ${alerts.map(a => `
                            <div class="flex gap-3 p-3 rounded border-l-4 ${a.severity === 'high' ? 'bg-red-50 border-red-500' : 'bg-orange-50 border-orange-500'}">
                                <i class="fas ${a.type === 'AFTER_HOURS' ? 'fa-clock' : 'fa-exclamation-triangle'} ${a.severity === 'high' ? 'text-red-600' : 'text-orange-600'} mt-1"></i>
                                <div class="text-xs">
                                    <div class="font-bold uppercase">${a.type.replace('_', ' ')}</div>
                                    <div class="text-secondary">${a.message}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
      }
    }
  },

  async askAI(e) {
    e.preventDefault();
    const input = document.getElementById('ask-ai-input');
    const btn = document.getElementById('ask-ai-submit');
    const out = document.getElementById('ask-ai-result');
    const question = (input?.value || '').trim();
    if (!question) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Thinking…';
    out.innerHTML = '<div class="text-muted text-sm p-3 bg-gray-50 rounded">Analysing your sales data…</div>';

    try {
      const result = await API.post('/ai/ask', { question });
      const rows = Array.isArray(result.rows) ? result.rows : [];

      // Build the result DOM safely — no innerHTML interpolation of DB values.
      out.innerHTML = '';

      const answerCard = document.createElement('div');
      answerCard.className = 'bg-purple-50 border-l-4 border-purple-500 p-3 rounded';
      const answerLabel = document.createElement('div');
      answerLabel.className = 'text-xs font-bold text-purple-700 uppercase mb-1';
      answerLabel.textContent = 'Answer';
      const answerBody = document.createElement('div');
      answerBody.className = 'text-sm';
      answerBody.textContent = result.answer || '';
      answerCard.appendChild(answerLabel);
      answerCard.appendChild(answerBody);
      out.appendChild(answerCard);

      if (rows.length) {
        const cols = Object.keys(rows[0]);
        const wrap = document.createElement('div');
        wrap.className = 'overflow-x-auto mt-3 border rounded';
        const table = document.createElement('table');
        table.className = 'data-table';
        table.setAttribute('data-style', 'margin:0;');
        const thead = document.createElement('thead');
        const trh = document.createElement('tr');
        cols.forEach(c => {
          const th = document.createElement('th');
          th.textContent = c.replace(/_/g, ' ');
          trh.appendChild(th);
        });
        thead.appendChild(trh);
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        rows.slice(0, 50).forEach(r => {
          const tr = document.createElement('tr');
          cols.forEach(c => {
            const v = r[c];
            const s = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
            const td = document.createElement('td');
            td.textContent = s.length > 80 ? s.slice(0, 80) + '…' : s;
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        out.appendChild(wrap);
        if (rows.length > 50) {
          const note = document.createElement('div');
          note.className = 'text-xs text-muted mt-1';
          note.textContent = `Showing first 50 of ${rows.length} rows.`;
          out.appendChild(note);
        }
      } else {
        const empty = document.createElement('div');
        empty.className = 'text-xs text-muted mt-2';
        empty.textContent = 'No matching rows.';
        out.appendChild(empty);
      }

      const det = document.createElement('details');
      det.className = 'mt-2';
      const sum = document.createElement('summary');
      sum.className = 'text-xs text-muted cursor-pointer';
      sum.textContent = 'View generated SQL';
      const pre = document.createElement('pre');
      pre.className = 'text-xs bg-gray-50 p-2 rounded overflow-x-auto mt-1';
      const code = document.createElement('code');
      code.textContent = result.sql || '';
      pre.appendChild(code);
      det.appendChild(sum);
      det.appendChild(pre);
      out.appendChild(det);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'AI query failed';
      out.innerHTML = `<div class="bg-red-50 border-l-4 border-red-500 p-3 rounded text-sm text-red-700">${msg}</div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> Ask';
    }
  },

  async showDrillDown(type, filterId) {
    Utils.toast('Loading details...', 'info');

    try {
      if (type === 'revenue' || type === 'revenue_method') {
        const { start, end } = this.filterState;
        let url = `/reports/sales?startDate=${start}&endDate=${end} 23:59:59`;

        if (type === 'revenue_method' && filterId) {
          url += `&payment_method=${encodeURIComponent(filterId)}`;
        }

        const transactions = await API.get(url);

        if (!transactions || transactions.length === 0) {
          Utils.showModal(`
            <div class="modal-header"><h3>💰 Revenue Details</h3><button class="modal-close" data-on-click="Utils.closeModal()">✕</button></div>
            <div class="modal-body"><div class="empty-state"><p>No transactions found for today.</p></div></div>
            `);
          return;
        }

        const total = transactions.reduce((sum, t) => sum + parseFloat(t.total_amount), 0);

        const rows = transactions.map(t => `
            <tr>
                <td>${t.sale_number}</td>
                <td>${new Date(t.transaction_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                <td>${t.payment_method}</td>
                <td>${t.payment_reference || '-'}</td>
                <td class="text-right">${Utils.currency(t.total_amount)}</td>
            </tr>
        `).join('');

        Utils.showModal(`
            <div class="modal-header">
                <h3>💰 Revenue Details ${filterId ? `(${filterId})` : ''}</h3>
                <button class="modal-close" data-on-click="Utils.closeModal()">✕</button>
            </div>
            <div class="modal-body" data-style="padding:0;">
                <div class="table-container" data-style="max-height:400px;overflow-y:auto;">
                    <table class="table w-full">
                        <thead>
                            <tr data-style="position:sticky;top:0;background:var(--bg-card);z-index:1;">
                                <th>Ref #</th>
                                <th>Time</th>
                                <th>Method</th>
                                <th>Reference</th>
                                <th class="text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                        <tfoot>
                            <tr class="font-bold" data-style="background:var(--bg-primary);">
                                <td colspan="4" class="text-right">Total</td>
                                <td class="text-right">${Utils.currency(total)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        `);

      } else if (type === 'jobs' || type === 'jobs_status') {
        // Redirect to Jobs page with filter? Or show modal.
        window.location.hash = '#/jobs';
        // If we could pass filter... maybe save to localStorage?
        if (filterId) localStorage.setItem('jobs_filter_status', filterId);
        Utils.toast('Redirecting to Jobs board...', 'info');

      } else if (type === 'low_stock' || type === 'stock_item') {
        window.location.hash = '#/inventory';
        Utils.toast('Redirecting to Inventory...', 'info');

      } else if (type === 'sales_type') {
        // Re-use the revenue logic with item type
        const { start, end } = this.filterState;

        const filterLabel = filterId === 'service' ? 'Service Revenue' : 'Retail Sales';
        const url = `/reports/sales?startDate=${start}&endDate=${end} 23:59:59&sales_type=${filterId}`;

        Utils.toast(`Loading ${filterLabel}...`, 'info');

        // Reuse the drill-down logic by calling recursively or just copying the block? 
        // Copying for now to avoid complexity of refactoring showDrillDown signature
        const transactions = await API.get(url);

        if (!transactions || transactions.length === 0) {
          Utils.showModal(`
                 <div class="modal-header"><h3>Details: ${filterLabel}</h3><button class="modal-close" data-on-click="Utils.closeModal()">✕</button></div>
                 <div class="modal-body"><div class="empty-state"><p>No transactions found.</p></div></div>
             `);
          return;
        }

        const total = transactions.reduce((sum, t) => sum + parseFloat(t.total_amount), 0); // Note: total_amount is sale total, not just service items. 
        // If we filter by item_type in query, we might get duplicate sales if a sale has both types?
        // Our query sets one row per sale. If we filter by item_type joining sale_items, it works.

        const rows = transactions.map(t => {
          const itemsHtml = t.items && t.items.length > 0
            ? `<ul data-style="margin:0;padding-left:1rem;font-size:0.85rem;">${t.items.map(i => `<li>${i.description} (${i.quantity}) - ${Utils.currency(i.line_total)}</li>`).join('')}</ul>`
            : '<span class="text-muted">-</span>';

          return `
            <tr>
                <td data-style="vertical-align:top;">
                    <div class="font-bold">${t.sale_number}</div>
                    <div class="text-sm text-secondary">${new Date(t.transaction_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </td>
                <td data-style="vertical-align:top;">${t.staff_name || 'Unknown'}</td>
                <td data-style="vertical-align:top;">${itemsHtml}</td>
                 <td class="text-right" data-style="vertical-align:top;font-weight:bold;">${Utils.currency(t.total_amount)}</td>
            </tr>
            `;
        }).join('');

        Utils.showModal(`
            <div class="modal-header">
                <h3>💰 ${filterLabel} (${this.filterState.label})</h3>
                <button class="modal-close" data-on-click="Utils.closeModal()">✕</button>
            </div>
             <div class="modal-body" data-style="padding:0;">
                <div class="table-container" data-style="max-height:500px;overflow-y:auto;">
                    <table class="table w-full">
                        <thead>
                            <tr data-style="position:sticky;top:0;background:var(--bg-card);z-index:1;">
                                <th data-style="width:20%">Ref / Time</th>
                                <th data-style="width:20%">Staff</th>
                                <th data-style="width:40%">Items</th>
                                <th class="text-right" data-style="width:20%">Total</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                         <tfoot>
                            <tr class="font-bold" data-style="background:var(--bg-primary);">
                                <td colspan="3" class="text-right">Total</td>
                                <td class="text-right">${Utils.currency(total)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
         `);

      } else if (type === 'profit') {
        const p = this.data.profit;
        Utils.showModal(`
                <div class="modal-header"><h3>📈 Profit Breakdown (${this.filterState.label})</h3><button class="modal-close" data-on-click="Utils.closeModal()">✕</button></div>
                <div class="modal-body">
                    <table class="table w-full">
                        <tr><td>Gross Revenue</td><td class="text-right text-success">${Utils.currency(parseFloat(p.gross_revenue))}</td></tr>
                        <tr><td>Cost of Goods Sold</td><td class="text-right text-danger">-${Utils.currency(parseFloat(p.cogs))}</td></tr>
                        <tr><td><strong>Gross Profit</strong></td><td class="text-right font-bold">${Utils.currency(parseFloat(p.gross_profit))}</td></tr>
                        <tr><td colspan="2"><hr class="my-2"></td></tr>
                        <tr><td>Operating Expenses</td><td class="text-right text-danger">-${Utils.currency(parseFloat(p.operating_expenses || 0))}</td></tr>
                        <tr><td colspan="2"><hr class="my-2"></td></tr>
                        <tr><td class="font-bold text-lg">Net Profit</td><td class="text-right font-bold text-lg ${p.net_profit >= 0 ? 'text-success' : 'text-danger'}">${Utils.currency(parseFloat(p.net_profit))}</td></tr>
                    </table>
                </div>
            `);
      }
    } catch (err) {
      Utils.toast('Could not load details', 'error');
    }
  }
};

// Expose to global scope for delegated event handlers (data-on-* attributes).
window.Dashboard = Dashboard;
