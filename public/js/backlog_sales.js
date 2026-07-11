/**
 * Zachi Smart-POS — Backlog Sales Entry
 * Director-only: Direct entry or bulk CSV upload of historical sales.
 */
const BacklogSales = {
    _products: [],
    _services: [],
    _customers: [],
    _csvData: [],

    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">
                        <span class="material-icons-outlined" data-style="vertical-align:middle;margin-right:6px;font-size:1.4rem;">history</span>
                        Backlog Sales Entry
                    </h1>
                    <p class="text-secondary">Record historical sales not captured in real time.</p>
                </div>
            </div>

            <div data-style="background:linear-gradient(135deg,rgba(124,58,237,.08),rgba(27,58,92,.06));border:1px solid rgba(124,58,237,.3);border-radius:10px;padding:14px 18px;margin-bottom:20px;display:flex;gap:12px;align-items:flex-start;">
                <span class="material-icons-outlined" data-style="color:#7c3aed;margin-top:2px;flex-shrink:0;">warning_amber</span>
                <div class="text-sm">
                    <strong>Director Access Only</strong> — Backlog entries post to the historical date you specify.
                    Stock adjustment is <strong>skipped by default</strong> since inventory was already depleted at the time of the original sale.
                </div>
            </div>

            <div class="card overflow-hidden">
                <div class="premium-tab-nav bg-surface">
                    <div class="premium-tab-item active" data-tab="direct" data-on-click="BacklogSales.switchTab('direct')">
                        <span class="material-icons-outlined" data-style="font-size:16px;">edit_note</span>
                        <span>Direct Entry</span>
                    </div>
                    <div class="premium-tab-item" data-tab="bulk" data-on-click="BacklogSales.switchTab('bulk')">
                        <span class="material-icons-outlined" data-style="font-size:16px;">upload_file</span>
                        <span>Bulk CSV Upload</span>
                    </div>
                </div>

                <!-- ── DIRECT ENTRY TAB ── -->
                <div id="backlog-tab-direct" class="card-body p-6">
                    <div data-style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:860px;margin-bottom:24px;">
                        <div class="form-group">
                            <label class="form-label">Sale Date &amp; Time <span class="text-danger">*</span></label>
                            <input type="datetime-local" id="bl-date" class="form-input" max="${this._maxDateTime()}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Customer (optional)</label>
                            <select id="bl-customer" class="form-select">
                                <option value="">— Walk-in / No Customer —</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Payment Method <span class="text-danger">*</span></label>
                            <select id="bl-payment" class="form-select">
                                <option value="Cash">Cash</option>
                                <option value="EFT">EFT (Bank Transfer)</option>
                                <option value="Airtel_Money">Airtel Money</option>
                                <option value="MTN_Money">MTN Money</option>
                                <option value="Bank">Bank Deposit</option>
                                <option value="Card">Card</option>
                                <option value="Credit">Credit (Pay Later)</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Payment Reference</label>
                            <input type="text" id="bl-ref" class="form-input" placeholder="e.g. TXN123456">
                        </div>
                        <div class="form-group" data-style="grid-column:1/-1;">
                            <label class="form-label">Notes</label>
                            <input type="text" id="bl-notes" class="form-input" placeholder="e.g. Backlog entry — lost receipt">
                        </div>
                        <div class="form-group" data-style="grid-column:1/-1;display:flex;gap:28px;align-items:center;">
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" id="bl-tax-exempt">
                                <span class="text-sm">Tax Exempt (skip 16% VAT)</span>
                            </label>
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" id="bl-skip-stock" checked>
                                <span class="text-sm">Skip stock adjustment <em class="text-secondary">(recommended)</em></span>
                            </label>
                        </div>
                    </div>

                    <!-- Items toolbar -->
                    <div class="flex items-center justify-between mb-3">
                        <h3 class="font-bold">Line Items</h3>
                        <div class="flex gap-2">
                            <button class="btn btn-sm btn-outline" data-on-click="BacklogSales.addItem('product')">
                                <span class="material-icons-outlined" data-style="font-size:15px;vertical-align:middle;">inventory_2</span> Product
                            </button>
                            <button class="btn btn-sm btn-outline" data-on-click="BacklogSales.addItem('service')">
                                <span class="material-icons-outlined" data-style="font-size:15px;vertical-align:middle;">build</span> Service
                            </button>
                            <button class="btn btn-sm btn-outline" data-on-click="BacklogSales.addItem('custom')">
                                <span class="material-icons-outlined" data-style="font-size:15px;vertical-align:middle;">add</span> Custom
                            </button>
                        </div>
                    </div>

                    <div data-style="overflow:auto;border:1px solid var(--color-border);border-radius:8px;min-height:72px;">
                        <table class="table w-full">
                            <thead data-style="position:sticky;top:0;z-index:5;background:var(--color-surface,#fff);">
                                <tr>
                                    <th data-style="width:100px;">Type</th>
                                    <th>Description / Item</th>
                                    <th data-style="width:88px;" class="text-right">Qty</th>
                                    <th data-style="width:120px;" class="text-right">Unit Price (K)</th>
                                    <th data-style="width:110px;" class="text-right">Line Total</th>
                                    <th data-style="width:40px;"></th>
                                </tr>
                            </thead>
                            <tbody id="bl-items-body">
                                <tr id="bl-no-items">
                                    <td colspan="6" class="text-center text-secondary py-8">
                                        Click a button above to add items.
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Totals -->
                    <div data-style="display:flex;justify-content:flex-end;margin-top:16px;">
                        <div data-style="min-width:250px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;padding:14px 18px;">
                            <div data-style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:.9rem;">
                                <span class="text-secondary">Subtotal</span><span id="bl-subtotal">K 0.00</span>
                            </div>
                            <div data-style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:.9rem;">
                                <span class="text-secondary">Tax (16%)</span><span id="bl-tax">K 0.00</span>
                            </div>
                            <div data-style="display:flex;justify-content:space-between;font-size:1.1rem;font-weight:700;border-top:1px solid var(--color-border);padding-top:10px;margin-top:6px;">
                                <span>Total</span><span id="bl-total" class="text-primary">K 0.00</span>
                            </div>
                        </div>
                    </div>

                    <div data-style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
                        <button class="btn btn-outline" data-on-click="BacklogSales.resetDirect()">Reset</button>
                        <button id="bl-submit-btn" class="btn btn-primary" data-on-click="BacklogSales.submitDirect()">
                            <span class="material-icons-outlined" data-style="font-size:16px;vertical-align:middle;">save</span>
                            Save Backlog Sale
                        </button>
                    </div>
                </div>

                <!-- ── BULK UPLOAD TAB ── -->
                <div id="backlog-tab-bulk" class="card-body p-6 hidden">
                    <div data-style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
                        <div>
                            <h3 class="font-bold mb-1">CSV Bulk Import</h3>
                            <p class="text-secondary text-sm">Upload a CSV file — each row is one sale. Items use pipe separator within the items column.</p>
                            <p class="text-secondary text-sm mt-1">Format: <code>Printing Paper x2 @45.00|Binding x1 @20.00</code></p>
                        </div>
                        <button class="btn btn-outline" data-style="flex-shrink:0;" data-on-click="BacklogSales.downloadTemplate()">
                            <span class="material-icons-outlined" data-style="font-size:15px;vertical-align:middle;">download</span>
                            Download Template
                        </button>
                    </div>

                    <!-- Drop zone -->
                    <div id="bl-dropzone"
                        data-style="border:2px dashed var(--color-border);border-radius:10px;padding:44px 20px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s;margin-bottom:20px;"
                        data-on-click="Dom.clickById('bl-csv-input')"
                        data-on-dragover="BacklogSales.onDragOver($event, $el)"
                        data-on-dragleave="BacklogSales.onDragLeave($el)"
                        data-on-drop="BacklogSales.onDrop($event, $el)">
                        <span class="material-icons-outlined" data-style="font-size:52px;color:var(--color-secondary);display:block;margin-bottom:10px;">upload_file</span>
                        <p class="font-bold">Drop CSV file here or click to browse</p>
                        <p class="text-secondary text-sm">Accepts .csv files</p>
                        <input type="file" id="bl-csv-input" accept=".csv" data-style="display:none;"
                            data-on-change="BacklogSales.handleCSVFile($files0)">
                    </div>

                    <!-- Preview -->
                    <div id="bl-csv-preview" class="hidden">
                        <div data-style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                            <h4 class="font-bold" id="bl-csv-summary">0 rows</h4>
                            <div class="flex gap-2">
                                <button class="btn btn-outline btn-sm" data-on-click="BacklogSales.clearCSV()">Clear</button>
                                <button id="bl-import-btn" class="btn btn-primary btn-sm" data-on-click="BacklogSales.submitBulk()">
                                    <span class="material-icons-outlined" data-style="font-size:15px;vertical-align:middle;">cloud_upload</span>
                                    Import
                                </button>
                            </div>
                        </div>
                        <div data-style="overflow:auto;max-height:300px;border:1px solid var(--color-border);border-radius:8px;">
                            <table class="table w-full text-sm" id="bl-csv-table"></table>
                        </div>
                    </div>

                    <!-- Results -->
                    <div id="bl-import-results" class="hidden" data-style="margin-top:16px;"></div>
                </div>
            </div>
        `;

        // Set default date to yesterday
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setSeconds(0, 0);
        const el = document.getElementById('bl-date');
        if (el) el.value = yesterday.toISOString().slice(0, 16);

        // Listen for tax-exempt toggle to recompute totals
        const taxEl = document.getElementById('bl-tax-exempt');
        if (taxEl) taxEl.addEventListener('change', () => this.computeTotals());

        await this.loadData();
    },

    _maxDateTime() {
        const d = new Date();
        d.setSeconds(0, 0);
        return d.toISOString().slice(0, 16);
    },

    switchTab(tab) {
        document.querySelectorAll('.premium-tab-item[data-tab]').forEach(el => {
            el.classList.toggle('active', el.dataset.tab === tab);
        });
        document.getElementById('backlog-tab-direct').classList.toggle('hidden', tab !== 'direct');
        document.getElementById('backlog-tab-bulk').classList.toggle('hidden', tab !== 'bulk');
    },

    async loadData() {
        try {
            if (App.state.products && App.state.products.length > 50) {
                this._products = App.state.products;
            } else {
                const r = await API.get('/products?active_only=true&limit=1000');
                this._products = (r.products || r || []);
                App.state.products = this._products;
            }
            if (App.state.services) {
                this._services = App.state.services;
            } else {
                const r = await API.get('/services?active_only=true');
                this._services = (r.services || r || []);
                App.state.services = this._services;
            }
            const cr = await API.get('/customers?limit=500');
            this._customers = (cr.customers || cr || []);

            const sel = document.getElementById('bl-customer');
            if (sel) {
                this._customers.forEach(c => {
                    const o = new Option(
                        `${c.full_name}${c.phone ? ' (' + c.phone + ')' : ''}`,
                        c.customer_id
                    );
                    sel.appendChild(o);
                });
            }
        } catch (err) {
            console.error('[BacklogSales] loadData:', err);
        }
    },

    // ── Direct Entry ─────────────────────────────────────────────────────────

    addItem(type = 'custom') {
        const noRow = document.getElementById('bl-no-items');
        if (noRow) noRow.remove();

        const idx = Date.now();
        const row = document.createElement('tr');
        row.id = `bl-row-${idx}`;

        let nameCell;
        if (type === 'product') {
            nameCell = `<select class="form-select form-select-sm bl-item-name" data-idx="${idx}"
                data-on-change="BacklogSales._onNameChange($el,${idx})">
                <option value="">— select product —</option>
                ${this._products.map(p => `<option value="${p.product_id}" data-price="${p.unit_price}">${p.name}</option>`).join('')}
            </select>`;
        } else if (type === 'service') {
            nameCell = `<select class="form-select form-select-sm bl-item-name" data-idx="${idx}"
                data-on-change="BacklogSales._onNameChange($el,${idx})">
                <option value="">— select service —</option>
                ${this._services.map(s => `<option value="${s.service_id}" data-price="${s.base_price}">${s.service_name}</option>`).join('')}
            </select>`;
        } else {
            nameCell = `<input type="text" class="form-input form-input-sm bl-item-name" data-idx="${idx}"
                placeholder="Description" data-on-input="BacklogSales.computeTotals()">`;
        }

        const badge = type === 'product'
            ? '<span class="badge badge-info" data-style="font-size:.7rem;">Product</span>'
            : type === 'service'
                ? '<span class="badge badge-success" data-style="font-size:.7rem;">Service</span>'
                : '<span class="badge badge-secondary" data-style="font-size:.7rem;">Custom</span>';

        row.innerHTML = `
            <td>${badge}<input type="hidden" class="bl-item-type" value="${type}">
                ${type === 'product' ? `<input type="hidden" class="bl-item-ref" data-ref="product_id">` : ''}
                ${type === 'service' ? `<input type="hidden" class="bl-item-ref" data-ref="service_id">` : ''}
            </td>
            <td>${nameCell}</td>
            <td><input type="number" class="form-input form-input-sm text-right bl-item-qty"
                data-idx="${idx}" value="1" min="0.01" step="0.01" data-style="width:76px;"
                data-on-input="BacklogSales.computeTotals()"></td>
            <td><input type="number" class="form-input form-input-sm text-right bl-item-price"
                data-idx="${idx}" value="0.00" min="0" step="0.01" data-style="width:100px;"
                data-on-input="BacklogSales.computeTotals()"></td>
            <td class="text-right font-bold bl-item-total" data-idx="${idx}">K 0.00</td>
            <td><button class="btn btn-icon text-danger" title="Remove"
                data-on-click="BacklogSales.removeItem('${idx}')">
                <span class="material-icons-outlined" data-style="font-size:18px;">remove_circle_outline</span>
            </button></td>
        `;

        document.getElementById('bl-items-body').appendChild(row);
        this.computeTotals();
    },

    _onNameChange(sel, idx) {
        const opt = sel.options[sel.selectedIndex];
        const price = parseFloat(opt.dataset.price) || 0;
        const priceEl = document.querySelector(`.bl-item-price[data-idx="${idx}"]`);
        if (priceEl) priceEl.value = price.toFixed(2);
        this.computeTotals();
    },

    removeItem(idx) {
        const row = document.getElementById(`bl-row-${idx}`);
        if (row) row.remove();
        if (!document.getElementById('bl-items-body').querySelector('tr[id^="bl-row-"]')) {
            document.getElementById('bl-items-body').innerHTML =
                '<tr id="bl-no-items"><td colspan="6" class="text-center text-secondary py-8">Click a button above to add items.</td></tr>';
        }
        this.computeTotals();
    },

    computeTotals() {
        let subtotal = 0;
        document.querySelectorAll('#bl-items-body tr[id^="bl-row-"]').forEach(row => {
            const idx = row.querySelector('[data-idx]')?.dataset?.idx;
            const qty = parseFloat(row.querySelector('.bl-item-qty')?.value) || 0;
            const price = parseFloat(row.querySelector('.bl-item-price')?.value) || 0;
            const line = qty * price;
            subtotal += line;
            const cell = row.querySelector(`.bl-item-total[data-idx="${idx}"]`);
            if (cell) cell.textContent = `K ${line.toFixed(2)}`;
        });

        const taxExempt = document.getElementById('bl-tax-exempt')?.checked;
        const tax = taxExempt ? 0 : subtotal * 0.16;
        const total = subtotal + tax;
        if (document.getElementById('bl-subtotal')) document.getElementById('bl-subtotal').textContent = `K ${subtotal.toFixed(2)}`;
        if (document.getElementById('bl-tax')) document.getElementById('bl-tax').textContent = `K ${tax.toFixed(2)}`;
        if (document.getElementById('bl-total')) document.getElementById('bl-total').textContent = `K ${total.toFixed(2)}`;
    },

    resetDirect() {
        document.getElementById('bl-items-body').innerHTML =
            '<tr id="bl-no-items"><td colspan="6" class="text-center text-secondary py-8">Click a button above to add items.</td></tr>';
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setSeconds(0, 0);
        const el = document.getElementById('bl-date');
        if (el) el.value = yesterday.toISOString().slice(0, 16);
        ['bl-customer', 'bl-payment'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = id === 'bl-payment' ? 'Cash' : '';
        });
        ['bl-ref', 'bl-notes'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        document.getElementById('bl-tax-exempt').checked = false;
        document.getElementById('bl-skip-stock').checked = true;
        this.computeTotals();
    },

    async submitDirect() {
        const rows = [...document.querySelectorAll('#bl-items-body tr[id^="bl-row-"]')];
        if (!rows.length) return Utils.toast('Add at least one item', 'warning');

        const items = [];
        let valid = true;

        rows.forEach(row => {
            const type = row.querySelector('.bl-item-type')?.value;
            const qty = parseFloat(row.querySelector('.bl-item-qty')?.value) || 0;
            const price = parseFloat(row.querySelector('.bl-item-price')?.value) || 0;
            if (qty <= 0) { valid = false; return; }

            const item = { type, quantity: qty, price_override: price };
            const nameEl = row.querySelector('.bl-item-name');

            if (type === 'product') {
                item.product_id = (nameEl?.value || '').trim();
                if (!item.product_id) { valid = false; return; }
                item.description = nameEl.options[nameEl.selectedIndex]?.text || '';
            } else if (type === 'service') {
                item.service_id = (nameEl?.value || '').trim();
                if (!item.service_id) { valid = false; return; }
                item.description = nameEl.options[nameEl.selectedIndex]?.text || '';
            } else {
                item.description = nameEl?.value?.trim();
                if (!item.description) { valid = false; return; }
            }
            items.push(item);
        });

        if (!valid) return Utils.toast('Fill in all item fields', 'warning');

        const dateVal = document.getElementById('bl-date').value;
        if (!dateVal) return Utils.toast('Sale date is required', 'warning');

        const totalText = document.getElementById('bl-total').textContent.replace('K ', '');

        const payload = {
            transaction_date: new Date(dateVal).toISOString(),
            customer_id: document.getElementById('bl-customer').value || null,
            payment_method: document.getElementById('bl-payment').value,
            payment_reference: document.getElementById('bl-ref').value || null,
            notes: document.getElementById('bl-notes').value || null,
            tax_exempt: document.getElementById('bl-tax-exempt').checked,
            skip_stock_adjustment: document.getElementById('bl-skip-stock').checked,
            amount_paid: parseFloat(totalText) || 0,
            items
        };

        const btn = document.getElementById('bl-submit-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

        try {
            await API.post('/sales/backlog', payload);
            Utils.toast('Backlog sale saved!', 'success');
            this.resetDirect();
        } catch (err) {
            Utils.toast(err.message || 'Save failed', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<span class="material-icons-outlined" data-style="font-size:16px;vertical-align:middle;">save</span> Save Backlog Sale';
            }
        }
    },

    // ── Bulk CSV Upload ───────────────────────────────────────────────────────

    downloadTemplate() {
        const rows = [
            'date,time,customer_name,payment_method,payment_reference,tax_exempt,notes,items',
            '2026-01-15,10:30,John Banda,Cash,,false,Backlog entry,Printing Paper x2 @45.00|Binding (Spiral) x1 @20.00',
            '2026-01-15,14:00,,Airtel_Money,MM-987654,false,,Logo Design x1 @350.00'
        ].join('\r\n');
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(new Blob([rows], { type: 'text/csv' })),
            download: 'backlog_sales_template.csv'
        });
        a.click();
        URL.revokeObjectURL(a.href);
    },

    handleCSVFile(file) {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.csv')) return Utils.toast('Please upload a .csv file', 'warning');
        const reader = new FileReader();
        reader.onload = e => this._parseCsv(e.target.result);
        reader.readAsText(file);
    },

    _parseCsv(text) {
        const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
        if (lines.length < 2) return Utils.toast('CSV must have a header and at least one data row', 'warning');

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const rows = lines.slice(1).map(line => {
            const vals = line.split(',');
            const row = {};
            headers.forEach((h, i) => { row[h] = (vals[i] || '').trim(); });
            return row;
        });

        this._csvData = rows;
        this._renderPreview(rows);
    },

    _renderPreview(rows) {
        document.getElementById('bl-csv-summary').textContent =
            `${rows.length} row${rows.length !== 1 ? 's' : ''} ready to import`;
        const btn = document.getElementById('bl-import-btn');
        if (btn) btn.innerHTML = `<span class="material-icons-outlined" data-style="font-size:15px;vertical-align:middle;">cloud_upload</span> Import ${rows.length} Sale${rows.length !== 1 ? 's' : ''}`;

        const keys = rows.length ? Object.keys(rows[0]) : [];
        const shown = rows.slice(0, 20);
        document.getElementById('bl-csv-table').innerHTML = `
            <thead><tr>${keys.map(k => `<th class="whitespace-nowrap text-xs">${k}</th>`).join('')}<th class="text-xs">#</th></tr></thead>
            <tbody>
                ${shown.map((r, i) => `<tr>${keys.map(k => `<td class="text-xs" data-style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r[k]}">${r[k] || '<span class="text-secondary">—</span>'}</td>`).join('')}<td class="text-secondary text-xs">${i + 1}</td></tr>`).join('')}
                ${rows.length > 20 ? `<tr><td colspan="${keys.length + 1}" class="text-center text-secondary py-2 text-xs">…and ${rows.length - 20} more rows</td></tr>` : ''}
            </tbody>
        `;
        document.getElementById('bl-csv-preview').classList.remove('hidden');
        document.getElementById('bl-import-results').classList.add('hidden');
    },

    clearCSV() {
        this._csvData = [];
        document.getElementById('bl-csv-preview').classList.add('hidden');
        document.getElementById('bl-import-results').classList.add('hidden');
        document.getElementById('bl-csv-input').value = '';
    },

    _parseItems(str) {
        return (str || '').split('|').map(part => {
            part = part.trim();
            if (!part) return null;
            const priceM = part.match(/@([\d.]+)$/);
            const qtyM = part.match(/x\s*([\d.]+)\s*@/i);
            const price = priceM ? parseFloat(priceM[1]) : 0;
            const qty = qtyM ? parseFloat(qtyM[1]) : 1;
            const desc = part.replace(/\s*x\s*[\d.]+\s*@[\d.]+$/i, '').trim();
            return desc ? { type: 'custom', description: desc, quantity: qty, price_override: price } : null;
        }).filter(Boolean);
    },

    async submitBulk() {
        if (!this._csvData.length) return Utils.toast('No data to import', 'warning');

        const btn = document.getElementById('bl-import-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }

        const sales = this._csvData.map(row => ({
            transaction_date: row.date
                ? new Date(`${row.date}T${(row.time || '12:00').padEnd(5, '0')}`).toISOString()
                : null,
            customer_name: row.customer_name || null,
            payment_method: row.payment_method || 'Cash',
            payment_reference: row.payment_reference || null,
            tax_exempt: row.tax_exempt === 'true',
            notes: row.notes || null,
            skip_stock_adjustment: true,
            items: this._parseItems(row.items)
        }));

        try {
            const result = await API.post('/sales/backlog/bulk', { sales });
            const errs = (result.errors || []).map(e => `<li class="text-sm">Row ${e.row}: ${e.error}</li>`).join('');
            document.getElementById('bl-import-results').innerHTML = `
                <div data-style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;padding:16px;">
                    <h4 class="font-bold mb-3">Import Results</h4>
                    ${result.inserted > 0 ? `<div data-style="color:var(--color-success);margin-bottom:6px;">✅ ${result.inserted} sale(s) imported</div>` : ''}
                    ${result.failed > 0 ? `<div data-style="color:var(--color-danger);margin-bottom:6px;">❌ ${result.failed} failed</div>${errs ? `<ul data-style="padding-left:16px;color:var(--color-danger);">${errs}</ul>` : ''}` : ''}
                </div>
            `;
            document.getElementById('bl-import-results').classList.remove('hidden');
            if (result.inserted > 0) Utils.toast(`${result.inserted} sale(s) imported!`, 'success');
        } catch (err) {
            Utils.toast(err.message || 'Import failed', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<span class="material-icons-outlined" data-style="font-size:15px;vertical-align:middle;">cloud_upload</span> Import ${this._csvData.length} Sale${this._csvData.length !== 1 ? 's' : ''}`;
            }
        }
    }
};

// ── Drop-zone visual handlers (replace inline ondragover/ondragleave/ondrop) ──
BacklogSales.onDragOver = function (event, el) {
    event.preventDefault();
    el.style.borderColor = 'var(--color-primary)';
    el.style.background = 'rgba(27,58,92,.04)';
};
BacklogSales.onDragLeave = function (el) {
    el.style.borderColor = 'var(--color-border)';
    el.style.background = '';
};
BacklogSales.onDrop = function (event, el) {
    event.preventDefault();
    el.style.borderColor = 'var(--color-border)';
    el.style.background = '';
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) BacklogSales.handleCSVFile(file);
};

window.BacklogSales = BacklogSales;
