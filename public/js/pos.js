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
    this.taxEnabled = false;
    this.discountAmount = 0;
    this.redeemPoints = 0;

    // Enhanced POS styles (animations, glass cart, calculator, shortcuts)
    // were previously injected here as a runtime <style> element; under
    // Task #7's hardened CSP `style-src` no longer allows inline styles, so
    // those rules have been moved to /css/styles.css (loaded statically).

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
          
          <div data-style="padding: 0 1rem 0.5rem 1rem; display:flex; justify-content:space-between; align-items:center;">
             <select id="pos-category-filter" data-style="width:auto; min-width:200px;">
              <option value="">All Categories</option>
            </select>
            <div class="pos-tabs">
                <button class="pos-tab active" data-tab="products" title="Alt+1">Products</button>
                <button class="pos-tab" data-tab="services" title="Alt+2">Services</button>
            </div>
          </div>

          <div class="pos-items-grid" id="pos-items-grid">
            <div class="loading text-center text-muted" data-style="grid-column:1/-1;padding:3rem;">Loading...</div>
          </div>
        </div>

        <div class="pos-cart">
          <!-- Customer Selection -->
          <div class="customer-section p-2 border-b" id="customer-selector-container" data-style="background: var(--bg-secondary);">
            <div id="customer-selector">
                <div class="relative" data-style="position:relative;">
                    <input type="text" id="cust-search-input" class="form-input w-full" placeholder="Search Customer..." autocomplete="off" data-style="width:100%;">
                    <div id="cust-search-results" class="absolute z-10 w-full bg-white shadow-lg border rounded hidden" data-style="position:absolute; top:100%; left:0; right:0; max-height:200px; overflow-y:auto; background:white; z-index:100; border:1px solid #ddd;"></div>
                </div>
            </div>
            <div id="selected-customer" class="hidden flex justify-between items-center bg-blue-50 p-2 rounded mt-1" data-style="display:none; justify-content:space-between; align-items:center; background:#eff6ff; padding:0.5rem; border-radius:0.25rem; margin-top:0.25rem;">
                <div>
                    <div class="font-bold" id="sel-cust-name" data-style="font-weight:bold;">Customer Name</div>
                    <div class="text-xs text-secondary" data-style="font-size:0.75rem; color:#64748b;">Points: <span id="sel-cust-points">0</span></div>
                </div>
                <button class="text-red-500 hover:text-red-700" data-on-click="POS.clearCustomer()" data-style="color:#ef4444; background:none; border:none; cursor:pointer;">✕</button>
            </div>
          </div>

          <div class="cart-header">
            <h3>🛒 Cart</h3>
            <div class="cart-count" id="cart-count">0</div>
          </div>
          <div class="cart-items" id="cart-items"></div>
          
          <div class="cart-footer">
            <!-- Sale Adjustments -->
            <div class="cart-adjustments p-2 bg-gray-50 border-t border-b text-sm" data-style="padding:0.5rem; background:#f8fafc; border-top:1px solid #e2e8f0; border-bottom:1px solid #e2e8f0; font-size:0.875rem;">
                <div class="flex justify-between items-center mb-1" data-style="display:flex; justify-content:space-between; margin-bottom:0.25rem;">
                    <label class="flex items-center gap-2 cursor-pointer" data-style="display:flex; align-items:center; gap:0.5rem; cursor:pointer;">
                        <input type="checkbox" id="tax-toggle" data-on-change="POS.toggleTax()">
                        <span>Apply VAT (16%)</span>
                    </label>
                </div>
                <div class="flex justify-between items-center mb-1 gap-2" data-style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
                    <label>Discount</label>
                    <input type="number" id="discount-input" class="form-input text-right w-24 p-1 text-sm" placeholder="0.00" data-on-input="POS.updateDiscount($value)" data-style="text-align:right; width:6rem; padding:0.25rem;">
                </div>
                <div id="loyalty-redeem-row" class="hidden flex justify-between items-center gap-2" data-style="display:none; justify-content:space-between; align-items:center;">
                     <label>Redeem Pts</label>
                     <input type="number" id="redeem-points-input" class="form-input text-right w-24 p-1 text-sm" placeholder="0" data-on-input="POS.updateRedeemPoints($value)" data-style="text-align:right; width:6rem; padding:0.25rem;">
                </div>
                <div id="loyalty-value-display" class="hidden text-right text-xs text-green-600 mb-1" data-style="display:none; text-align:right; font-size:0.75rem; color:#16a34a; margin-bottom:0.25rem;">
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
          results.innerHTML = '<div class="p-2 text-gray-500" data-style="padding:0.5rem; color:#6b7280;">No customers found</div>';
        } else {
          // customer_id is a UUID string — interpolating it raw into a
          // data-on-click="POS.selectCustomer(<id>, …)" arg fails the
          // delegation parser (UUIDs aren't valid JS literals), and a
          // UUID starting with "0…" would also trip up parseInt-style
          // consumers downstream. We use data-* attributes + a real
          // click listener so the UUID survives intact, and esc() the
          // name so a customer called `<img onerror=…>` can't run JS.
          const esc = (s) => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
          results.innerHTML = customers.map(c => `
                      <div class="cust-search-row p-2 hover:bg-gray-100 cursor-pointer border-b last:border-0"
                           data-cid="${esc(c.customer_id)}"
                           data-cname="${esc(c.full_name || '')}"
                           data-cpoints="${c.loyalty_points || 0}"
                           data-style="padding:0.5rem; cursor:pointer; border-bottom:1px solid #eee;">
                          <div class="font-bold text-sm" data-style="font-weight:bold;">${esc(c.full_name || '')}</div>
                          <div class="text-xs text-gray-500" data-style="font-size:0.75rem; color:#6b7280;">${esc(c.phone || '')} • ${c.loyalty_points || 0} pts</div>
                      </div>
                  `).join('');
          results.querySelectorAll('.cust-search-row').forEach(row => {
            row.addEventListener('click', () => {
              const id = row.dataset.cid;
              const name = row.dataset.cname;
              const points = parseInt(row.dataset.cpoints, 10) || 0;
              this.selectCustomer(id, name, points);
            });
          });
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

    // Search — debounced filter on every keystroke
    document.getElementById('pos-search').addEventListener('input', Utils.debounce(() => {
      this.renderItems();
    }, 200));

    // Enter on the search input is the universal hook for USB
    // keyboard-wedge barcode scanners (the standard retail hardware) —
    // they type the code at high speed then send a CR. If the typed
    // text exactly matches a SKU or barcode we add the product to the
    // cart immediately and clear the input. If there's no exact match
    // but exactly one product matches the partial filter we add THAT
    // (lets the cashier type a couple of letters + Enter for fast
    // manual entry). Otherwise we fall through to the existing
    // filter behaviour.
    document.getElementById('pos-search').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const raw = (e.target.value || '').trim();
      if (!raw) return;
      const lower = raw.toLowerCase();
      const exact = this.products.find(
        (p) => p.sku === raw || (p.barcode && p.barcode === raw)
      );
      if (exact) {
        e.preventDefault();
        this.handleScanResult(raw);
        return;
      }
      const partial = this.products.filter(
        (p) =>
          p.name.toLowerCase().includes(lower) ||
          (p.barcode || '').includes(raw) ||
          (p.sku || '').toLowerCase().includes(lower)
      );
      if (partial.length === 1) {
        e.preventDefault();
        this.addToCart('product', partial[0].product_id);
        Utils.toast(`Added ${partial[0].name} to cart`, 'success');
        e.target.value = '';
        this.renderItems();
      }
    });

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

    // Fetch exchange rates (best-effort — converter falls back to defaults).
    this.fetchExchangeRates().catch((err) => {
      console.error('Currency fetch error:', err);
    });
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
        // v1.0.51 — Promise.allSettled so a single failed fetch
        // (typical offline scenario where only some endpoints have
        // a cached copy) doesn't reject the whole load and leave the
        // POS empty. Each slot falls back to whatever we already had
        // in App.state so partial offline data is still usable.
        const results = await Promise.allSettled([
          API.get('/products?limit=1000'),
          API.get('/services'),
          API.get('/payments'),
          API.get('/settings')
        ]);
        productsData = results[0].status === 'fulfilled' ? results[0].value
                     : (App.state.products ? { products: App.state.products } : { products: [] });
        servicesData = results[1].status === 'fulfilled' ? results[1].value
                     : (App.state.services ? { services: App.state.services } : { services: [] });
        paymentsData = results[2].status === 'fulfilled' ? results[2].value
                     : (App.state.payments || []);
        settingsData = results[3].status === 'fulfilled' ? results[3].value
                     : (App.state.settings || {});

        App.state.products = productsData.products;
        App.state.services = servicesData.services;
        App.state.payments = paymentsData;
        App.state.settings = settingsData;
        if (!navigator.onLine) {
          const failed = results.filter((r) => r.status === 'rejected').length;
          if (failed > 0) {
            Utils.toast(`Offline — loaded ${4 - failed}/4 catalogues from cache.`, 'info');
          }
        }
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
      console.error('[POS] loadData failed, rendering with cached/empty data:', err);
      // Offline-safe degradation: render whatever we have so the user
      // can still ring sales (or at least see the POS shell) even when
      // every fetch failed and no cache existed. Without this the page
      // shows an infinite "Loading…" spinner and the sidebar can also
      // appear to vanish because no .pos-layout ever mounts.
      this.products = this.products || [];
      this.services = this.services || [];
      this.paymentMethods = this.paymentMethods || [];
      if (!this.taxRate) this.taxRate = 0.16;
      try { this.renderItems(); } catch (_) { /* ignore */ }
      if (!navigator.onLine) {
        Utils.toast('Offline — using cached products & services.', 'info');
      } else {
        Utils.toast('Failed to load products/services', 'error');
      }
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
      `).join('') : '<div class="empty-state" data-style="grid-column:1/-1;"><p>No products found</p></div>';
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
      `).join('') : '<div class="empty-state" data-style="grid-column:1/-1;"><p>No services found</p></div>';
    }

    // Bind event listeners to new cards. We use both `click` AND `pointerup`
    // because some Android WebView builds delay synthesised mouse-clicks
    // (~300ms tap delay or pointer cancellation when a parent container
    // scrolls slightly during the tap). Pointer events fire immediately
    // and reliably across mouse/touch/stylus. The de-dup flag prevents
    // double-add when both events fire on desktop.
    const self = this;
    grid.querySelectorAll('.pos-item-card').forEach(card => {
      let handled = false;
      const handler = (e) => {
        if (handled) return;
        handled = true;
        setTimeout(() => { handled = false; }, 250);

        const type = card.dataset.type;
        // IDs are UUIDs (strings) — do NOT parseInt or the lookup returns NaN.
        const id = card.dataset.id;
        // Visual feedback is handled by `.pos-item-card:active` in CSS,
        // so no inline transform here (that fights the CSS rule).
        self.addToCart(type, id);
      };
      card.onclick = handler;
      card.addEventListener('pointerup', handler);
      card.onkeydown = (e) => e.key === 'Enter' && handler(e);
    });
  },

  addToCart(type, id) {
    const existing = this.cart.find(item => item.type === type && (type === 'product' ? item.product_id === id : item.service_id === id));
    let item;

    if (type === 'product') {
      const product = this.products.find(p => p.product_id === id);
      if (!product) {
        // Don't silently swallow the tap — happens on Android when the
        // offline cache served the card list but `this.products` is empty
        // (e.g. after a hard refresh while offline).
        console.warn('[POS] addToCart: product not found in current list', { id, count: this.products.length });
        SoundManager.error();
        Utils.toast('Product list still loading — try again in a moment.', 'warning');
        return;
      }

      // Treat missing stock_quantity as "unknown, allow" rather than
      // "out of stock". Some offline cache rows drop the field; the
      // server-side processSale will still enforce real stock at checkout.
      const stock = product.stock_quantity;
      if (stock !== null && stock !== undefined && Number(stock) <= 0) {
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
        unit_of_measure: product.unit_of_measure || '',
        taxRate: this.taxRate,
        quantity: 1,
        maxStock: (stock === null || stock === undefined) ? Infinity : Number(stock)
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
        unit_measure: service.unit_measure || '',
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
      const uomLabel = item.unit_of_measure || item.unit_measure || '';

      return `
            <div class="cart-item cart-item-anim">
              <div class="cart-item-info">
                  <div class="cart-item-name">${item.name}</div>
                  <div class="cart-item-price">${Utils.currency(item.unit_price)} × ${item.quantity}${uomLabel ? ' ' + uomLabel : ''}</div>
              </div>
              <div class="cart-item-controls">
                  <button class="btn-qty" data-on-click="POS.updateQty(${index}, -1)">-</button>
                  <input type="number" class="cart-item-qty-input" value="${item.quantity}" min="0.001" step="any" inputmode="decimal"
                         data-on-change="POS.setQty(${index}, $value)" 
                         data-style="width: 64px; text-align: center; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px;">
                  <button class="btn-qty" data-on-click="POS.updateQty(${index}, 1)">+</button>
                  <button class="btn-remove" data-on-click="POS.removeItem(${index})">&times;</button>
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

    // Mirror final totals to the customer-facing display (best-effort).
    // Done at the END of updateCart so the display sees the same numbers
    // the cashier sees, including discounts, loyalty redemptions, and tax.
    try { this._pushToDisplay(); } catch (_) { /* ignore */ }
  },

  updateQty(index, delta) {
    const item = this.cart[index];
    if (!item) return;

    // Decimal-safe step (e.g. 2.5 m² + 1 = 3.5). Round to 3 dp to dodge
    // float-noise like 3.5000000000000004.
    const newQty = Math.round((Number(item.quantity) + delta) * 1000) / 1000;

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

  setQty(index, val) {
    const item = this.cart[index];
    if (!item) return;

    // Decimal qty (parseFloat, not parseInt) so cashiers can ring up
    // 2.5 m² of vinyl, 0.75 kg of paper, etc. Min 0.001 — anything
    // smaller is treated as a typo and snapped up.
    let newQty = parseFloat(val);
    if (!Number.isFinite(newQty) || newQty <= 0) newQty = 0.001;

    if (item.type === 'product' && newQty > item.maxStock) {
      SoundManager.error();
      Utils.toast(`Cannot exceed stock quantity (${item.maxStock})`, 'warning');
      newQty = item.maxStock;
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

    // Default deadline for any credit / partial sale = 30 days from
    // today, formatted in *local* time. Using toISOString() here
    // would shift the date by a day for any cashier west of UTC at
    // any time of day, and east of UTC late in the evening.
    const defaultDue = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    })();
    const todayLocal = (() => {
      const d = new Date();
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    })();
    // Tiny HTML escaper for any string that ends up inside an
    // innerHTML template — customer names come straight from a
    // user-editable field and could otherwise execute script in the
    // cashier's browser.
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    // Pre-render the "currently attached customer" pill so the cashier
    // can see at a glance who the credit is going to before they
    // confirm. If none attached, we show an "Attach customer" CTA that
    // expands the inline search inside the modal.
    const customerPillHtml = this.customer
      ? `<div data-style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:.6rem .8rem;">
           <div>
             <div data-style="font-weight:600;color:#1e40af;">👤 ${esc(this.customer.name)}</div>
             <div data-style="font-size:.75rem;color:#475569;">Customer attached — credit/partial balance will be tracked against them</div>
           </div>
           <button type="button" id="checkout-change-customer" class="btn btn-sm btn-outline">Change</button>
         </div>`
      : `<div data-style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:.6rem .8rem;">
           <div>
             <div data-style="font-weight:600;color:#9a3412;">No customer attached</div>
             <div data-style="font-size:.75rem;color:#7c2d12;">Required for Credit or Partial sales — attach so we can track the balance and send reminders.</div>
           </div>
           <button type="button" id="checkout-attach-customer" class="btn btn-sm btn-primary">+ Attach</button>
         </div>`;

    Utils.showModal(`
          <div class="modal-header">
            <h3>💳 Checkout</h3>
            <button class="modal-close" data-on-click="Utils.closeModal()">✕</button>
          </div>
          <div class="modal-body">
            <!-- Customer pill (always visible — credit/partial sales need it) -->
            <div id="checkout-customer-pill" data-style="margin-bottom:1rem;">${customerPillHtml}</div>

            <!-- Inline customer search (hidden until "+ Attach" / "Change" is clicked) -->
            <div id="checkout-customer-search" class="hidden" data-style="margin-bottom:1rem;position:relative;">
              <input type="text" id="checkout-cust-input" class="form-control" placeholder="Search customer by name or phone…" autocomplete="off" data-style="width:100%;">
              <div id="checkout-cust-results" data-style="position:absolute;top:100%;left:0;right:0;max-height:200px;overflow-y:auto;background:#fff;border:1px solid #ddd;border-radius:6px;z-index:10001;display:none;"></div>
              <div data-style="margin-top:.4rem;font-size:.78rem;color:var(--text-secondary);">
                Can't find them? <a href="#" id="checkout-quick-add-customer" data-style="color:var(--primary);text-decoration:underline;">+ Add a new customer</a>
              </div>
            </div>

            <div data-style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.4rem;">
              <p data-style="font-size:0.85rem;color:var(--text-secondary);margin:0;">Select payment method</p>
              <a href="#" id="checkout-split-toggle" data-style="font-size:.82rem;color:var(--primary);text-decoration:underline;">+ Split into multiple payments</a>
            </div>

            <!-- Single-tender controls — hidden when split-tender mode is active -->
            <div id="single-tender-block">
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
                <div data-style="margin-top:0.5rem;font-size:0.82rem;color:var(--text-secondary);display:flex;align-items:center;gap:0.4rem;">
                  <input type="checkbox" id="checkout-partial-toggle" data-style="margin:0;">
                  <label for="checkout-partial-toggle" data-style="margin:0;cursor:pointer;">
                    Accept partial payment — record balance on customer credit
                  </label>
                </div>
              </div>
            </div>

            <!-- Split-tender block (v1.0.18) — revealed when the cashier
                 clicks "+ Split into multiple payments". Each row is a
                 method + amount + (optional) reference; sum must equal
                 the sale total. Capped at 4 rows for UI tidiness. -->
            <div id="split-tender-block" class="hidden" data-style="margin-top:.5rem;">
              <p data-style="font-size:.82rem;color:var(--text-secondary);margin:0 0 .5rem 0;">
                Split this sale across multiple methods — sum must equal the total.
              </p>
              <div id="split-tender-rows"></div>
              <div data-style="display:flex;justify-content:space-between;align-items:center;margin-top:.6rem;gap:.5rem;flex-wrap:wrap;">
                <button type="button" id="split-add-tender" class="btn btn-sm btn-outline">+ Add tender</button>
                <span id="split-remaining-pill" data-style="padding:.3rem .7rem;border-radius:999px;font-weight:600;background:#fee2e2;color:#991b1b;">Remaining: ${Utils.currency(total)}</span>
              </div>
            </div>

            <!-- Due-date input: only relevant for Credit / Partial sales,
                 hidden by default and revealed by the payment-method /
                 partial-toggle handlers below. -->
            <div class="form-group hidden" id="checkout-due-date-group">
              <label for="checkout-due-date">Payment due by</label>
              <input type="date" id="checkout-due-date" value="${defaultDue}" min="${todayLocal}">
              <div data-style="font-size:.78rem;color:var(--text-secondary);margin-top:.25rem;">
                Used for the daily reminder email and the overdue badge in Credit Orders.
              </div>
            </div>

            <div data-style="background:var(--bg-input);border-radius:var(--radius-md);padding:1rem;margin-top:0.5rem;">
              <div class="cart-total-row"><span>Subtotal</span><span>${Utils.currency(subtotal)}</span></div>
              ${totalDiscount > 0 ? `<div class="cart-total-row text-success"><span>Discount</span><span>-${Utils.currency(totalDiscount)}</span></div>` : ''}
              <div class="cart-total-row"><span>VAT (${this.taxEnabled ? Math.round(this.taxRate * 100) + '%' : 'Exempt'})</span><span>${Utils.currency(tax)}</span></div>
              <div class="cart-total-row grand-total"><span>Total</span><span>${Utils.currency(total)}</span></div>
              <div class="cart-total-row" data-style="color:var(--success);"><span>Change</span><span id="checkout-change">K 0.00</span></div>
              <div class="cart-total-row" id="checkout-balance-row" data-style="color:#a00;font-weight:700;display:none;"><span>Balance Due</span><span id="checkout-balance">K 0.00</span></div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-on-click="Utils.closeModal()">Cancel</button>
            <button class="btn btn-success" id="btn-confirm-sale">✓ Confirm Sale</button>
          </div>
        `);

    // Helper: refresh the change/balance display whenever amount or
    // method changes. Single source of truth so Credit and Partial
    // toggles never drift out of sync with the typed amount.
    const balanceRow = document.getElementById('checkout-balance-row');
    const balanceVal = document.getElementById('checkout-balance');
    const changeVal  = document.getElementById('checkout-change');
    const amountInput = document.getElementById('checkout-amount');
    const partialToggle = document.getElementById('checkout-partial-toggle');
    const dueDateGroup = document.getElementById('checkout-due-date-group');

    // Show / hide the due-date input based on whether this sale will
    // end up as Credit or Partial. Called from the payment-method
    // click handler, the partial-toggle change handler, and once at
    // boot to set the initial state.
    const refreshDueDateVisibility = () => {
      const m = (this.paymentMethods.find(pm => pm.name === this.selectedPaymentMethod) || {}).type;
      const amount = parseFloat(amountInput.value) || 0;
      const willBeCreditOrPartial = (m === 'credit') || (partialToggle.checked && amount < total);
      dueDateGroup.classList.toggle('hidden', !willBeCreditOrPartial);
    };

    // ---- Inline customer picker (resolves the "I can't see where to
    // attach a customer" complaint — the cart-side picker gets covered
    // by the modal overlay so we surface a fresh one inside the modal)
    const pillEl   = document.getElementById('checkout-customer-pill');
    const searchEl = document.getElementById('checkout-customer-search');
    const custInput = document.getElementById('checkout-cust-input');
    const custResults = document.getElementById('checkout-cust-results');

    const renderCheckoutPill = () => {
      pillEl.innerHTML = this.customer
        ? `<div data-style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:.6rem .8rem;">
             <div>
               <div data-style="font-weight:600;color:#1e40af;">👤 ${esc(this.customer.name)}</div>
               <div data-style="font-size:.75rem;color:#475569;">Customer attached — credit/partial balance will be tracked against them</div>
             </div>
             <button type="button" id="checkout-change-customer" class="btn btn-sm btn-outline">Change</button>
           </div>`
        : `<div data-style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:.6rem .8rem;">
             <div>
               <div data-style="font-weight:600;color:#9a3412;">No customer attached</div>
               <div data-style="font-size:.75rem;color:#7c2d12;">Required for Credit or Partial sales — attach so we can track the balance and send reminders.</div>
             </div>
             <button type="button" id="checkout-attach-customer" class="btn btn-sm btn-primary">+ Attach</button>
           </div>`;
      // Re-bind because innerHTML wipes prior listeners
      const attachBtn = document.getElementById('checkout-attach-customer');
      const changeBtn = document.getElementById('checkout-change-customer');
      if (attachBtn) attachBtn.addEventListener('click', openCheckoutCustomerSearch);
      if (changeBtn) changeBtn.addEventListener('click', openCheckoutCustomerSearch);
    };

    const openCheckoutCustomerSearch = () => {
      searchEl.classList.remove('hidden');
      custInput.value = '';
      custResults.style.display = 'none';
      setTimeout(() => custInput.focus(), 50);
    };

    custInput.addEventListener('input', Utils.debounce(async (e) => {
      const q = e.target.value.trim();
      if (q.length < 2) {
        custResults.style.display = 'none';
        return;
      }
      try {
        const res = await API.get(`/customers?search=${encodeURIComponent(q)}&limit=8`);
        const list = res.customers || [];
        if (list.length === 0) {
          custResults.innerHTML = `<div data-style="padding:.5rem;color:#6b7280;">No customers found.</div>`;
        } else {
          // We escape every interpolation so a malicious customer
          // name (e.g. <img src=x onerror=…>) cannot execute script
          // in the cashier's browser. The raw name is still carried
          // through the data-cname attribute (also escaped) so the
          // click handler can pass the unescaped string back into
          // selectCustomer — there it goes through DOM textContent,
          // not innerHTML, so it's already safe.
          custResults.innerHTML = list.map(c => {
            const cname = c.full_name || '';
            return `<div class="checkout-cust-row" data-cid="${c.customer_id}" data-cname="${esc(cname)}" data-cpoints="${c.loyalty_points || 0}"
                         data-style="padding:.5rem .6rem;cursor:pointer;border-bottom:1px solid #eee;">
                      <div data-style="font-weight:600;">${esc(cname)}</div>
                      <div data-style="font-size:.75rem;color:#6b7280;">${esc(c.phone || '')} • ${c.loyalty_points || 0} pts</div>
                    </div>`;
          }).join('');
          custResults.querySelectorAll('.checkout-cust-row').forEach(row => {
            row.addEventListener('mouseenter', () => row.style.background = '#f1f5f9');
            row.addEventListener('mouseleave', () => row.style.background = '');
            row.addEventListener('click', () => {
              // customer_id is a UUID string — DO NOT parseInt or it
              // returns 0 for any UUID starting with "0…" (e.g.
              // "0a1b2c3d-…" → 0), which the server then rejects with
              // `invalid input syntax for type uuid: "0"` when it
              // tries to insert it into sales.customer_id.
              const id = row.dataset.cid;
              const name = row.dataset.cname;
              const points = parseInt(row.dataset.cpoints, 10) || 0;
              // Reuse the canonical state-setter so the cart-side
              // picker, loyalty-redemption row, and any other
              // listener stay in sync with the modal selection.
              this.selectCustomer(id, name, points);
              searchEl.classList.add('hidden');
              custResults.style.display = 'none';
              renderCheckoutPill();
            });
          });
        }
        custResults.style.display = 'block';
      } catch (err) {
        console.error('[checkout customer search]', err);
      }
    }, 250));

    // Quick-add escape hatch: closes the modal and jumps to the
    // Customers page so the cashier can create the customer, then
    // come back and re-checkout. (A full inline create-customer form
    // would be ideal but this keeps the surface area small for now.)
    const quickAdd = document.getElementById('checkout-quick-add-customer');
    if (quickAdd) quickAdd.addEventListener('click', (e) => {
      e.preventDefault();
      Utils.closeModal();
      if (typeof App !== 'undefined' && App.navigate) App.navigate('customers');
      else window.location.hash = '#/customers';
    });

    renderCheckoutPill();

    const refreshTotals = () => {
      const amount = parseFloat(amountInput.value) || 0;
      const change = Math.max(0, amount - total);
      const balance = Math.max(0, total - amount);
      changeVal.textContent = Utils.currency(change);
      balanceVal.textContent = Utils.currency(balance);
      // Show the balance row whenever the customer is short — covers
      // both the explicit Credit method and a partial-toggle workflow.
      balanceRow.style.display = balance > 0 ? '' : 'none';
    };

    // Payment method selection
    document.querySelectorAll('.payment-method-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.payment-method-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selectedPaymentMethod = btn.dataset.method;
        SoundManager.beep(); // Sound feedback on selection

        const type = btn.dataset.type;
        const refGroup = document.getElementById('payment-ref-group');

        if (type === 'credit') {
          // Pure credit sale: nothing tendered now, full balance posted
          // to the customer ledger. Hide reference, force amount=0,
          // disable the partial toggle (it's redundant in this mode).
          refGroup.classList.add('hidden');
          amountInput.value = '0.00';
          partialToggle.checked = false;
          partialToggle.disabled = true;
        } else if (type === 'cash') {
          refGroup.classList.add('hidden');
          partialToggle.disabled = false;
          // Reset to full total when leaving Credit, unless the
          // cashier has already opted into a partial amount.
          if (!partialToggle.checked) amountInput.value = total.toFixed(2);
        } else {
          refGroup.classList.remove('hidden');
          partialToggle.disabled = false;
          if (!partialToggle.checked) amountInput.value = total.toFixed(2);
          document.getElementById('payment-reference').focus();
        }
        refreshTotals();
        refreshDueDateVisibility();
      });
    });

    // Partial toggle: when ON, the cashier may enter any amount < total
    // without the "underpayment" guard; when OFF, the amount snaps back
    // to the full total to prevent accidental credit sales.
    partialToggle.addEventListener('change', () => {
      if (!partialToggle.checked) {
        amountInput.value = total.toFixed(2);
      }
      refreshTotals();
      refreshDueDateVisibility();
    });

    // Change calculation
    amountInput.addEventListener('input', () => { refreshTotals(); refreshDueDateVisibility(); });

    // Initial visibility (e.g. if the cart was opened with Credit
    // already pre-selected for some reason)
    refreshDueDateVisibility();

    // Auto-select text on focus
    amountInput.addEventListener('focus', () => amountInput.select());

    // ── Split-tender mode (v1.0.18) ─────────────────────────────────
    // Two coexisting input modes: "single" (legacy: one method + one
    // amount) and "split" (1-4 tender rows summing to total). Toggling
    // hides one block and shows the other; processSale reads whichever
    // is visible to build its payload.
    const splitToggle = document.getElementById('checkout-split-toggle');
    const singleBlock = document.getElementById('single-tender-block');
    const splitBlock = document.getElementById('split-tender-block');
    const splitRowsEl = document.getElementById('split-tender-rows');
    const splitAddBtn = document.getElementById('split-add-tender');
    const splitRemainingPill = document.getElementById('split-remaining-pill');
    const SPLIT_MAX_ROWS = 4;

    // Build the <option>s for the per-row method dropdown once. We
    // exclude pure-credit methods from split tender — splitting K0 of
    // credit doesn't make sense; the cashier should use legacy single
    // mode + Credit method for that.
    const splitMethodOptions = this.paymentMethods
      .filter(pm => pm.type !== 'credit')
      .map(pm => `<option value="${pm.name}" data-type="${pm.type}">${pm.name}</option>`)
      .join('');

    const refreshSplit = () => {
      const rows = splitRowsEl.querySelectorAll('.split-tender-row');
      let sum = 0;
      rows.forEach(r => {
        const a = parseFloat(r.querySelector('.split-amt').value);
        if (Number.isFinite(a)) sum += a;
        // Reveal/hide reference based on selected method type
        const sel = r.querySelector('.split-method');
        const opt = sel.options[sel.selectedIndex];
        const t = opt ? opt.dataset.type : 'cash';
        const refWrap = r.querySelector('.split-ref-wrap');
        refWrap.classList.toggle('hidden', t === 'cash');
      });
      const remaining = parseFloat((total - sum).toFixed(2));
      if (Math.abs(remaining) < 0.01) {
        splitRemainingPill.textContent = 'Balanced ✓';
        splitRemainingPill.setAttribute('data-style', 'padding:.3rem .7rem;border-radius:999px;font-weight:600;background:#dcfce7;color:#166534;');
      } else if (remaining > 0) {
        splitRemainingPill.textContent = `Remaining: ${Utils.currency(remaining)}`;
        splitRemainingPill.setAttribute('data-style', 'padding:.3rem .7rem;border-radius:999px;font-weight:600;background:#fee2e2;color:#991b1b;');
      } else {
        splitRemainingPill.textContent = `Over by: ${Utils.currency(-remaining)}`;
        splitRemainingPill.setAttribute('data-style', 'padding:.3rem .7rem;border-radius:999px;font-weight:600;background:#fef3c7;color:#92400e;');
      }
      splitAddBtn.disabled = rows.length >= SPLIT_MAX_ROWS;
    };

    const addSplitRow = (preset = {}) => {
      const rows = splitRowsEl.querySelectorAll('.split-tender-row');
      if (rows.length >= SPLIT_MAX_ROWS) return;
      // Default the new row's amount to whatever's left so the cashier
      // can usually click "Add tender" + "Confirm" without typing.
      let already = 0;
      rows.forEach(r => { const a = parseFloat(r.querySelector('.split-amt').value); if (Number.isFinite(a)) already += a; });
      const remaining = Math.max(0, parseFloat((total - already).toFixed(2)));
      const initAmt = preset.amount != null ? preset.amount : remaining;
      const initMethod = preset.method || 'Cash';
      const wrap = document.createElement('div');
      wrap.className = 'split-tender-row';
      wrap.setAttribute('data-style', 'display:grid;grid-template-columns:1fr 110px auto;gap:.4rem;align-items:start;margin-bottom:.4rem;');
      wrap.innerHTML = `
        <div>
          <select class="form-control split-method">${splitMethodOptions}</select>
          <div class="split-ref-wrap hidden" data-style="margin-top:.3rem;">
            <input type="text" class="form-control split-ref" placeholder="Transaction ref / Receipt no." data-style="font-size:.85rem;">
          </div>
        </div>
        <input type="number" class="form-control split-amt" step="0.01" min="0" value="${Number(initAmt).toFixed(2)}">
        <button type="button" class="btn btn-sm btn-outline split-remove" data-style="align-self:start;" title="Remove tender">✕</button>
      `;
      splitRowsEl.appendChild(wrap);
      const sel = wrap.querySelector('.split-method');
      sel.value = initMethod;
      // If the seeded method isn't in our filtered list, fall back to
      // the first option so the dropdown stays valid.
      if (sel.value !== initMethod) sel.selectedIndex = 0;
      sel.addEventListener('change', refreshSplit);
      wrap.querySelector('.split-amt').addEventListener('input', refreshSplit);
      wrap.querySelector('.split-remove').addEventListener('click', () => {
        const remaining = splitRowsEl.querySelectorAll('.split-tender-row');
        if (remaining.length <= 1) {
          Utils.toast('At least one tender row is required.', 'warning');
          return;
        }
        wrap.remove();
        refreshSplit();
      });
      refreshSplit();
    };

    splitAddBtn.addEventListener('click', () => addSplitRow());

    splitToggle.addEventListener('click', (e) => {
      e.preventDefault();
      const goingSplit = splitBlock.classList.contains('hidden');
      if (goingSplit) {
        // Entering split mode — seed with one row prefilled to total
        // (Cash, no reference) so a one-click "Confirm" still works.
        splitRowsEl.innerHTML = '';
        addSplitRow({ method: 'Cash', amount: total });
        singleBlock.classList.add('hidden');
        splitBlock.classList.remove('hidden');
        splitToggle.textContent = '× Use single payment method';
        // Split mode is incompatible with the partial-payment flow
        // and the explicit Credit method — both rely on the legacy
        // single-tender controls. Reset partial toggle / amount so
        // when the cashier flips back, nothing is in a weird state.
        if (partialToggle) { partialToggle.checked = false; }
        refreshDueDateVisibility();
      } else {
        splitBlock.classList.add('hidden');
        singleBlock.classList.remove('hidden');
        splitToggle.textContent = '+ Split into multiple payments';
      }
    });

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

    // ── Split-tender path (v1.0.18) ────────────────────────────────
    // When the split block is visible, we read tender rows and POST a
    // `payments: [...]` array. The backend computes paidAmount and
    // payment_method ('Mixed' for >1 method). All other validation
    // mirrors the legacy single-tender flow.
    const splitBlockEl = document.getElementById('split-tender-block');
    const splitMode = splitBlockEl && !splitBlockEl.classList.contains('hidden');
    let splitPayments = null;
    if (splitMode) {
      const rows = document.querySelectorAll('#split-tender-rows .split-tender-row');
      splitPayments = [];
      let sum = 0;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const method = r.querySelector('.split-method').value;
        const amt = parseFloat(r.querySelector('.split-amt').value);
        const refEl = r.querySelector('.split-ref');
        const ref = refEl ? refEl.value.trim() : '';
        const sel = r.querySelector('.split-method');
        const opt = sel.options[sel.selectedIndex];
        const tType = opt ? opt.dataset.type : 'cash';
        if (!Number.isFinite(amt) || amt <= 0) {
          SoundManager.error();
          Utils.toast(`Tender row ${i + 1}: amount must be greater than zero.`, 'warning');
          return;
        }
        if (tType !== 'cash' && !ref) {
          SoundManager.error();
          Utils.toast(`Tender row ${i + 1}: a transaction reference is required for ${method}.`, 'warning');
          if (refEl) refEl.focus();
          return;
        }
        splitPayments.push({ method, amount: parseFloat(amt.toFixed(2)), reference: ref || null });
        sum += amt;
      }
      const diff = parseFloat((sum - total).toFixed(2));
      if (Math.abs(diff) >= 0.01) {
        SoundManager.error();
        Utils.toast(diff > 0
          ? `Split tenders exceed total by ${Utils.currency(diff)}.`
          : `Split tenders are short by ${Utils.currency(-diff)}.`, 'warning');
        return;
      }
    }

    // Read amount tendered without coercing 0 → total (which would
    // silently turn a Credit/Partial sale into a fully-paid one).
    const rawAmount = (document.getElementById('checkout-amount') || {}).value;
    const parsed = parseFloat(rawAmount);
    const amountPaid = splitMode
      ? splitPayments.reduce((s, p) => s + p.amount, 0)
      : ((rawAmount === '' || rawAmount == null || isNaN(parsed)) ? total : parsed);

    const refInput = document.getElementById('payment-reference');
    const paymentReference = refInput ? refInput.value.trim() : null;
    const partialToggle = document.getElementById('checkout-partial-toggle');
    const isPartial = !!(partialToggle && partialToggle.checked) && !splitMode;

    // Validation for non-cash, non-credit methods only — single-tender
    // path only; split tender does its own per-row reference check.
    const selectedMethod = this.paymentMethods.find(pm => pm.name === this.selectedPaymentMethod);
    const methodType = selectedMethod ? selectedMethod.type : 'cash';
    if (!splitMode && methodType !== 'cash' && methodType !== 'credit' && !paymentReference) {
      SoundManager.error();
      Utils.toast('Please enter a transaction reference for non-cash payments.', 'warning');
      refInput.focus();
      return;
    }

    // Guardrail: if the cashier underpays without explicitly opting in
    // (Credit method OR partial-toggle), block — it almost always means
    // they fat-fingered the amount. Credit sales tend to need a customer
    // attached so the balance can be tracked; warn but don't block.
    if (!splitMode && amountPaid < total && methodType !== 'credit' && !isPartial) {
      SoundManager.error();
      Utils.toast(
        'Amount tendered is less than total. Tick "Accept partial payment" or pick the Credit method to record on account.',
        'warning'
      );
      return;
    }
    if ((methodType === 'credit' || (isPartial && amountPaid < total)) && !this.customer) {
      SoundManager.error();
      Utils.toast('Please attach a customer before recording a credit/partial sale so the balance can be tracked.', 'warning');
      // Auto-open the inline picker so the cashier doesn't have to
      // hunt for it — this is the exact friction we just fixed.
      const searchEl = document.getElementById('checkout-customer-search');
      const custInput = document.getElementById('checkout-cust-input');
      if (searchEl) searchEl.classList.remove('hidden');
      if (custInput) custInput.focus();
      return;
    }

    // Read the due-date input only when relevant. Empty / invisible
    // input → leave undefined and let the backend pick the 30-day
    // default. We never block on a missing date because we always
    // have a fallback.
    const dueDateInput = document.getElementById('checkout-due-date');
    const dueDateGroup = document.getElementById('checkout-due-date-group');
    const dueDate = (dueDateGroup && !dueDateGroup.classList.contains('hidden') && dueDateInput && dueDateInput.value)
      ? dueDateInput.value
      : undefined;

    btn.disabled = true;
    btn.textContent = 'Processing...';

    const payload = {
      items: this.cart.map(item => ({
        type: item.type,
        product_id: item.product_id || undefined,
        service_id: item.service_id || undefined,
        quantity: item.quantity
      })),
      payment_method: splitMode ? 'Mixed' : this.selectedPaymentMethod,
      amount_paid: amountPaid,
      payment_reference: splitMode ? null : paymentReference,
      // Split-tender (v1.0.18): when present, the backend computes
      // payment_method/paidAmount/payment_reference from this array.
      ...(splitMode ? { payments: splitPayments } : {}),
      customer_id: this.customer ? this.customer.id : null,
      tax_exempt: !this.taxEnabled,
      discount_amount: this.discountAmount || 0,
      points_redeemed: this.redeemPoints || 0,
      due_date: dueDate,
      transaction_date: new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().replace('T', ' ').slice(0, 19)
    };

    try {
      // API call to create sale
      const sale = await API.post('/sales', payload);
      SoundManager.success();
      Utils.closeModal();
      this.showReceiptModal(sale);
      // Desktop only: pop the till for cash sales (and partial-cash
      // sales). Fire-and-forget — we don't want a missing drawer to
      // break the sale flow.
      if (window.IS_TAURI_DESKTOP && window.ZachiDesktop && /cash/i.test(sale.payment_method || '')) {
        window.ZachiDesktop.openCashDrawer().catch((err) => {
          console.warn('[POS] cash drawer trigger failed:', err);
        });
      }
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
            <button class="modal-close" data-on-click="Utils.closeModal()">✕</button>
          </div>
          <div class="modal-body text-center">
            
            <div class="receipt-success-icon" data-style="${isOffline ? 'background:var(--warning);' : ''}">${icon}</div>
            
            <h2>${title}</h2>
            ${subtext}
            
            <div class="receipt-amount-display">
                ${Utils.currency(sale.total_amount)}
            </div>
    
            ${(Array.isArray(sale.payments) && sale.payments.length > 1) ? `
              <div data-style="background:var(--bg-input);border-radius:var(--radius-md);padding:.6rem .8rem;margin-bottom:1rem;text-align:left;">
                <div data-style="font-size:.78rem;color:var(--text-secondary);margin-bottom:.3rem;font-weight:600;">Tender breakdown</div>
                ${sale.payments.map(p => `
                  <div class="flex justify-between text-sm">
                    <span>${this.getPaymentStyling(p.payment_method, null).icon} ${p.payment_method}${p.payment_reference ? ` <span data-style="color:var(--text-secondary);font-size:.75rem;">(${p.payment_reference})</span>` : ''}</span>
                    <span data-style="font-weight:600;">${Utils.currency(p.amount)}</span>
                  </div>
                `).join('')}
              </div>
            ` : `
              <div class="receipt-method-badge">
                  <span>${styling.icon}</span>
                  <span>Paid via ${sale.payment_method}</span>
              </div>
            `}
    
            <div class="receipt-preview text-left" data-style="background:var(--bg-input);padding:1rem;border-radius:var(--radius-md);margin-bottom:1.5rem;max-height:200px;overflow-y:auto;">
                ${items.map(item => `
                    <div class="flex justify-between text-sm mb-1">
                        <span>${item.quantity}x ${item.name || item.description || 'Item'}</span>
                        <span>${Utils.currency(item.line_total || item.total_price || (item.unit_price * item.quantity))}</span>
                    </div>
                `).join('')}
                <div class="border-t mt-2 pt-2 flex justify-between font-bold">
                    <span>Total</span>
                    <span>${Utils.currency(sale.total_amount)}</span>
                </div>
            </div>
    
            <div class="flex gap-2 justify-center" data-style="flex-wrap:wrap;">
                <button class="btn btn-outline" data-on-click="POS.printReceipt()">
                    🖨 Print
                </button>
                <button class="btn btn-primary" data-on-click="POS.emailReceipt(${isOffline ? "'" + sale.tempId + "'" : sale.sale_id})" ${emailBtnState}>
                    ✉ Email
                </button>
                <button class="btn btn-success" data-on-click="POS.whatsappReceipt(${isOffline ? "'" + sale.tempId + "'" : sale.sale_id})">
                    💬 WhatsApp
                </button>
                <button class="btn btn-outline" data-on-click="POS.smsReceipt(${isOffline ? "'" + sale.tempId + "'" : sale.sale_id})">
                    📱 SMS
                </button>
            </div>

            <button class="btn btn-link mt-4" data-on-click="Utils.closeModal()">Start New Sale</button>
          </div>
        `);

    // Store current sale for printing / WhatsApp / SMS receipt actions
    this.lastSale = sale;
    this.lastSaleItems = items;

    // Flash the customer-facing display with thanks + change due
    try {
      const change = Number(sale.amount_paid || sale.tendered || 0) - Number(sale.total_amount || 0);
      this._pushDisplayThanks(sale, change > 0 ? change : 0);
    } catch (_) { /* ignore */ }
  },

  printReceipt(saleData = null) {
    const sale = saleData || this.lastSale;
    if (!sale) return;
    // Desktop/web use the clean printable iframe (per release scope, no
    // direct ESC/POS from JS). Capacitor goes through the bridge's
    // Printer.print() which handles USB → system print intent → window.print.
    return POS._printReceiptHtml(sale);
  },

  _printReceiptHtml(sale) {
    if (!sale) return;
    // Capacitor native ONLY: route through the bridge's Printer.print()
    // abstraction (USB plugin → system print intent → WebView print).
    // Plain web/desktop go straight to the hidden-iframe path — the
    // bridge installs window.Printer unconditionally but its non-native
    // fallback opens a popup, which is not the desired desktop/web UX.
    const isCapacitorNative =
      (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) ||
      (window.Native && typeof window.Native.isNative === 'function' && window.Native.isNative());
    if (isCapacitorNative && window.Printer && typeof window.Printer.print === 'function') {
      try {
        const html = POS._buildReceiptHtml(sale);
        const ret = window.Printer.print(html);
        if (ret && typeof ret.catch === 'function') {
          ret.catch((e) => {
            console.error('[POS] Printer.print rejected; falling back to iframe', e);
            POS._printViaHiddenIframe(sale);
          });
        }
        return;
      } catch (e) {
        console.error('[POS] Printer.print threw; falling back to iframe', e);
      }
    }
    return POS._printViaHiddenIframe(sale);
  },

  _printViaHiddenIframe(sale) {
    const html = POS._buildReceiptHtml(sale);
    // Hidden iframe path — scoped print dialog, works in browsers + WebViews.
    const existing = document.getElementById('zachi-print-iframe');
    if (existing) existing.remove();
    const iframe = document.createElement('iframe');
    iframe.id = 'zachi-print-iframe';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('tabindex', '-1');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try { iframe.remove(); } catch (_) {}
    };

    // Hard timeout — if print dialog never resolves (e.g., user dismissed,
    // browser doesn't fire onafterprint), still drop the iframe after 60s.
    const hardTimer = setTimeout(cleanup, 60000);
    const finishCleanup = () => { clearTimeout(hardTimer); cleanup(); };

    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) {
        console.error('[POS] iframe contentWindow unavailable; popup fallback');
        finishCleanup();
        POS._printViaPopup(sale);
        return;
      }
      // Tie cleanup to onafterprint when supported (Chrome/Edge/Safari).
      try { win.onafterprint = finishCleanup; } catch (_) {}
      // Defer so logo/fonts settle, then print. Cleanup is driven by
      // onafterprint when the browser fires it, otherwise the 60s hard
      // timer above acts as the safety net — never use a short post-
      // print() timer because print() returns before the dialog
      // resolves on some Android WebViews and would prematurely
      // remove the iframe mid-print.
      setTimeout(() => {
        try {
          win.focus();
          win.print();
        } catch (e) {
          console.error('[POS] iframe print failed; falling back to popup', e);
          finishCleanup();
          POS._printViaPopup(sale);
        }
      }, 250);
    };

    document.body.appendChild(iframe);
    iframe.srcdoc = html;
  },

  _printViaPopup(sale) {
    const html = POS._buildReceiptHtml(sale);
    const win = window.open('', 'Print Receipt', 'width=370,height=700');
    if (!win) {
      if (typeof Utils !== 'undefined' && Utils.toast) {
        Utils.toast('Print blocked. Please allow pop-ups for this site.', 'warning');
      }
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { try { win.print(); } catch (e) { /* ignore */ } }, 400);
  },

  _buildReceiptHtml(sale) {
    // Escape every dynamic field — receipt HTML is rendered same-origin
    // in an iframe/popup, so unescaped store/cashier/item names = XSS.
    const esc = (v) => String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const items = sale.items || [];
    const total = Number(sale.total_amount || 0);
    const paid = Number(sale.amount_paid || total);
    const change = Math.max(0, paid - total);
    const balance = Math.max(0, total - paid);
    const tax = Number(sale.tax_amount || 0);
    const disc = Number(sale.discount_amount || 0);
    const sub = total + disc - tax;
    const method = esc((sale.payment_method || 'Cash').toUpperCase());
    const status = esc((sale.payment_status || (paid >= total ? 'Paid' : (paid > 0 ? 'Partial' : 'Credit'))).toUpperCase());
    const cashier = esc(sale.staff_name || sale.cashier_name || '');
    const saleNumber = esc(sale.sale_number || '');
    const dateStr = esc(new Date(sale.transaction_date || Date.now()).toLocaleString('en-ZM', {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: true
    }));

    const s = (window.App && App.settings) || {};
    const store = {
      name:    esc(s['store.name']    || 'Zachi Computer Centre'),
      address: esc(s['store.address'] || 'Near Coppers Corner, Independence Ave, Solwezi'),
      phone:   esc(s['store.phone']   || '+260 974 210 067'),
      email:   esc(s['store.email']   || 'info@zachicomputercentre.com'),
      tpin:    esc(s['store.tpin']    || ''),
      logo:    esc(s['store.logo_url']|| '/logo.png'),
    };

    // v1.0.31 (Task #57) — Reprintable receipts must show
    // director-removed lines struck through (not omitted) so the
    // customer can see exactly what changed since the original print.
    // Caption beneath the struck line shows actor + date + reason.
    const itemRows = items.map(item => {
      const qty = item.quantity || 1;
      const price = Number(item.unit_price || 0);
      const lineT = Number(item.line_total || item.total_price || (price * qty));
      const name = esc(item.name || item.description || 'Item');
      const isRemoved = !!item.removed_at;
      const rowStyle = isRemoved
        ? 'margin:3px 0;border-bottom:1px dotted #ccc;padding-bottom:3px;text-decoration:line-through;color:#666;'
        : 'margin:3px 0;border-bottom:1px dotted #ccc;padding-bottom:3px;';
      const removedNote = isRemoved
        ? `<div data-style="font-size:9px;color:#a00;text-decoration:none;padding-left:8px;">Removed${item.removed_by_name ? ' by ' + esc(item.removed_by_name) : ''}${item.removed_at ? ' on ' + esc(new Date(item.removed_at).toLocaleString()) : ''}${item.removed_reason ? ' — ' + esc(item.removed_reason) : ''}</div>`
        : '';
      return `<div data-style="${rowStyle}">`
        + `<div data-style="font-size:10.5px;">${name}</div>`
        + `<div data-style="display:flex;justify-content:space-between;font-size:10.5px;padding-left:8px;">`
        + `<span>${esc(String(qty))} &times; K${price.toFixed(2)}</span><span>K ${lineT.toFixed(2)}</span>`
        + `</div>${removedNote}</div>`;
    }).join('');


    return `<!DOCTYPE html>
<html>
<head>
  <title>Receipt ${saleNumber}</title>
  <style>
    /* ─── 80mm Thermal Paper ─── */
    @page {
      size: 80mm auto;
      margin: 0;
    }
    * { box-sizing: border-box; }
    html, body {
      width: 80mm;
      margin: 0;
      padding: 4mm 4mm 6mm;
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px;
      color: #000;
      background: #fff;
    }
    .center  { text-align: center; }
    .right   { text-align: right; }
    .bold    { font-weight: bold; }
    .large   { font-size: 14px; }
    .xlarge  { font-size: 18px; font-weight: bold; }
    .small   { font-size: 9px; }
    .logo    { max-width: 70px; height: auto; margin-bottom: 6px; }
    .hr-solid  { border: none; border-top: 1px solid #000; margin: 6px 0; }
    .hr-dashed { border: none; border-top: 1px dashed #000; margin: 6px 0; }
    .row     { display: flex; justify-content: space-between; margin: 2px 0; }
    .row.bold { font-weight: bold; }
    .item-row { white-space: pre; font-size: 10.5px; line-height: 1.35; }
    .total-box {
      border: 1px solid #000;
      padding: 4px 6px;
      margin: 6px 0;
      font-size: 15px;
      font-weight: bold;
    }
    .sale-number {
      font-size: 10px;
      letter-spacing: 2px;
      border: 1px dashed #555;
      padding: 3px 6px;
      display: inline-block;
      margin: 4px 0;
    }
    .footer-msg {
      font-size: 9.5px;
      text-align: center;
      margin-top: 8px;
      line-height: 1.5;
    }
    @media print {
      html, body { width: 80mm; }
      button { display: none; }
    }
  </style>
</head>
<body>

  <!-- ── HEADER ── -->
  <div class="center">
    <img src="${store.logo}" class="logo" alt="Logo" onerror="this.style.display='none'"><br>
    <span class="xlarge">${store.name.toUpperCase ? store.name.toUpperCase() : store.name}</span><br>
    ${store.address ? `<span>${store.address}</span><br>` : ''}
    ${store.phone   ? `<span>Tel: ${store.phone}</span><br>` : ''}
    ${store.email   ? `<span>${store.email}</span><br>` : ''}
    ${store.tpin    ? `<span>TPIN: ${store.tpin}</span>` : ''}
  </div>

  <hr class="hr-solid">

  <!-- ── RECEIPT TYPE ── -->
  <div class="center bold large">${sale.is_offline ? '*** OFFLINE RECEIPT ***' : 'OFFICIAL RECEIPT'}</div>

  <hr class="hr-dashed">

  <!-- ── METADATA ── -->
  <div class="row"><span>Date:</span><span>${dateStr}</span></div>
  ${cashier ? `<div class="row"><span>Cashier:</span><span>${cashier}</span></div>` : ''}
  <div class="center"><span class="sale-number">${saleNumber}</span></div>

  <hr class="hr-dashed">

  <!-- ── ITEMS ── -->
  ${itemRows}

  <hr class="hr-solid">

  <!-- ── TOTALS ── -->
  ${sub > 0 ? `<div class="row"><span>Subtotal</span><span>K ${sub.toFixed(2)}</span></div>` : ''}
  ${disc > 0 ? `<div class="row"><span>Discount</span><span>- K ${disc.toFixed(2)}</span></div>` : ''}

  <div class="total-box row">
    <span>TOTAL</span><span>K ${total.toFixed(2)}</span>
  </div>

  ${(Array.isArray(sale.payments) && sale.payments.length > 1) ? `
    <div data-style="margin:4px 0;font-size:10.5px;font-weight:bold;">TENDERS</div>
    ${sale.payments.map(p => `
      <div class="row"><span>${esc(String(p.payment_method))}${p.payment_reference ? ` <span class="small">(${esc(String(p.payment_reference))})</span>` : ''}</span><span>K ${Number(p.amount).toFixed(2)}</span></div>
    `).join('')}
    <div class="row bold"><span>TOTAL TENDERED</span><span>K ${paid.toFixed(2)}</span></div>
  ` : `<div class="row"><span>${method}</span><span>K ${paid.toFixed(2)}</span></div>`}
  ${change > 0 ? `<div class="row bold"><span>CHANGE DUE</span><span>K ${change.toFixed(2)}</span></div>` : ''}
  ${balance > 0 ? `
    <div class="row bold" data-style="color:#a00;"><span>BALANCE DUE</span><span>K ${balance.toFixed(2)}</span></div>
    <div class="center bold" data-style="margin-top:4px;border:1px solid #a00;padding:2px;font-size:11px;">*** ${status} — ON ACCOUNT ***</div>
  ` : ''}

  <hr class="hr-dashed">

  <!-- ── FOOTER ── -->
  <div class="footer-msg">
    Thank you for shopping at Zachi Computer Centre!<br>
    Goods sold are NOT returnable unless defective.<br>
    Exchange only within 7 days with receipt.<br>
    <span class="small">Printed: ${new Date().toLocaleString()}</span>
  </div>

  <!-- Auto-print fires from parent; manual fallback via browser File>Print -->

</body>
</html>`;
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

  // Build a plain-text receipt summary suitable for WhatsApp / SMS body.
  // Kept short (under ~600 chars) so SMS doesn't get split into many parts.
  // The companion PDF link (when `pdfUrl` is supplied) sits at the bottom so
  // the customer can tap it from WhatsApp to download the full receipt.
  _receiptText(sale, pdfUrl = '') {
    const settings = (window.App && App.settings) || {};
    const storeName = settings['store.name'] || 'Zachi Computer Centre';
    const storePhone = settings['store.phone'] || '';

    const items = (sale.items || sale.sale_items || this.lastSaleItems || [])
      .map((it) => {
        const name = (it.name || it.description || 'Item').toString();
        const qty = Number(it.quantity || it.qty || 1);
        const total = Number(it.line_total || it.total_price || (it.unit_price || 0) * qty);
        return `${qty}x ${name} - ${Utils.currency(total)}`;
      })
      .slice(0, 12);

    const total = Number(sale.total_amount || 0);
    const paid  = Number(sale.amount_paid || total);
    const balance = Math.max(0, total - paid);
    const status = sale.payment_status || (paid >= total ? 'Paid' : (paid > 0 ? 'Partial' : 'Credit'));
    const staff = sale.staff_name || sale.cashier_name || '';

    const lines = [
      `*${storeName}*`,
      `Receipt #${sale.sale_number || sale.sale_id}`,
      `Date: ${new Date(sale.transaction_date || Date.now()).toLocaleString()}`,
      staff ? `Served by: ${staff}` : '',
      ``,
      ...items,
      ``,
      `*Total: ${Utils.currency(total)}*`,
      ...((Array.isArray(sale.payments) && sale.payments.length > 1)
        ? sale.payments.map(p => `  • ${p.payment_method}${p.payment_reference ? ' (' + p.payment_reference + ')' : ''}: ${Utils.currency(p.amount)}`)
        : [`Paid (${sale.payment_method || 'Cash'}): ${Utils.currency(paid)}`]),
      balance > 0 ? `*Balance Due: ${Utils.currency(balance)}* (${status})` : `Status: Paid in full`,
      ``,
      pdfUrl ? `Receipt PDF: ${pdfUrl}` : '',
      `Thank you for your business!`,
      storePhone ? `Contact: ${storePhone}` : '',
    ].filter(Boolean);
    return lines.join('\n');
  },

  // Normalise a phone number to international E.164-ish form for wa.me links.
  // Strips spaces, dashes, parens and a leading '+'.
  _waNumber(raw) {
    return String(raw || '').replace(/[^\d]/g, '');
  },

  // Try the server-side messaging gateway first; if it isn't configured,
  // (or it returns no_provider / no_webhook_url) fall back to the device
  // SMS / WhatsApp app via Native.openExternal so a sale never gets
  // stuck waiting on missing config.
  async _gatewayStatus() {
    if (this.__gwCache && (Date.now() - this.__gwCache.t) < 60000) return this.__gwCache.s;
    try {
      const s = await API.get('/messaging/status');
      this.__gwCache = { t: Date.now(), s };
      return s;
    } catch (_) {
      return { sms: { configured: false }, whatsapp: { configured: false } };
    }
  },

  async _gatewaySend(channel, payload) {
    try {
      const r = await API.post('/messaging/' + channel, payload);
      return !!(r && r.ok);
    } catch (_) {
      return false;
    }
  },

  async whatsappReceipt(saleId) {
    const sale = this.lastSale || {};
    if (!sale.sale_number && !sale.sale_id) {
      Utils.toast('No active sale to send', 'warning');
      return;
    }
    // Default to the customer attached to the sale, fall back to a manual prompt
    let phone = (sale.customer_phone || (this.customer && this.customer.phone) || '').toString();
    if (!phone) {
      phone = await Utils.prompt('Customer WhatsApp number (with country code, e.g. +260...):', {
        title: 'Send via WhatsApp',
        placeholder: '+260...',
        type: 'primary'
      });
    }
    if (!phone) return;
    const num = this._waNumber(phone);
    if (num.length < 7) {
      Utils.toast('Invalid phone number', 'warning');
      return;
    }

    // Mint a signed, public PDF receipt URL (auth-free for 7 days) so
    // the customer can tap it from WhatsApp and download a branded PDF.
    // The mint call has been hoisted into a *non-blocking* race against the
    // gateway path so a slow link-mint doesn't stall the cashier — if the
    // PDF URL isn't ready in 1500ms we send the plain-text receipt and
    // continue.
    const targetId = sale.sale_id || saleId;
    let pdfUrl = '';
    if (targetId && !sale.is_offline) {
      try {
        pdfUrl = await Promise.race([
          API.get(`/sales/${targetId}/receipt-link`).then((l) => (l && l.url) || ''),
          new Promise((resolve) => setTimeout(() => resolve(''), 1500)),
        ]);
      } catch (err) {
        console.warn('[POS] PDF receipt link mint failed:', err);
      }
    }

    const bodyText = this._receiptText(sale, pdfUrl);

    // Prefer the configured WhatsApp gateway when present; otherwise open wa.me.
    try {
      const status = await this._gatewayStatus();
      if (status.whatsapp && status.whatsapp.configured) {
        Utils.toast('Sending WhatsApp via gateway…', 'info');
        const ok = await this._gatewaySend('whatsapp', {
          to: '+' + num,
          body: bodyText,
          subject: `Receipt ${sale.sale_number || ''}`.trim(),
          meta: { sale_id: targetId || null, pdf_url: pdfUrl || null },
        });
        if (ok) {
          SoundManager.success();
          Utils.toast('WhatsApp sent', 'success');
          return;
        }
        Utils.toast('Gateway send failed — opening WhatsApp app instead.', 'warning');
      }
    } catch (e) {
      console.warn('[POS] WhatsApp gateway error, falling back to wa.me:', e);
    }

    const url = `https://wa.me/${num}?text=${encodeURIComponent(bodyText)}`;
    try {
      const ok = await window.Native.openExternal(url);
      if (ok) {
        SoundManager.success();
        Utils.toast(pdfUrl ? 'Opening WhatsApp with PDF receipt link…' : 'Opening WhatsApp…', 'success');
      } else {
        Utils.toast('Could not open WhatsApp', 'error');
      }
    } catch (e) {
      Utils.toast('Could not open WhatsApp', 'error');
    }
  },

  async smsReceipt(saleId) {
    const sale = this.lastSale || {};
    if (!sale.sale_number && !sale.sale_id) {
      Utils.toast('No active sale to send', 'warning');
      return;
    }
    let phone = (sale.customer_phone || (this.customer && this.customer.phone) || '').toString();
    if (!phone) {
      phone = await Utils.prompt('Customer phone number:', {
        title: 'Send via SMS',
        placeholder: '+260...',
        type: 'primary'
      });
    }
    if (!phone) return;
    const bodyText = this._receiptText(sale);

    // Prefer the configured SMS gateway when present; otherwise open the device sms: app.
    try {
      const status = await this._gatewayStatus();
      if (status.sms && status.sms.configured) {
        Utils.toast('Sending SMS via gateway…', 'info');
        const ok = await this._gatewaySend('sms', {
          to: phone,
          body: bodyText,
          subject: `Receipt ${sale.sale_number || ''}`.trim(),
          meta: { sale_id: sale.sale_id || saleId || null },
        });
        if (ok) {
          SoundManager.success();
          Utils.toast('SMS sent', 'success');
          return;
        }
        Utils.toast('Gateway send failed — opening SMS app instead.', 'warning');
      }
    } catch (e) {
      console.warn('[POS] SMS gateway error, falling back to sms: URI:', e);
    }

    // sms: URI works on Android, iOS, and most desktop OS handlers.
    const body = encodeURIComponent(bodyText);
    const url = `sms:${phone}?body=${body}`;
    try {
      const ok = await window.Native.openExternal(url);
      if (ok) Utils.toast('Opening SMS…', 'info');
      else Utils.toast('Could not open SMS app', 'error');
    } catch (e) {
      Utils.toast('Could not open SMS app', 'error');
    }
  },

  // Push the current cart to the customer-facing display(s) over SSE.
  // Best-effort: never blocks the cashier UI on a network hiccup.
  // Computes totals freshly from cart + active discount/tax state so the
  // display always matches what the cashier sees.
  _pushToDisplay(extra = {}) {
    if (typeof API === 'undefined' || !API.post) return;
    const subtotal = this.cart.reduce(
      (s, it) => s + (Number(it.unit_price) * Number(it.quantity)),
      0
    );
    const pointsValue = Number(this.redeemPoints || 0) * 1.0;
    const totalDiscount = Number(this.discountAmount || 0) + pointsValue;
    const taxable = Math.max(0, subtotal - totalDiscount);
    const tax = this.taxEnabled ? taxable * Number(this.taxRate || 0) : 0;
    const total = taxable + tax;

    const payload = {
      terminal: localStorage.getItem('display_terminal') || 'main',
      items: this.cart.map((it) => ({
        name: it.name,
        qty: it.quantity,
        price: it.unit_price,
        line_total: Number(it.unit_price) * Number(it.quantity)
      })),
      subtotal,
      tax,
      discount: totalDiscount,
      total,
      customer: this.customer ? { name: this.customer.name } : null,
      ...extra
    };
    // API.post auto-prepends /api, so use the bare path.
    Promise.resolve(API.post('/display/cart', payload)).catch(() => {});
  },

  _pushDisplayThanks(sale, change = 0) {
    if (typeof API === 'undefined' || !API.post) return;
    Promise.resolve(API.post('/display/thanks', {
      terminal: localStorage.getItem('display_terminal') || 'main',
      total: Number(sale.total_amount || 0),
      change: Number(change || 0),
      sale_number: sale.sale_number || null
    })).catch(() => {});
    // After 7 seconds the display auto-resets to welcome — also send an
    // explicit welcome so a new sale can start clean even if the user is
    // quick.
    setTimeout(() => {
      Promise.resolve(API.post('/display/welcome', {
        terminal: localStorage.getItem('display_terminal') || 'main'
      })).catch(() => {});
    }, 7000);
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
            <select id="scanner-camera-select" class="form-control" data-style="width:100%; margin-bottom: 10px;">
                <option value="" disabled selected>Loading cameras...</option>
            </select>
        </div>
        <div id="scanner-container" data-style="width: 100%; height: 300px; background: #000; position: relative;"></div>
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

    // Initialize scanner. setTimeout(0) lets the modal DOM paint before
    // we try to attach the <video> to #scanner-container.
    setTimeout(async () => {
      if (!window.Scanner) {
        console.error('Scanner module not loaded');
        Utils.toast('Scanner not available', 'error');
        return;
      }

      const onScanSuccess = (code) => {
        if (!document.getElementById('modal-overlay').classList.contains('hidden')) {
          SoundManager.beep();
          closeScanner();
          this.handleScanResult(code);
        }
      };
      const onScanError = (_err) => {
        // Per-frame detect errors are logged inside Scanner.start(); ignore here.
      };

      // On native (Capacitor), Scanner.init is overridden in
      // capacitor-bridge.js to call the OS-level barcode scanner —
      // that promise only resolves AFTER the user scans (or cancels),
      // and there is no in-modal <video> or camera-list to populate.
      // Hide the dropdown, fire-and-forget the native scan, and let
      // the user-cancel path settle quietly. We must NOT await it
      // here or the modal would freeze until the scan completes.
      const cameraSelect = document.getElementById('scanner-camera-select');
      if (window.Scanner._native) {
        if (cameraSelect) cameraSelect.parentElement.classList.add('hidden');
        Promise.resolve(
          window.Scanner.init('scanner-container', onScanSuccess, (err) => {
            // The native plugin rejects on user cancel; that's not an
            // error we want to surface. Only show real failures.
            const msg = (err && (err.message || String(err))) || '';
            if (!/cancel/i.test(msg)) Utils.toast('Scanner: ' + msg, 'error');
          })
        ).catch(() => {});
        return;
      }

      try {
        // Web path: AWAIT init so the rear-facing auto-start completes
        // before we touch the camera list. Without the await, getCameras()
        // raced init's getUserMedia and we ended up calling start() twice
        // in quick succession (visible flicker / occasional permission prompt).
        await window.Scanner.init('scanner-container', onScanSuccess, onScanError);

        // List cameras for the dropdown so the cashier can pick a
        // different one if the rear-facing default is wrong (e.g. on a
        // laptop with two USB webcams). We DO NOT restart capture here —
        // init already started the rear camera; we only restart on
        // explicit user change below.
        const cameras = await window.Scanner.getCameras();
        if (cameras && cameras.length > 0) {
          cameraSelect.innerHTML = cameras
            .map((c) => `<option value="${c.id}">${c.label || 'Camera ' + c.id}</option>`)
            .join('');
          const back = cameras.find(
            (c) =>
              (c.label || '').toLowerCase().includes('back') ||
              (c.label || '').toLowerCase().includes('environment')
          );
          cameraSelect.value = back ? back.id : cameras[0].id;
          cameraSelect.onchange = async () => {
            try {
              await window.Scanner.start(cameraSelect.value);
            } catch (err) {
              Utils.toast('Could not switch camera: ' + (err.message || err), 'error');
            }
          };
        } else {
          cameraSelect.innerHTML = '<option value="">Default camera</option>';
        }
      } catch (err) {
        console.error('Scanner init error:', err);
        // Surface a clear, actionable message. Permission denied is the
        // most common cause inside an iframe — point the user at a USB
        // scanner / manual entry as a graceful fallback.
        const msg =
          err && err.name === 'NotAllowedError'
            ? 'Camera permission denied. Use a USB barcode scanner or type the SKU into the search bar and press Enter.'
            : 'Could not start camera scanner: ' + (err && err.message ? err.message : err);
        Utils.toast(msg, 'error');
        if (cameraSelect) cameraSelect.innerHTML = '<option value="">Camera unavailable</option>';
      }
    }, 0);
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
            <button class="modal-close" data-on-click="Utils.closeModal()">✕</button>
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
            <button class="modal-close" data-on-click="Utils.closeModal()">✕</button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label>Amount</label>
                <input type="number" id="curr-amount" class="form-control" value="1" min="0" step="0.01" data-on-input="POS.calcCurrency()">
            </div>
            <div class="form-row" data-style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-top:1rem;">
                <div class="form-group">
                    <label>From</label>
                    <select id="curr-from" class="form-control" data-on-change="POS.calcCurrency()">
                        <option value="ZMW">ZMW (K)</option>
                        <option value="USD">USD ($)</option>
                        <option value="ZAR">ZAR (R)</option>
                        <option value="GBP">GBP (£)</option>
                        <option value="EUR">EUR (€)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>To</label>
                    <select id="curr-to" class="form-control" data-on-change="POS.calcCurrency()">
                        <option value="ZMW">ZMW (K)</option>
                        <option value="USD" selected>USD ($)</option>
                        <option value="ZAR">ZAR (R)</option>
                        <option value="GBP">GBP (£)</option>
                        <option value="EUR">EUR (€)</option>
                    </select>
                </div>
            </div>
            <div class="result-box" data-style="background:#f8fafc; padding:1.5rem; text-align:center; border:1px solid #e2e8f0; border-radius:8px; margin-top:1rem;">
                <div id="curr-result" data-style="font-size:2rem; font-weight:800; color:var(--primary); line-height:1.2;">0.00</div>
                <div id="curr-rate" data-style="font-size:0.85rem; color:var(--text-muted); margin-top:0.5rem;">Rate: 1 = 1</div>
            </div>
            <div data-style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;font-size:0.78rem;color:var(--text-muted);gap:1rem;flex-wrap:wrap;">
                <div id="curr-meta" data-style="line-height:1.4;">Source: …</div>
                ${this._isDirector() ? `<button class="btn btn-sm btn-secondary" data-on-click="POS.refreshRates()">
                    <i class="fas fa-sync-alt"></i> Refresh
                </button>` : ''}
            </div>
        </div>
    `);
    this.calcCurrency();
    this._renderRateMeta();
  },

  _isDirector() {
    try {
      const u = Utils.getUser();
      return !!u && u.role === 'director';
    } catch (_) { return false; }
  },

  _renderRateMeta() {
    const el = document.getElementById('curr-meta');
    if (!el) return;
    const m = this.exchangeRatesMeta || {};
    const src = m.source || 'unknown';
    const updated = m.last_updated ? new Date(m.last_updated).toLocaleString() : 'never';
    const overrides = (m.override_codes && m.override_codes.length)
        ? ` · Overrides: ${m.override_codes.join(', ')}`
        : '';
    const stale = m.stale ? ' <span data-style="color:#b91c1c;font-weight:600;">(stale — refresh)</span>' : '';
    el.innerHTML = `Source: <strong>${src}</strong> · Base USD · Updated ${updated}${overrides}${stale}`;
  },

  async refreshRates() {
    const btn = document.querySelector('[data-on-click="POS.refreshRates()"]');
    if (btn) btn.disabled = true;
    try {
      await this.fetchExchangeRates(true);
      this.calcCurrency();
      this._renderRateMeta();
      Utils.toast('Exchange rates refreshed.', 'success');
    } catch (e) {
      Utils.toast('Refresh failed: ' + (e.message || e), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
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

  exchangeRatesMeta: null,

  async fetchExchangeRates(force = false) {
    // Route through the API client so Capacitor / Tauri builds with a
    // remote backend URL still hit the configured backend (not the
    // WebView origin).
    const data = await API.get(force ? '/currency?refresh=1' : '/currency');
    if (data && data.ZMW) {
      const { _meta, ...rates } = data;
      this.exchangeRates = rates;
      this.exchangeRatesMeta = _meta || null;
    }
  },

  _currencySymbol(code) {
    return ({ ZMW: 'K', USD: '$', ZAR: 'R', GBP: '£', EUR: '€' })[code] || code;
  },

  calcCurrency() {
    const amount = parseFloat(document.getElementById('curr-amount').value) || 0;
    const from = document.getElementById('curr-from').value;
    const to = document.getElementById('curr-to').value;

    const rateFrom = this.exchangeRates[from] || 1; // Units per USD
    const rateTo = this.exchangeRates[to] || 1;     // Units per USD

    // From -> USD -> To
    const result = (amount / rateFrom) * rateTo;
    document.getElementById('curr-result').textContent = Utils.currency(result, this._currencySymbol(to));

    const oneUnitRate = (1 / rateFrom) * rateTo;
    document.getElementById('curr-rate').textContent = `1 ${from} ≈ ${oneUnitRate.toFixed(4)} ${to}`;
  },

  showCalculatorModal() {
    Utils.showModal(`
        <div class="modal-header">
            <h3>🧮 Calculator</h3>
            <button class="modal-close" data-on-click="Utils.closeModal()">✕</button>
        </div>
        <div class="modal-body">
            <input type="text" id="calc-display" class="calc-display" readonly value="0">
            <div class="calc-grid">
                <button class="calc-btn clear" data-on-click="POS.calcClear()">AC</button>
                <button class="calc-btn operator" data-on-click="POS.calcAppend('/')">÷</button>
                <button class="calc-btn operator" data-on-click="POS.calcAppend('*')">×</button>
                <button class="calc-btn" data-on-click="POS.calcAppend('7')">7</button>
                <button class="calc-btn" data-on-click="POS.calcAppend('8')">8</button>
                <button class="calc-btn" data-on-click="POS.calcAppend('9')">9</button>
                <button class="calc-btn operator" data-on-click="POS.calcAppend('-')">−</button>
                <button class="calc-btn" data-on-click="POS.calcAppend('4')">4</button>
                <button class="calc-btn" data-on-click="POS.calcAppend('5')">5</button>
                <button class="calc-btn" data-on-click="POS.calcAppend('6')">6</button>
                <button class="calc-btn operator" data-on-click="POS.calcAppend('+')">+</button>
                <button class="calc-btn" data-on-click="POS.calcAppend('1')">1</button>
                <button class="calc-btn" data-on-click="POS.calcAppend('2')">2</button>
                <button class="calc-btn" data-on-click="POS.calcAppend('3')">3</button>
                <button class="calc-btn equal" data-on-click="POS.calcResult()">=</button>
                <button class="calc-btn" data-on-click="POS.calcAppend('0')">0</button>
                <button class="calc-btn" data-on-click="POS.calcAppend('.')">.</button>
            </div>
            <button class="btn btn-outline btn-full mt-4" data-on-click="POS.calcUseResult()">Use Result</button>
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
