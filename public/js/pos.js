/**
 * Zachi Smart-POS - POS Terminal Module
 * The heart of the system: hybrid cart for products + services
 */

// Simple synthesized sound effects using AudioContext
const SoundManager = {
  ctx: null,

  init() {
    if (!this.ctx) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (AudioCtor) {
        this.ctx = new AudioCtor();
      } else {
        console.warn('Web Audio API not supported');
      }
    }
  },

  playTone(freq, type, duration) {
    this.init();
    if (!this.ctx) return; // Feature not supported
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(e => console.error(e));
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  },

  beep() { this.playTone(800, 'sine', 0.1); },
  error() { this.playTone(150, 'sawtooth', 0.3); },
  success() {
    this.playTone(600, 'sine', 0.1);
    setTimeout(() => this.playTone(1200, 'sine', 0.2), 100);
  },
  trash() { this.playTone(100, 'square', 0.15); },
  click() { this.playTone(400, 'sine', 0.05); }
};

const POS = {
  cart: [],
  products: [],
  services: [],
  activeTab: 'products',
  viewMode: 'grid', // 'grid' or 'list'
  selectedCategory: null,
  selectedPaymentMethod: null,
  paymentMethods: [],
  taxRate: 0.16,
  lastSale: null,
  pinnedItems: [], // IDs of pinned products/services

  async render(container) {
    this.cart = [];
    this.customer = null;
    this.taxEnabled = true;
    this.discountAmount = 0;
    this.redeemPoints = 0;

    // Inject enhanced styles
    const styleId = 'pos-enhanced-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.innerHTML = `
            @keyframes slideInRight { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            @keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.05); } 100% { transform: scale(1); } }
            @keyframes flash { 0% { background-color: rgba(34, 197, 94, 0.2); } 100% { background-color: transparent; } }
            @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }
            
            .cart-item-anim { animation: slideInRight 0.3s ease-out; }
            .cart-update-anim { animation: flash 0.5s ease-out; }
            .pos-item-card:active { transform: scale(0.95); transition: transform 0.1s; }
            
            /* Glassmorphism for Cart */
            .pos-cart {
                background: rgba(255, 255, 255, 0.95);
                backdrop-filter: blur(10px);
                border-left: 1px solid rgba(0,0,0,0.05);
                box-shadow: -4px 0 15px rgba(0,0,0,0.05);
            }

            .cart-empty-state {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100%;
                color: #94a3b8;
                text-align: center;
                animation: pulse 3s infinite ease-in-out;
            }
            .cart-empty-icon { font-size: 4rem; margin-bottom: 1rem; opacity: 0.5; }
            
            /* Shortcut hints */
            .shortcut-hint {
                font-size: 0.7rem;
                background: #e2e8f0;
                padding: 2px 5px;
                border-radius: 4px;
                margin-left: 5px;
                color: #64748b;
                vertical-align: middle;
            }
            
            .payment-method-btn { transition: all 0.2s; }
            .payment-method-btn:active { transform: scale(0.95); }

            /* Calculator Styles */
            .calc-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 10px; }
            .calc-btn { 
                padding: 15px; font-size: 1.2rem; border: none; border-radius: 8px; background: #f1f5f9; cursor: pointer; transition: background 0.2s;
            }
            .calc-btn:hover { background: #e2e8f0; }
            .calc-btn:active { background: #cbd5e1; }
            .calc-btn.operator { background: #e0f2fe; color: #0284c7; }
            .calc-btn.equal { background: #22c55e; color: white; grid-column: span 1; }
            .calc-btn.clear { background: #ef4444; color: white; }
            .calc-display {
                width: 100%; padding: 15px; font-size: 1.5rem; text-align: right; border: 1px solid #cbd5e1; border-radius: 8px; margin-bottom: 10px; background: #fff;
            }

            /* Shortcuts Table */
            .shortcuts-table { width: 100%; border-collapse: collapse; }
            .shortcuts-table td { padding: 8px; border-bottom: 1px solid #e2e8f0; }
            .shortcuts-table kbd { 
                background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 6px; font-size: 0.8rem; font-family: monospace;
            }
        `;
      document.head.appendChild(style);
    }

    container.innerHTML = `
      <div class="pos-layout">
        <div class="pos-main">
          <div class="pos-header">
            <div class="brand">
              <img src="/logo.jpg" alt="Logo" class="brand-logo">
              <div class="brand-text">
                <h1>Zachi POS</h1>
                <div class="status-indicators">
                  <span class="status-dot online" id="status-dot" title="Online"></span>
                  <span class="status-clock" id="clock">00:00</span>
                </div>
              </div>
            </div>
            
            <div class="search-bar">
              <i class="fas fa-search"></i>
              <input type="text" id="pos-search" placeholder="Search products... (F2)" autocomplete="off">
            </div>

            <div class="header-actions">
                <button class="btn btn-secondary" id="btn-scan-barcode" title="Scan Barcode"><i class="fas fa-barcode"></i></button>
                <button class="btn btn-secondary" id="btn-calculator" title="Calculator"><i class="fas fa-calculator"></i></button>
                <button class="btn btn-secondary" id="btn-shortcuts" title="Shortcuts"><i class="fas fa-keyboard"></i></button>
                <button class="btn btn-secondary" id="btn-currency" title="Currency"><i class="fas fa-exchange-alt"></i></button>
                <button class="btn btn-secondary" id="btn-sync" title="Sync"><i class="fas fa-sync-alt"></i></button>
                <button class="btn btn-secondary" id="btn-fullscreen" title="Fullscreen"><i class="fas fa-expand"></i></button>
            </div>
          </div>
          
          <div style="padding: 0 1rem 0.5rem 1rem; display:flex; justify-content:space-between; align-items:center;">
             <select id="pos-category-filter" style="width:auto; min-width:200px;">
              <option value="">All Categories</option>
            </select>
            <div class="pos-tabs">
                <button class="pos-tab active" data-tab="products" title="Alt+1">Products</button>
                <button class="pos-tab" data-tab="services" title="Alt+2">Services</button>
            </div>
          </div>

          <div class="pos-items-grid" id="pos-items-grid">
            <div class="loading text-center text-muted" style="grid-column:1/-1;padding:3rem;">Loading...</div>
          </div>
        </div>

        <div class="pos-cart">
          <!-- Customer Selection -->
          <div class="customer-section p-2 border-b" id="customer-selector-container" style="background: var(--bg-secondary);">
            <div id="customer-selector">
                <div class="relative" style="position:relative;">
                    <input type="text" id="cust-search-input" class="form-input w-full" placeholder="Search Customer..." autocomplete="off" style="width:100%;">
                    <div id="cust-search-results" class="absolute z-10 w-full bg-white shadow-lg border rounded hidden" style="position:absolute; top:100%; left:0; right:0; max-height:200px; overflow-y:auto; background:white; z-index:100; border:1px solid #ddd;"></div>
                </div>
            </div>
            <div id="selected-customer" class="hidden flex justify-between items-center bg-blue-50 p-2 rounded mt-1" style="display:none; justify-content:space-between; align-items:center; background:#eff6ff; padding:0.5rem; border-radius:0.25rem; margin-top:0.25rem;">
                <div>
                    <div class="font-bold" id="sel-cust-name" style="font-weight:bold;">Customer Name</div>
                    <div class="text-xs text-secondary" style="font-size:0.75rem; color:#64748b;">Points: <span id="sel-cust-points">0</span></div>
                </div>
                <button class="text-red-500 hover:text-red-700" onclick="POS.clearCustomer()" style="color:#ef4444; background:none; border:none; cursor:pointer;">✕</button>
            </div>
          </div>

          <div class="cart-header">
            <h3>🛒 Cart</h3>
            <div class="cart-count" id="cart-count">0</div>
          </div>
          <div class="cart-items" id="cart-items"></div>
          
          <div class="cart-footer">
            <!-- Sale Adjustments -->
            <div class="cart-adjustments p-2 bg-gray-50 border-t border-b text-sm" style="padding:0.5rem; background:#f8fafc; border-top:1px solid #e2e8f0; border-bottom:1px solid #e2e8f0; font-size:0.875rem;">
                <div class="flex justify-between items-center mb-1" style="display:flex; justify-content:space-between; margin-bottom:0.25rem;">
                    <label class="flex items-center gap-2 cursor-pointer" style="display:flex; align-items:center; gap:0.5rem; cursor:pointer;">
                        <input type="checkbox" id="tax-toggle" checked onchange="POS.toggleTax()">
                        <span>Apply VAT (16%)</span>
                    </label>
                </div>
                <div class="flex justify-between items-center mb-1 gap-2" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
                    <label>Discount</label>
                    <input type="number" id="discount-input" class="form-input text-right w-24 p-1 text-sm" placeholder="0.00" oninput="POS.updateDiscount(this.value)" style="text-align:right; width:6rem; padding:0.25rem;">
                </div>
                <div id="loyalty-redeem-row" class="hidden flex justify-between items-center gap-2" style="display:none; justify-content:space-between; align-items:center;">
                     <label>Redeem Pts</label>
                     <input type="number" id="redeem-points-input" class="form-input text-right w-24 p-1 text-sm" placeholder="0" oninput="POS.updateRedeemPoints(this.value)" style="text-align:right; width:6rem; padding:0.25rem;">
                </div>
                <div id="loyalty-value-display" class="hidden text-right text-xs text-green-600 mb-1" style="display:none; text-align:right; font-size:0.75rem; color:#16a34a; margin-bottom:0.25rem;">
                    Value: K 0.00
                </div>
            </div>

            <div class="cart-totals">
              <div class="cart-total-row"><span>Subtotal</span><span id="cart-subtotal">K 0.00</span></div>
              <div class="cart-total-row"><span>Discount</span><span id="cart-discount">K 0.00</span></div>
              <div class="cart-total-row"><span>VAT (16%)</span><span id="cart-tax">K 0.00</span></div>
              <div class="cart-total-row grand-total" id="cart-total-row"><span>Total</span><span id="cart-total">K 0.00</span></div>
            </div>
            <div class="cart-actions">
              <button class="btn btn-success btn-full" id="btn-checkout" disabled>💳 Checkout <span class="shortcut-hint">F4</span></button>
              <button class="btn btn-secondary btn-full btn-sm" id="btn-clear-cart" disabled>Clear Cart</button>
            </div>
          </div>
        </div>
      </div>
    `;


    this.setupListeners();
    this.setupCustomerListeners();
    await this.loadData();
  },

  setupCustomerListeners() {
    const input = document.getElementById('cust-search-input');
    const results = document.getElementById('cust-search-results');

    if (!input) return;

    input.addEventListener('input', Utils.debounce(async (e) => {
      const query = e.target.value.trim();
      if (query.length < 2) {
        results.classList.add('hidden');
        results.style.display = 'none';
        return;
      }

      try {
        const res = await API.get(`/customers?search=${encodeURIComponent(query)}&limit=5`);
        const customers = res.customers || [];

        if (customers.length === 0) {
          results.innerHTML = '<div class="p-2 text-gray-500" style="padding:0.5rem; color:#6b7280;">No customers found</div>';
        } else {
          results.innerHTML = customers.map(c => `
                      <div class="p-2 hover:bg-gray-100 cursor-pointer border-b last:border-0" 
                           onclick="POS.selectCustomer(${c.customer_id}, '${c.full_name.replace(/'/g, "\\'")}', ${c.loyalty_points || 0})"
                           style="padding:0.5rem; cursor:pointer; border-bottom:1px solid #eee;">
                          <div class="font-bold text-sm" style="font-weight:bold;">${c.full_name}</div>
                          <div class="text-xs text-gray-500" style="font-size:0.75rem; color:#6b7280;">${c.phone || ''} • ${c.loyalty_points || 0} pts</div>
                      </div>
                  `).join('');
        }
        results.classList.remove('hidden');
        results.style.display = 'block';
      } catch (err) {
        console.error(err);
      }
    }, 300));

    document.addEventListener('click', (e) => {
      if (document.getElementById('customer-selector') && !document.getElementById('customer-selector').contains(e.target)) {
        results.classList.add('hidden');
        results.style.display = 'none';
      }
    });
  },

  selectCustomer(id, name, points) {
    this.customer = { id, name, points };
    const input = document.getElementById('cust-search-input');
    const results = document.getElementById('cust-search-results');
    if (input) input.value = '';
    if (results) results.style.display = 'none';

    document.getElementById('customer-selector').style.display = 'none';
    const selDiv = document.getElementById('selected-customer');
    selDiv.classList.remove('hidden');
    selDiv.style.display = 'flex';

    document.getElementById('sel-cust-name').textContent = name;
    document.getElementById('sel-cust-points').textContent = points;

    if (points > 0) {
      document.getElementById('loyalty-redeem-row').classList.remove('hidden');
      document.getElementById('loyalty-redeem-row').style.display = 'flex';
      document.getElementById('loyalty-value-display').classList.remove('hidden');
      document.getElementById('loyalty-value-display').style.display = 'block';
    }

    this.updateCart();
  },

  clearCustomer() {
    this.customer = null;
    this.redeemPoints = 0;
    document.getElementById('redeem-points-input').value = '';
    document.getElementById('customer-selector').style.display = 'block';

    const selDiv = document.getElementById('selected-customer');
    selDiv.classList.add('hidden');
    selDiv.style.display = 'none';

    document.getElementById('loyalty-redeem-row').classList.add('hidden');
    document.getElementById('loyalty-redeem-row').style.display = 'none';
    document.getElementById('loyalty-value-display').classList.add('hidden');
    document.getElementById('loyalty-value-display').style.display = 'none';
    this.updateCart();
  },

  toggleTax() {
    this.taxEnabled = document.getElementById('tax-toggle').checked;
    this.updateCart();
  },

  updateDiscount(val) {
    this.discountAmount = parseFloat(val) || 0;
    this.updateCart();
  },

  updateRedeemPoints(val) {
    let points = parseInt(val) || 0;
    if (this.customer && points > this.customer.points) {
      points = this.customer.points;
      document.getElementById('redeem-points-input').value = points;
      Utils.toast(`Max points available: ${this.customer.points}`, 'warning');
    }
    this.redeemPoints = points;
    const value = points * 1.0;
    document.getElementById('loyalty-value-display').textContent = `Value: ${Utils.currency(value)}`;
    this.updateCart();
  },

  setupListeners() {
    // Keyboard Shortcuts
    document.addEventListener('keydown', async (e) => {
      // Only trigger if POS is visible (simple check: if pos-layout exists)
      if (!document.querySelector('.pos-layout')) return;

      if (e.key === 'F2') {
        e.preventDefault();
        document.getElementById('pos-search')?.focus();
      } else if (e.key === 'F4') {
        e.preventDefault();
        if (this.cart.length > 0) this.showCheckoutModal();
      } else if (e.key === 'Delete' && e.shiftKey) { // Shift+Del to clear
        if (this.cart.length > 0 && await Utils.confirm('Clear cart?', { title: 'Clear Cart', confirmText: 'Clear', type: 'warning' })) {
          this.cart = [];
          this.updateCart();
          SoundManager.trash();
        }
      } else if (e.key === 'Shortcuts' || e.key === '?' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        this.showShortcutsModal();
      } else if (e.altKey && e.key === 'c') {
        e.preventDefault();
        this.showCalculatorModal();
      } else if (e.altKey && e.key === '1') {
        e.preventDefault();
        document.querySelector('[data-tab="products"]').click();
      } else if (e.altKey && e.key === '2') {
        e.preventDefault();
        document.querySelector('[data-tab="services"]').click();
      }
    });

    // Tab switching
    document.querySelectorAll('.pos-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.pos-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeTab = tab.dataset.tab;
        this.renderItems();
        SoundManager.beep(); // Subtle feedback
      });
    });

    // Search
    document.getElementById('pos-search').addEventListener('input', Utils.debounce(() => {
      this.renderItems();
    }, 200));

    // Category filter
    document.getElementById('pos-category-filter').addEventListener('change', () => {
      this.renderItems();
    });

    // Utility Buttons
    document.getElementById('btn-scan-barcode').addEventListener('click', () => this.openScannerModal());

    document.getElementById('btn-shortcuts').addEventListener('click', () => this.showShortcutsModal());

    document.getElementById('btn-calculator').addEventListener('click', () => this.showCalculatorModal());

    document.getElementById('btn-currency').addEventListener('click', () => this.showCurrencyConverterModal());

    document.getElementById('btn-sync').addEventListener('click', () => {
      this.loadData();
      SoundManager.click();
    });

    document.getElementById('btn-fullscreen').addEventListener('click', () => this.toggleFullscreen());

    // Checkout
    document.getElementById('btn-checkout').addEventListener('click', () => this.showCheckoutModal());
    document.getElementById('btn-clear-cart').addEventListener('click', async () => {
      if (await Utils.confirm('Are you sure you want to clear the cart?', { title: 'Clear Cart', confirmText: 'Clear', type: 'warning' })) {
        this.cart = [];
        this.updateCart();
      }
    });

    // Fetch exchange rates
    this.fetchExchangeRates();
  },

  async loadData() {
    try {
      // Visual feedback for sync
      const syncBtn = document.getElementById('btn-sync');
      if (syncBtn) {
        syncBtn.querySelector('i')?.classList.add('fa-spin');
        syncBtn.disabled = true;
      }

      // Check cache first
      let productsData, servicesData, paymentsData, settingsData;

      const useCache = (key, ttl = 300000) => App.state[key] && (Date.now() - (App.state.lastFetch[key] || 0) < ttl);

      if (useCache('products') && useCache('services') && useCache('payments')) {
        productsData = { products: App.state.products };
        servicesData = { services: App.state.services };
        paymentsData = App.state.payments;
        settingsData = App.state.settings;
      } else {
        [productsData, servicesData, paymentsData, settingsData] = await Promise.all([
          API.get('/products?limit=1000'),
          API.get('/services'),
          API.get('/payments'),
          API.get('/settings')
        ]);

        App.state.products = productsData.products;
        App.state.services = servicesData.services;
        App.state.payments = paymentsData;
        App.state.settings = settingsData;
        App.state.lastFetch['products'] = Date.now();
        App.state.lastFetch['services'] = Date.now();
        App.state.lastFetch['payments'] = Date.now();
        App.state.lastFetch['settings'] = Date.now();
      }

      this.products = productsData.products || [];
      this.services = servicesData.services || [];
      this.paymentMethods = paymentsData || [];
      this.taxRate = parseFloat(settingsData['tax.rate']) || 0.16;

      // Update UI label
      const taxPercent = Math.round(this.taxRate * 100);
      const taxLabel = document.querySelector('#cart-tax');
      if (taxLabel && taxLabel.previousElementSibling) {
        taxLabel.previousElementSibling.textContent = `VAT (${taxPercent}%)`;
      }

      // Populate category filter
      const categories = new Set();
      this.products.forEach(p => p.category && categories.add(p.category));
      this.services.forEach(s => s.category && categories.add(s.category));

      const select = document.getElementById('pos-category-filter');
      if (select) {
        select.innerHTML = '<option value="">All Categories</option>'; // Reset options
        categories.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c;
          opt.textContent = c;
          select.appendChild(opt);
        });
      }

      this.renderItems();

      // Setup auto-sync if not already
      if (!this.autoSyncInterval) {
        this.autoSyncInterval = setInterval(() => {
          if (document.querySelector('.pos-layout')) { // Only sync if POS is active
            this.loadData();
          }
        }, 30000); // Sync every 30s
      }

    } catch (err) {
      console.error(err);
      Utils.toast('Failed to load products/services', 'error');
    } finally {
      const syncBtn = document.getElementById('btn-sync');
      if (syncBtn) {
        syncBtn.querySelector('i')?.classList.remove('fa-spin');
        syncBtn.disabled = false;
      }
    }
  },

  renderItems() {
    const grid = document.getElementById('pos-items-grid');
    if (!grid) return;

    const search = (document.getElementById('pos-search')?.value || '').toLowerCase();
    const category = document.getElementById('pos-category-filter')?.value || '';

    let items = [];

    if (this.activeTab === 'products') {
      items = this.products.filter(p => {
        const matchSearch = !search || p.name.toLowerCase().includes(search) || (p.barcode || '').includes(search);
        const matchCategory = !category || p.category === category;
        return matchSearch && matchCategory;
      });

      grid.innerHTML = items.length ? items.map(p => `
        <div class="pos-item-card" data-type="product" data-id="${p.product_id}" role="button" tabindex="0">
          <div class="item-category">${p.category || 'General'}</div>
          <div class="item-name" title="${p.name}">${p.name}</div>
          <div class="item-price">${Utils.currency(p.unit_price)}</div>
          <div class="item-stock ${p.stock_quantity <= p.reorder_level ? 'text-danger' : ''}">
            ${p.stock_quantity} in stock
          </div>
        </div>
      `).join('') : '<div class="empty-state" style="grid-column:1/-1;"><p>No products found</p></div>';
    } else {
      // Services Tab
      items = this.services.filter(s => {
        const matchSearch = !search || s.service_name.toLowerCase().includes(search);
        const matchCategory = !category || s.category === category;
        return matchSearch && matchCategory && s.is_active;
      });

      grid.innerHTML = items.length ? items.map(s => `
        <div class="pos-item-card" data-type="service" data-id="${s.service_id}" role="button" tabindex="0">
          <div class="item-category">${s.category || 'General'}</div>
          <div class="item-name" title="${s.service_name}">${s.service_name}</div>
          <div class="item-price">${Utils.currency(s.base_price)}</div>
          <div class="item-stock">${s.unit_measure || 'fixed'}</div>
        </div>
      `).join('') : '<div class="empty-state" style="grid-column:1/-1;"><p>No services found</p></div>';
    }

    // Bind event listeners to new cards
    grid.querySelectorAll('.pos-item-card').forEach(card => {
      const handler = () => {
        const type = card.dataset.type;
        const id = parseInt(card.dataset.id);
        this.addToCart(type, id);

        // Visual feedback
        card.style.transform = 'scale(0.95)';
        setTimeout(() => card.style.transform = '', 100);
      };
      card.onclick = handler;
      card.onkeydown = (e) => e.key === 'Enter' && handler();
    });
  },

  addToCart(type, id) {
    const existing = this.cart.find(item => item.type === type && (type === 'product' ? item.product_id === id : item.service_id === id));
    let item;

    if (type === 'product') {
      const product = this.products.find(p => p.product_id === id);
      if (!product) return;

      if (product.stock_quantity <= 0) {
        SoundManager.error();
        Utils.toast('Out of stock!', 'error');
        return;
      }

      item = {
        product_id: product.product_id, // Compatibility with processSale
        type: 'product',
        name: product.name,
        price: parseFloat(product.unit_price),
        unit_price: parseFloat(product.unit_price), // Compatibility
        taxRate: this.taxRate,
        quantity: 1,
        maxStock: product.stock_quantity
      };
    } else {
      const service = this.services.find(s => s.service_id === id);
      if (!service) return;

      item = {
        service_id: service.service_id, // Compatibility
        type: 'service',
        name: service.service_name,
        price: parseFloat(service.base_price),
        unit_price: parseFloat(service.base_price),
        taxRate: 0,
        quantity: 1
      };
    }

    if (existing) {
      if (type === 'product' && existing.quantity >= existing.maxStock) {
        SoundManager.error();
        Utils.toast('Not enough stock!', 'warning');
        return;
      }
      existing.quantity++;
      SoundManager.beep();
    } else {
      this.cart.push(item);
      SoundManager.beep();
    }

    this.updateCart();

    // Flash total
    const totalRow = document.getElementById('cart-total-row');
    if (totalRow) {
      totalRow.classList.remove('cart-update-anim');
      void totalRow.offsetWidth; // trigger reflow
      totalRow.classList.add('cart-update-anim');
    }
  },

  updateCart() {
    const cartContainer = document.getElementById('cart-items');
    const countBadge = document.getElementById('cart-count');
    const subtotalEl = document.getElementById('cart-subtotal');
    const discountEl = document.getElementById('cart-discount');
    const taxEl = document.getElementById('cart-tax');
    const totalEl = document.getElementById('cart-total');
    const checkoutBtn = document.getElementById('btn-checkout');
    const clearBtn = document.getElementById('btn-clear-cart');

    if (!cartContainer) return;

    if (this.cart.length === 0) {
      cartContainer.innerHTML = `
            <div class="cart-empty-state">
              <div class="cart-empty-icon">🛒</div>
              <p class="text-lg font-bold">Your cart is empty</p>
              <p class="text-sm">Scan a barcode or click items to add them.</p>
            </div>
          `;
      countBadge.textContent = '0';
      if (subtotalEl) subtotalEl.textContent = Utils.currency(0);
      if (discountEl) discountEl.textContent = Utils.currency(0);
      if (taxEl) taxEl.textContent = Utils.currency(0);
      if (totalEl) totalEl.textContent = Utils.currency(0);
      if (checkoutBtn) checkoutBtn.disabled = true;
      if (clearBtn) clearBtn.disabled = true;
      return;
    }

    let subtotal = 0;

    // 1. Calculate Subtotal (Item Price * Qty)
    cartContainer.innerHTML = this.cart.map((item, index) => {
      const itemTotal = item.unit_price * item.quantity;
      subtotal += itemTotal;

      return `
            <div class="cart-item cart-item-anim">
              <div class="cart-item-info">
                  <div class="cart-item-name">${item.name}</div>
                  <div class="cart-item-price">${Utils.currency(item.unit_price)} × ${item.quantity}</div>
              </div>
              <div class="cart-item-controls">
                  <button class="btn-qty" onclick="POS.updateQty(${index}, -1)">-</button>
                  <span class="cart-item-qty">${item.quantity}</span>
                  <button class="btn-qty" onclick="POS.updateQty(${index}, 1)">+</button>
                  <button class="btn-remove" onclick="POS.removeItem(${index})">&times;</button>
              </div>
              <div class="cart-item-total">${Utils.currency(itemTotal)}</div>
            </div>
          `;
    }).join('');

    // --- Totals Calculation ---
    // 2. Discount (Manual + Loyalty)
    const pointsValue = (this.redeemPoints || 0) * 1.0; // Value K1
    const totalDiscount = (this.discountAmount || 0) + pointsValue;

    // 3. Taxable Amount
    const taxableAmount = Math.max(0, subtotal - totalDiscount);

    // 4. Tax
    const tax = this.taxEnabled ? (taxableAmount * this.taxRate) : 0;

    // 5. Grand Total
    const total = taxableAmount + tax;

    if (countBadge) countBadge.textContent = this.cart.reduce((a, b) => a + b.quantity, 0);

    // Update UI
    if (subtotalEl) subtotalEl.textContent = Utils.currency(subtotal);
    if (discountEl) {
      discountEl.textContent = totalDiscount > 0 ? `-${Utils.currency(totalDiscount)}` : Utils.currency(0);
      if (totalDiscount > 0) discountEl.classList.add('text-success');
      else discountEl.classList.remove('text-success');
    }

    // Update Tax Label based on toggle
    const taxLabelSpan = document.querySelector('#cart-tax')?.previousElementSibling;
    if (taxLabelSpan) {
      if (this.taxEnabled) {
        const taxPercent = Math.round(this.taxRate * 100);
        taxLabelSpan.textContent = `VAT (${taxPercent}%)`;
        if (taxEl) taxEl.classList.remove('text-muted', 'strike-through');
      } else {
        taxLabelSpan.textContent = `VAT (Exempt)`;
        if (taxEl) taxEl.classList.add('text-muted', 'strike-through');
      }
    }

    if (taxEl) taxEl.textContent = Utils.currency(tax);
    if (totalEl) totalEl.textContent = Utils.currency(total);

    if (checkoutBtn) checkoutBtn.disabled = false;
    if (clearBtn) clearBtn.disabled = false;
  },

  updateQty(index, delta) {
    const item = this.cart[index];
    if (!item) return;

    const newQty = item.quantity + delta;

    if (newQty <= 0) {
      this.removeItem(index);
      return;
    }

    if (item.type === 'product' && newQty > item.maxStock) {
      SoundManager.error();
      Utils.toast('Cannot exceed stock quantity', 'warning');
      return;
    }

    item.quantity = newQty;
    SoundManager.beep();
    this.updateCart();
  },

  removeItem(index) {
    this.cart.splice(index, 1);
    SoundManager.trash();
    this.updateCart();
  },

  updateTotals(subtotal, discount, tax, total) {
    document.getElementById('cart-subtotal').textContent = Utils.currency(subtotal);
    document.getElementById('cart-discount').textContent = Utils.currency(discount);

    const discountEl = document.getElementById('cart-discount');
    if (discount > 0) {
      discountEl.classList.add('text-success');
    } else {
      discountEl.classList.remove('text-success');
    }

    document.getElementById('cart-tax').textContent = Utils.currency(tax);
    document.getElementById('cart-total').textContent = Utils.currency(total);
  },

  showCheckoutModal() {
    const subtotal = this.cart.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);

    // Totals Calculation (Same as updateCart)
    const pointsValue = (this.redeemPoints || 0) * 1.0;
    const totalDiscount = (this.discountAmount || 0) + pointsValue;
    const taxableAmount = Math.max(0, subtotal - totalDiscount);
    const tax = this.taxEnabled ? (taxableAmount * this.taxRate) : 0;
    const total = taxableAmount + tax;

    // Default to Cash if available, else first method
    const defaultMethod = this.paymentMethods.find(pm => pm.name === 'Cash') || this.paymentMethods[0];
    this.selectedPaymentMethod = defaultMethod ? defaultMethod.name : 'Cash';

    const paymentButtonsHtml = this.paymentMethods.map(pm => {
      const style = this.getPaymentStyling(pm.name, pm.type);
      return `
                <button class="payment-method-btn ${style.className} ${pm.name === this.selectedPaymentMethod ? 'selected' : ''}" 
                        data-method="${pm.name}" data-type="${pm.type}">
                    <span class="payment-icon">${style.icon}</span>${pm.name}
                </button>
                `;
    }).join('');

    Utils.showModal(`
          <div class="modal-header">
            <h3>💳 Checkout</h3>
            <button class="modal-close" onclick="Utils.closeModal()">✕</button>
          </div>
          <div class="modal-body">
            <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:1rem;">Select payment method</p>
            
            <div class="payment-methods">
              ${paymentButtonsHtml}
            </div>

            <div class="form-group ${defaultMethod.type === 'cash' ? 'hidden' : ''}" id="payment-ref-group">
                <label for="payment-reference">Transaction Reference / Receipt No.</label>
                <input type="text" id="payment-reference" placeholder="e.g. TXN-12345678 or Last 4 digits">
            </div>

            <div class="form-group">
              <label for="checkout-amount">Amount Tendered</label>
              <input type="number" id="checkout-amount" value="${total.toFixed(2)}" step="0.01" min="0">
            </div>

            <div style="background:var(--bg-input);border-radius:var(--radius-md);padding:1rem;margin-top:0.5rem;">
              <div class="cart-total-row"><span>Subtotal</span><span>${Utils.currency(subtotal)}</span></div>
              ${totalDiscount > 0 ? `<div class="cart-total-row text-success"><span>Discount</span><span>-${Utils.currency(totalDiscount)}</span></div>` : ''}
              <div class="cart-total-row"><span>VAT (${this.taxEnabled ? Math.round(this.taxRate * 100) + '%' : 'Exempt'})</span><span>${Utils.currency(tax)}</span></div>
              <div class="cart-total-row grand-total"><span>Total</span><span>${Utils.currency(total)}</span></div>
              <div class="cart-total-row" style="color:var(--success);"><span>Change</span><span id="checkout-change">K 0.00</span></div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
            <button class="btn btn-success" id="btn-confirm-sale">✓ Confirm Sale</button>
          </div>
        `);

    // Payment method selection
    document.querySelectorAll('.payment-method-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.payment-method-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selectedPaymentMethod = btn.dataset.method;
        SoundManager.beep(); // Sound feedback on selection

        const type = btn.dataset.type;
        const refGroup = document.getElementById('payment-ref-group');
        if (type === 'cash') {
          refGroup.classList.add('hidden');
        } else {
          refGroup.classList.remove('hidden');
          document.getElementById('payment-reference').focus();
        }
      });
    });

    // Change calculation
    const amountInput = document.getElementById('checkout-amount');
    amountInput.addEventListener('input', (e) => {
      const amount = parseFloat(e.target.value) || 0;
      const change = Math.max(0, amount - total);
      document.getElementById('checkout-change').textContent = Utils.currency(change);
    });

    // Auto-select text on focus
    amountInput.addEventListener('focus', () => amountInput.select());

    // Confirm sale
    document.getElementById('btn-confirm-sale').addEventListener('click', () => {
      this.processSale(total);
    });
  },

  getPaymentStyling(name, type) {
    if (!name) return { icon: '💰', className: 'payment-btn-generic' };
    const n = name.toLowerCase();

    if (n.includes('mtn')) return { icon: '🟡', className: 'payment-btn-mtn' };
    if (n.includes('airtel')) return { icon: '🔴', className: 'payment-btn-airtel' };
    if (n.includes('zamtel')) return { icon: '🟢', className: 'payment-btn-zamtel' };

    if (n.includes('fnb')) return { icon: '🏦', className: 'payment-btn-fnb' };
    if (n.includes('zanaco')) return { icon: '🏦', className: 'payment-btn-zanaco' };
    if (n.includes('absa')) return { icon: '🏦', className: 'payment-btn-absa' };
    if (n.includes('stanbic')) return { icon: '🏦', className: 'payment-btn-stanbic' };
    if (n.includes('indo')) return { icon: '🏦', className: 'payment-btn-indo' };
    if (n.includes('atlas')) return { icon: '🏦', className: 'payment-btn-atlas' };

    // Fallbacks based on type
    if (type === 'cash') return { icon: '💵', className: '' };
    if (type === 'card') return { icon: '💳', className: '' };
    if (type === 'mobile') return { icon: '📱', className: '' };

    return { icon: '💰', className: 'payment-btn-generic' };
  },

  async processSale(total) {
    const btn = document.getElementById('btn-confirm-sale');
    if (btn.disabled) return;

    const amountPaid = parseFloat(document.getElementById('checkout-amount').value) || total;
    const refInput = document.getElementById('payment-reference');
    const paymentReference = refInput ? refInput.value.trim() : null;

    // Validation for non-cash methods
    const selectedMethod = this.paymentMethods.find(pm => pm.name === this.selectedPaymentMethod);
    if (selectedMethod && selectedMethod.type !== 'cash' && !paymentReference) {
      SoundManager.error();
      Utils.toast('Please enter a transaction reference for non-cash payments.', 'warning');
      refInput.focus();
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Processing...';

    const payload = {
      items: this.cart.map(item => ({
        type: item.type,
        product_id: item.product_id || undefined,
        service_id: item.service_id || undefined,
        quantity: item.quantity
      })),
      payment_method: this.selectedPaymentMethod,
      amount_paid: amountPaid,
      payment_reference: paymentReference,
      customer_id: this.customer ? this.customer.id : null,
      tax_exempt: !this.taxEnabled,
      discount_amount: this.discountAmount || 0,
      points_redeemed: this.redeemPoints || 0,
      transaction_date: new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().replace('T', ' ').slice(0, 19)
    };

    try {
      // API call to create sale
      const sale = await API.post('/sales', payload);
      SoundManager.success();
      Utils.closeModal();
      this.showReceiptModal(sale);
      this.cart = [];
      this.updateCart();
      // Refresh product stock data
      await this.loadData();
    } catch (err) {
      SoundManager.error();
      Utils.toast(err.message || 'Sale failed', 'error');
      btn.disabled = false;
      btn.textContent = '✓ Confirm Sale';
    }
  },

  showReceiptModal(sale) {
    const items = sale.items || [];
    const styling = this.getPaymentStyling(sale.payment_method, null);

    const isOffline = sale.is_offline === true;
    const title = isOffline ? 'Sale Saved (Offline)' : 'Payment Successful!';
    const icon = isOffline ? '💾' : '✓';
    const subtext = isOffline ?
      `<p class="text-warning">Saved locally. Will sync when online.<br>Sale ID: ${sale.sale_number}</p>` :
      `<p class="text-secondary">Sale #${sale.sale_number}</p>`;

    // Disable email if offline
    const emailBtnState = isOffline ? 'disabled title="Cannot email offline"' : '';

    Utils.showModal(`
          <div class="modal-header">
            <h3></h3>
            <button class="modal-close" onclick="Utils.closeModal()">✕</button>
          </div>
          <div class="modal-body text-center">
            
            <div class="receipt-success-icon" style="${isOffline ? 'background:var(--warning);' : ''}">${icon}</div>
            
            <h2>${title}</h2>
            ${subtext}
            
            <div class="receipt-amount-display">
                ${Utils.currency(sale.total_amount)}
            </div>
    
            <div class="receipt-method-badge">
                <span>${styling.icon}</span>
                <span>Paid via ${sale.payment_method}</span>
            </div>
    
            <div class="receipt-preview text-left" style="background:var(--bg-input);padding:1rem;border-radius:var(--radius-md);margin-bottom:1.5rem;max-height:200px;overflow-y:auto;">
                ${items.map(item => `
                    <div class="flex justify-between text-sm mb-1">
                        <span>${item.quantity}x ${item.name || 'Item'}</span>
                        <span>${Utils.currency(item.total_price || (item.unit_price * item.quantity))}</span>
                    </div>
                `).join('')}
                <div class="border-t mt-2 pt-2 flex justify-between font-bold">
                    <span>Total</span>
                    <span>${Utils.currency(sale.total_amount)}</span>
                </div>
            </div>
    
            <div class="flex gap-2 justify-center">
                <button class="btn btn-outline" onclick="POS.printReceipt('${sale.sale_number}')">
                    🖨 Print Receipt
                </button>
                <button class="btn btn-primary" onclick="POS.emailReceipt(${isOffline ? "'" + sale.tempId + "'" : sale.sale_id})" ${emailBtnState}>
                    ✉ Email Receipt
                </button>
            </div>
            
            <button class="btn btn-link mt-4" onclick="Utils.closeModal()">Start New Sale</button>
          </div>
        `);

    // Store current sale for printing
    this.lastSale = sale;
  },

  printReceipt(saleData = null) {
    const sale = saleData || this.lastSale;
    if (!sale) return;

    const win = window.open('', 'Print Receipt', 'width=400,height=600');
    win.document.write(`
          <html>
            <head>
              <title>Receipt ${sale.sale_number}</title>
              <style>
                body { font-family: 'Courier New', monospace; font-size: 12px; padding: 20px; }
                .text-center { text-align: center; }
                .bold { font-weight: bold; }
                .line { border-bottom: 1px dashed #000; margin: 10px 0; }
                .flex { display: flex; justify-content: space-between; }
                .receipt-logo { max-width: 100px; height: auto; margin-bottom: 15px; }
                .mb-1 { margin-bottom: 5px; }
              </style>
            </head>
            <body>
              <div class="text-center">
                <img src="/logo.jpg" class="receipt-logo" alt="Logo">
                <h2 class="bold" style="margin-top: 0;">ZACHI COMPUTER CENTRE</h2>
                <p>Near Coppers Corner, Independence Avenue, Solwezi</p>
                <p>+260 974 210 067</p>
                <p>zachicomputercentre120@gmail.com | info@zachicomputercentre.com</p>
                <p class="bold" style="margin-top:10px;">${sale.is_offline ? 'OFFLINE RECEIPT' : 'OFFICIAL RECEIPT'}</p>
              </div>
              <div class="line"></div>
              <p>Date: ${new Date(sale.transaction_date || Date.now()).toLocaleString()}</p>
              <p>Sale #: ${sale.sale_number}</p>
              <div class="line"></div>
              ${sale.items.map(item => `
                <div class="flex mb-1">
                  <span>${item.quantity} x ${item.name || item.description || 'Item'}</span>
                  <span>${Number(item.total_price || item.line_total || (item.unit_price * item.quantity)).toFixed(2)}</span>
                </div>
              `).join('')}
              <div class="line"></div>
              <div class="flex bold">
                <span>TOTAL</span>
                <span>K ${Number(sale.total_amount).toFixed(2)}</span>
              </div>
              <div class="flex">
                <span>Paid (${sale.payment_method})</span>
                <span>K ${Number(sale.amount_paid || sale.total_amount).toFixed(2)}</span>
              </div>
              <div class="line"></div>
              <p class="text-center">Thank you for your business!</p>
            </body>
          </html>
        `);
    win.document.close();
    win.focus();
    win.print();
    win.close();
  },

  async emailReceipt(saleId) {
    const email = await Utils.prompt('Enter customer email address:', {
      title: 'Email Receipt',
      placeholder: 'customer@example.com',
      type: 'primary'
    });
    if (!email) return;
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      SoundManager.error();
      Utils.toast('Invalid email address', 'warning');
      return;
    }

    try {
      Utils.toast('Sending receipt...', 'info');
      await API.post('/sales/receipt/email', { sale_id: saleId, email });
      SoundManager.success();
      Utils.toast('Receipt sent successfully!', 'success');
    } catch (err) {
      SoundManager.error();
      Utils.toast(err.message || 'Failed to send email', 'error');
    }
  },

  async openScannerModal() {
    const modalContent = document.getElementById('modal-content');
    modalContent.innerHTML = `
          <div class="modal-header">
            <h2>Scan Barcode</h2>
            <button class="modal-close">&times;</button>
          </div>
      <div class="modal-body">
        <div class="mb-2">
            <select id="scanner-camera-select" class="form-control" style="width:100%; margin-bottom: 10px;">
                <option value="" disabled selected>Loading cameras...</option>
            </select>
        </div>
        <div id="scanner-container" style="width: 100%; height: 300px; background: #000; position: relative;"></div>
        <p class="text-center text-muted mt-2">Point camera at a barcode</p>
      </div>
    `;

    document.getElementById('modal-overlay').classList.remove('hidden');

    // Close handler
    const closeBtn = modalContent.querySelector('.modal-close');
    const closeScanner = () => {
      if (window.Scanner) window.Scanner.stop();
      document.getElementById('modal-overlay').classList.add('hidden');
    };

    closeBtn.onclick = closeScanner;

    // Close on overlay click
    document.getElementById('modal-overlay').onclick = (e) => {
      if (e.target.id === 'modal-overlay') {
        closeScanner();
      }
    };

    // Initialize scanner
    setTimeout(async () => {
      if (window.Scanner) {
        // success callback
        const onScanSuccess = (code) => {
          if (!document.getElementById('modal-overlay').classList.contains('hidden')) {
            SoundManager.beep();
            closeScanner();
            this.handleScanResult(code);
          }
        };

        // error callback
        const onScanError = (err) => {
          // console.warn(err); 
        };

        // Initialize scanner instance
        window.Scanner.init("scanner-container", onScanSuccess, onScanError);

        try {
          const cameras = await window.Scanner.getCameras();
          const select = document.getElementById('scanner-camera-select');

          if (cameras && cameras.length > 0) {
            select.innerHTML = cameras.map(cam => `<option value="${cam.id}">${cam.label || 'Camera ' + cam.id}</option>`).join('');

            // Try to auto-select back camera
            const backCam = cameras.find(c => c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('environment'));
            const selectedCameraId = backCam ? backCam.id : cameras[0].id;

            select.value = selectedCameraId;

            // Start scanning
            await window.Scanner.start(selectedCameraId);

            // Handle change
            select.onchange = async () => {
              await window.Scanner.stop();
              await window.Scanner.start(select.value);
            };
          } else {
            select.innerHTML = '<option value="">No cameras found</option>';
            Utils.toast('No cameras found. Trying default...', 'warning');
            // Try default constraints
            await window.Scanner.start({ facingMode: "environment" });
          }
        } catch (err) {
          console.error(err);
          Utils.toast('Failed to access camera: ' + err.message, 'error');
          document.getElementById('scanner-camera-select').innerHTML = '<option value="">Camera Error</option>';
        }

      } else {
        console.error('Scanner module not loaded');
        Utils.toast('Scanner not available', 'error');
      }
    }, 100);
  },

  handleScanResult(code) {
    if (!code) return;
    const product = this.products.find(p => p.sku === code || (p.barcode && p.barcode === code));

    if (product) {
      this.addToCart('product', product.product_id);
      Utils.toast(`Added ${product.name} to cart`, 'success');
      document.getElementById('pos-search').value = '';
      this.renderItems();
    } else {
      SoundManager.error();
      document.getElementById('pos-search').value = code;
      this.renderItems();
      Utils.toast(`Product not found. filtering by '${code}'`, 'info');
    }
  },

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  },

  showShortcutsModal() {
    Utils.showModal(`
        <div class="modal-header">
            <h3>⌨ Keyboard Shortcuts</h3>
            <button class="modal-close" onclick="Utils.closeModal()">✕</button>
        </div>
        <div class="modal-body">
            <table class="shortcuts-table">
                <tr><td><kbd>F2</kbd></td><td>Focus Search Bar</td></tr>
                <tr><td><kbd>F4</kbd></td><td>Open Checkout</td></tr>
                <tr><td><kbd>Shift</kbd> + <kbd>Delete</kbd></td><td>Clear Cart</td></tr>
                <tr><td><kbd>Alt</kbd> + <kbd>1</kbd></td><td>Switch to Products Tab</td></tr>
                <tr><td><kbd>Alt</kbd> + <kbd>2</kbd></td><td>Switch to Services Tab</td></tr>
                <tr><td><kbd>Alt</kbd> + <kbd>C</kbd></td><td>Open Calculator</td></tr>
                <tr><td><kbd>?</kbd></td><td>Show this Shortcuts Help</td></tr>
                <tr><td><kbd>Enter</kbd></td><td>Add focused item to cart / Confirm Dialogs</td></tr>
                <tr><td><kbd>Esc</kbd></td><td>Close Modals</td></tr>
            </table>
        </div>
      `);
  },

  showCurrencyConverterModal() {
    Utils.showModal(`
        <div class="modal-header">
            <h3>💱 Currency Converter</h3>
            <button class="modal-close" onclick="Utils.closeModal()">✕</button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label>Amount</label>
                <input type="number" id="curr-amount" class="form-control" value="1" min="0" step="0.01" oninput="POS.calcCurrency()">
            </div>
            <div class="form-row" style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-top:1rem;">
                <div class="form-group">
                    <label>From</label>
                    <select id="curr-from" class="form-control" onchange="POS.calcCurrency()">
                        <option value="ZMW">ZMW (K)</option>
                        <option value="USD">USD ($)</option>
                        <option value="ZAR">ZAR (R)</option>
                        <option value="GBP">GBP (£)</option>
                        <option value="EUR">EUR (€)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>To</label>
                    <select id="curr-to" class="form-control" onchange="POS.calcCurrency()">
                        <option value="ZMW">ZMW (K)</option>
                        <option value="USD" selected>USD ($)</option>
                        <option value="ZAR">ZAR (R)</option>
                        <option value="GBP">GBP (£)</option>
                        <option value="EUR">EUR (€)</option>
                    </select>
                </div>
            </div>
            <div class="result-box" style="background:#f8fafc; padding:1.5rem; text-align:center; border:1px solid #e2e8f0; border-radius:8px; margin-top:1rem;">
                <div id="curr-result" style="font-size:2rem; font-weight:800; color:var(--primary); line-height:1.2;">0.00</div>
                <div id="curr-rate" style="font-size:0.85rem; color:var(--text-muted); margin-top:0.5rem;">Rate: 1 = 1</div>
            </div>
        </div>
    `);
    this.calcCurrency();
  },

  // Rates relative to USD (Base)
  // Will be overwritten by fetchExchangeRates
  exchangeRates: {
    'USD': 1,
    'ZMW': 27.50,
    'ZAR': 19.00,
    'GBP': 0.79,
    'EUR': 0.92
  },

  async fetchExchangeRates() {
    try {
      const res = await fetch('/api/currency');
      if (!res.ok) throw new Error('Failed to fetch rates');
      const data = await res.json();
      // API returns only some rates, merge with defaults or overwrite?
      // API returns { "USD": 1, "ZMW": ... }
      // We only care about USD, ZMW, ZAR, GBP, EUR
      // Filter or just use data if it has all keys
      // Check if we have ZMW
      if (data && data.ZMW) {
        this.exchangeRates = data;
        console.log('Exchange rates updated:', this.exchangeRates);
      }
    } catch (err) {
      console.error('Currency fetch error:', err);
      Utils.toast('Failed to update exchange rates. Using defaults.', 'warning');
    }
  },

  calcCurrency() {
    const amount = parseFloat(document.getElementById('curr-amount').value) || 0;
    const from = document.getElementById('curr-from').value;
    const to = document.getElementById('curr-to').value;

    const rateFrom = this.exchangeRates[from] || 1; // Units per USD
    const rateTo = this.exchangeRates[to] || 1; // Units per USD

    // Convert From -> USD -> To
    // Amount / RateFrom = Amount in USD
    // Amount in USD * RateTo = Amount in To
    const result = (amount / rateFrom) * rateTo;

    document.getElementById('curr-result').textContent = Utils.currency(result, to === 'ZMW' ? 'K' : to === 'USD' ? '$' : to === 'ZAR' ? 'R' : to === 'GBP' ? '£' : '€');

    // Display rate: 1 From = X To
    // (1 / RateFrom) * RateTo
    const oneUnitRate = (1 / rateFrom) * rateTo;

    document.getElementById('curr-rate').textContent = `1 ${from} ≈ ${oneUnitRate.toFixed(4)} ${to}`;
  },

  showCalculatorModal() {
    Utils.showModal(`
        <div class="modal-header">
            <h3>🧮 Calculator</h3>
            <button class="modal-close" onclick="Utils.closeModal()">✕</button>
        </div>
        <div class="modal-body">
            <input type="text" id="calc-display" class="calc-display" readonly value="0">
            <div class="calc-grid">
                <button class="calc-btn clear" onclick="POS.calcClear()">AC</button>
                <button class="calc-btn operator" onclick="POS.calcAppend('/')">÷</button>
                <button class="calc-btn operator" onclick="POS.calcAppend('*')">×</button>
                <button class="calc-btn" onclick="POS.calcAppend('7')">7</button>
                <button class="calc-btn" onclick="POS.calcAppend('8')">8</button>
                <button class="calc-btn" onclick="POS.calcAppend('9')">9</button>
                <button class="calc-btn operator" onclick="POS.calcAppend('-')">−</button>
                <button class="calc-btn" onclick="POS.calcAppend('4')">4</button>
                <button class="calc-btn" onclick="POS.calcAppend('5')">5</button>
                <button class="calc-btn" onclick="POS.calcAppend('6')">6</button>
                <button class="calc-btn operator" onclick="POS.calcAppend('+')">+</button>
                <button class="calc-btn" onclick="POS.calcAppend('1')">1</button>
                <button class="calc-btn" onclick="POS.calcAppend('2')">2</button>
                <button class="calc-btn" onclick="POS.calcAppend('3')">3</button>
                <button class="calc-btn equal" onclick="POS.calcResult()">=</button>
                <button class="calc-btn" onclick="POS.calcAppend('0')">0</button>
                <button class="calc-btn" onclick="POS.calcAppend('.')">.</button>
            </div>
            <button class="btn btn-outline btn-full mt-4" onclick="POS.calcUseResult()">Use Result</button>
        </div>
      `);
  },

  calcAppend(val) {
    const display = document.getElementById('calc-display');
    if (display.value === '0' && !['+', '-', '*', '/'].includes(val)) display.value = '';
    display.value += val;
    SoundManager.click();
  },

  calcClear() {
    document.getElementById('calc-display').value = '0';
    SoundManager.trash();
  },

  calcResult() {
    try {
      const display = document.getElementById('calc-display');
      // simple safe eval for digits and operators
      if (/^[0-9+\-*/().\s]+$/.test(display.value)) {
        display.value = eval(display.value) || 0;
        SoundManager.success();
      }
    } catch (e) {
      document.getElementById('calc-display').value = 'Error';
      SoundManager.error();
    }
  },

  calcUseResult() {
    const val = document.getElementById('calc-display').value;
    navigator.clipboard.writeText(val).then(() => {
      Utils.toast('Result copied to clipboard', 'info');
      Utils.closeModal();
    }).catch(err => {
      console.error(err);
      Utils.toast('Failed to copy to clipboard', 'error');
    });
  }
};

// Ensure POS is globally available for inline event handlers
window.POS = POS;
window.SoundManager = SoundManager;
