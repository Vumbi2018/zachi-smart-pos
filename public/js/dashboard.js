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
              <select id="dash-range-select" class="p-1 text-sm border-none bg-transparent font-medium text-gray-700 focus:ring-0" onchange="Dashboard.handleRangeChange(this.value)">
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
                <button class="btn btn-xs btn-primary" onclick="Dashboard.applyCustomDate()">Go</button>
              </div>
           </div>
           <span class="text-muted" style="font-size:0.82rem;" id="dash-date-label">${dateStr}</span>
        </div>
      </div>

      <!-- ── Row 1: KPI Summary Cards ── -->
      <div class="stats-grid" id="stats-grid">
        <div class="stat-card stat-gradient-revenue clickable" onclick="Dashboard.showDrillDown('revenue')">
          <div class="stat-icon-wrap"><span class="stat-icon-emoji">💰</span></div>
          <div class="stat-body">
            <div class="stat-label">Revenue <span class="text-xs opacity-75 font-normal" id="lbl-revenue">(Today)</span></div>
            <div class="stat-value" id="stat-revenue">—</div>
            <div class="stat-sub" id="stat-transactions">Loading...</div>
          </div>
        </div>
        <div class="stat-card stat-gradient-profit clickable" onclick="Dashboard.showDrillDown('profit')">
          <div class="stat-icon-wrap"><span class="stat-icon-emoji">📈</span></div>
          <div class="stat-body">
            <div class="stat-label">Net Profit</div>
            <div class="stat-value" id="stat-profit">—</div>
            <div class="stat-sub" id="stat-expenses">Loading...</div>
          </div>
        </div>
        <div class="stat-card stat-gradient-stock clickable" onclick="Dashboard.showDrillDown('low_stock')">
          <div class="stat-icon-wrap"><span class="stat-icon-emoji">⚠️</span></div>
          <div class="stat-body">
            <div class="stat-label">Low Stock</div>
            <div class="stat-value" id="stat-low-stock">—</div>
            <div class="stat-sub">Items need reorder</div>
          </div>
        </div>
        <div class="stat-card stat-gradient-jobs clickable" onclick="Dashboard.showDrillDown('jobs')">
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

      <!-- ── Row 2: Revenue Reconciliation + Production Heat Map ── -->
      <div class="dash-grid-2">
        <div class="card dash-card">
          <div class="card-header">
            <span class="card-title">💵 Revenue Reconciliation</span>
            <span class="badge badge-info" id="revenue-date">Today</span>
          </div>
          <div id="revenue-breakdown" class="dash-card-body">
            <p class="text-muted text-center" style="padding:1.5rem;">Loading...</p>
          </div>
        </div>

        <div class="card dash-card">
          <div class="card-header">
            <span class="card-title">🔥 Production Heat Map</span>
            <span class="badge badge-warning" id="job-count">—</span>
          </div>
          <div id="production-heatmap" class="dash-card-body">
            <p class="text-muted text-center" style="padding:1.5rem;">Loading...</p>
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
            <p class="text-muted text-center" style="padding:1.5rem;">Loading...</p>
          </div>
        </div>

        <div class="card dash-card">
          <div class="card-header">
            <span class="card-title">🏆 Top Services</span>
          </div>
          <div id="top-services-list" class="dash-card-body">
            <p class="text-muted text-center" style="padding:1.5rem;">Loading...</p>
          </div>
        </div>
      </div>

      <!-- ── Row 4: Low Stock Alerts ── -->
      <div class="card dash-card" style="margin-top:1rem;">
        <div class="card-header">
          <span class="card-title">📦 Smart Stock Alerts</span>
          <span class="badge badge-danger" id="stock-alert-count">—</span>
        </div>
        <div id="low-stock-list" class="dash-card-body">
          <p class="text-muted text-center" style="padding:1.5rem;">Loading...</p>
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
    const [summary, revenue, profit, production, lowStock, topServices, svr, aiInsights, aiFraud] = await Promise.allSettled([
      API.get(`/reports/summary${q}`),
      API.get(`/reports/daily-revenue${q}`),
      API.get(`/reports/daily-profit${q}`),
      API.get('/reports/production-status'),
      API.get('/reports/low-stock'),
      API.get(`/reports/top-services${q}`),
      API.get(`/reports/service-vs-retail${q}`),
      API.get('/ai/insights'),
      API.get('/ai/fraud-alerts')
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
      aiFraud: aiFraud.status === 'fulfilled' ? aiFraud.value : null
    };

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
      document.getElementById('production-heatmap').innerHTML = '<p class="text-muted text-center" style="padding:1rem;">No job card data available</p>';
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
            <div class="recon-row clickable" onclick="Dashboard.showDrillDown('revenue_method', '${r.payment_method}')">
              <div class="recon-label">
                <span class="recon-icon">${icon}</span>
                <span>${r.payment_method}</span>
                <span class="recon-txn">${r.total_transactions} txn</span>
              </div>
              <div class="recon-bar-track">
                <div class="recon-bar-fill" style="width:${pct}%"></div>
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
            <div class="heatmap-tile clickable" onclick="Dashboard.showDrillDown('jobs_status', '${s.status}')" style="background:${style.bg};color:${style.color};">
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
          <div class="svr-bar-retail" style="width:${data.retail.pct}%" title="Retail: ${data.retail.pct}%">
            ${data.retail.pct > 10 ? `${data.retail.pct}%` : ''}
          </div>
          <div class="svr-bar-service" style="width:${data.service.pct}%" title="Services: ${data.service.pct}%">
            ${data.service.pct > 10 ? `${data.service.pct}%` : ''}
          </div>
        </div>
        <div class="svr-details">
          <div class="svr-detail clickable" onclick="Dashboard.showDrillDown('sales_type', 'retail')">
            <div class="svr-dot" style="background:#1B3A5C;"></div>
            <div>
              <div class="svr-type">Retail (Products)</div>
              <div class="svr-val">${Utils.currency(data.retail.revenue)} <span class="text-muted">• ${data.retail.orders} orders</span></div>
            </div>
          </div>
          <div class="svr-detail clickable" onclick="Dashboard.showDrillDown('sales_type', 'service')">
            <div class="svr-dot" style="background:#1DAA6E;"></div>
            <div>
              <div class="svr-type">Services</div>
              <div class="svr-val">${Utils.currency(data.service.revenue)} <span class="text-muted">• ${data.service.orders} orders</span></div>
            </div>
          </div>
        </div>
      </div>
    `;
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
        <div class="top-svc-row clickable" onclick="Utils.toast('Feature coming soon: Service details', 'info')">
          <span class="top-svc-rank">${medal || (i + 1)}</span>
          <div class="top-svc-info">
            <div class="top-svc-name">${s.service_name}</div>
            <div class="top-svc-bar-track">
              <div class="top-svc-bar-fill" style="width:${pct}%"></div>
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
                 onclick="Inventory.pendingSearch='${safeName}'; window.location.hash='#/inventory';">
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
            <div class="modal-header"><h3>💰 Revenue Details</h3><button class="modal-close" onclick="Utils.closeModal()">✕</button></div>
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
                <button class="modal-close" onclick="Utils.closeModal()">✕</button>
            </div>
            <div class="modal-body" style="padding:0;">
                <div class="table-container" style="max-height:400px;overflow-y:auto;">
                    <table class="table w-full">
                        <thead>
                            <tr style="position:sticky;top:0;background:var(--bg-card);z-index:1;">
                                <th>Ref #</th>
                                <th>Time</th>
                                <th>Method</th>
                                <th>Reference</th>
                                <th class="text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                        <tfoot>
                            <tr class="font-bold" style="background:var(--bg-primary);">
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
                 <div class="modal-header"><h3>Details: ${filterLabel}</h3><button class="modal-close" onclick="Utils.closeModal()">✕</button></div>
                 <div class="modal-body"><div class="empty-state"><p>No transactions found.</p></div></div>
             `);
          return;
        }

        const total = transactions.reduce((sum, t) => sum + parseFloat(t.total_amount), 0); // Note: total_amount is sale total, not just service items. 
        // If we filter by item_type in query, we might get duplicate sales if a sale has both types?
        // Our query sets one row per sale. If we filter by item_type joining sale_items, it works.

        const rows = transactions.map(t => {
          const itemsHtml = t.items && t.items.length > 0
            ? `<ul style="margin:0;padding-left:1rem;font-size:0.85rem;">${t.items.map(i => `<li>${i.description} (${i.quantity}) - ${Utils.currency(i.line_total)}</li>`).join('')}</ul>`
            : '<span class="text-muted">-</span>';

          return `
            <tr>
                <td style="vertical-align:top;">
                    <div class="font-bold">${t.sale_number}</div>
                    <div class="text-sm text-secondary">${new Date(t.transaction_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </td>
                <td style="vertical-align:top;">${t.staff_name || 'Unknown'}</td>
                <td style="vertical-align:top;">${itemsHtml}</td>
                 <td class="text-right" style="vertical-align:top;font-weight:bold;">${Utils.currency(t.total_amount)}</td>
            </tr>
            `;
        }).join('');

        Utils.showModal(`
            <div class="modal-header">
                <h3>💰 ${filterLabel} (${this.filterState.label})</h3>
                <button class="modal-close" onclick="Utils.closeModal()">✕</button>
            </div>
             <div class="modal-body" style="padding:0;">
                <div class="table-container" style="max-height:500px;overflow-y:auto;">
                    <table class="table w-full">
                        <thead>
                            <tr style="position:sticky;top:0;background:var(--bg-card);z-index:1;">
                                <th style="width:20%">Ref / Time</th>
                                <th style="width:20%">Staff</th>
                                <th style="width:40%">Items</th>
                                <th class="text-right" style="width:20%">Total</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                         <tfoot>
                            <tr class="font-bold" style="background:var(--bg-primary);">
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
                <div class="modal-header"><h3>📈 Profit Breakdown (${this.filterState.label})</h3><button class="modal-close" onclick="Utils.closeModal()">✕</button></div>
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
