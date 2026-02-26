const Settings = {
    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">System Settings</h1>
                    <p class="text-secondary">Manage enterprise modules and system configurations.</p>
                </div>
            </div>

            <div class="settings-grid">
                <div class="card mb-6">
                    <div class="card-header">
                        <h3>General Configuration</h3>
                        <p class="text-sm text-secondary">System-wide parameters.</p>
                    </div>
                    <div class="card-body">
                        <div class="setting-row">
                            <div class="setting-info">
                                <strong class="setting-label">VAT Tax Rate</strong>
                                <p class="setting-desc">Decimal value (e.g., 0.16 for 16%). Affects Quotes and POS.</p>
                            </div>
                            <div class="flex gap-2 items-center">
                                <input type="number" id="tax-rate-input" class="form-input w-24" step="0.01" min="0" max="1">
                                <button class="btn btn-sm btn-primary" onclick="Settings.saveTaxRate()">Save</button>
                            </div>
                        </div>

                        <div class="setting-row mt-4 pt-4 border-t">
                            <div class="setting-info">
                                <strong class="setting-label">Payment Methods</strong>
                                <p class="setting-desc">Configure accepted payment types (Mobile Money, Bank, etc).</p>
                            </div>
                            <button class="btn btn-sm btn-outline" onclick="window.location.hash='#/payments'">Manage Methods</button>
                        </div>
                    </div>
                </div>

                <!-- Security Settings (Director Only) -->
                <div class="card mb-6" id="security-settings-card" style="display:none;">
                    <div class="card-header">
                        <h3>Security Configuration</h3>
                        <p class="text-sm text-secondary">Access control and session management.</p>
                    </div>
                    <div class="card-body">
                        <div class="setting-row">
                            <div class="setting-info">
                                <strong class="setting-label">Idle Session Timeout</strong>
                                <p class="setting-desc">Automatically log out users after inactivity (minutes). Set to 0 to disable.</p>
                            </div>
                            <div class="flex gap-2 items-center">
                                <input type="number" id="idle-timeout-input" class="form-input w-24" min="0" step="1" placeholder="Mins">
                                <button class="btn btn-sm btn-primary" onclick="Settings.saveIdleTimeout()">Save</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="card mb-6">
                    <div class="card-header">
                        <h3>Inventory Configuration</h3>
                        <p class="text-sm text-secondary">Manage product categories and units of measure.</p>
                    </div>
                    <div class="card-body">
                         <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <!-- Categories -->
                            <div>
                                <h4 class="font-bold mb-2 text-sm uppercase text-secondary tracking-wide">Product Categories</h4>
                                <div class="flex gap-2 mb-3">
                                    <input type="text" id="new-category-input" class="form-input" placeholder="New Category Name">
                                    <button class="btn btn-primary" onclick="Settings.addListItem('inventory.categories', 'new-category-input')">
                                        <span class="material-icons-outlined text-sm">add</span> Add
                                    </button>
                                </div>
                                <div id="settings-categories-list" class="setting-tags-list">
                                    <!-- Populated by JS -->
                                    <span class="text-xs text-secondary">Loading...</span>
                                </div>
                                <p class="text-xs text-muted mt-2">Categories help organize reports and sales.</p>
                            </div>

                            <!-- Units of Measure -->
                            <div>
                                <h4 class="font-bold mb-2 text-sm uppercase text-secondary tracking-wide">Units of Measure</h4>
                                <div class="flex gap-2 mb-3">
                                    <input type="text" id="new-uom-input" class="form-input" placeholder="New Unit (e.g. Box)">
                                    <button class="btn btn-primary" onclick="Settings.addListItem('inventory.uoms', 'new-uom-input')">
                                        <span class="material-icons-outlined text-sm">add</span> Add
                                    </button>
                                </div>
                                <div id="settings-uoms-list" class="setting-tags-list">
                                    <!-- Populated by JS -->
                                    <span class="text-xs text-secondary">Loading...</span>
                                </div>
                                <p class="text-xs text-muted mt-2">Units define how you sell items (e.g., per Piece, Kg).</p>
                            </div>
                        </div>
                    </div>
                </div>


                <!-- AI & Intelligence Configuration (Director Only) -->
                <div class="card mb-6" id="ai-settings-card" style="display:none;">
                    <div class="card-header">
                        <h3>🤖 AI & Intelligence</h3>
                        <p class="text-sm text-secondary">Configure Zachi-AI behavior and thresholds.</p>
                    </div>
                    <div class="card-body">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <!-- Fraud Monitoring -->
                            <div>
                                <h4 class="font-bold mb-3 text-sm uppercase text-secondary tracking-wide">Fraud Monitoring</h4>
                                <div class="form-group">
                                    <label>Void Alert Threshold</label>
                                    <div class="flex gap-2">
                                        <input type="number" id="ai-void-threshold" class="form-input" min="1" step="1" placeholder="3">
                                        <span class="flex items-center text-xs text-muted">voids/day</span>
                                    </div>
                                </div>
                                <div class="form-row">
                                    <div class="form-group">
                                        <label>After-Hours Start</label>
                                        <input type="number" id="ai-hours-start" class="form-input" min="0" max="23" placeholder="22">
                                    </div>
                                    <div class="form-group">
                                        <label>After-Hours End</label>
                                        <input type="number" id="ai-hours-end" class="form-input" min="0" max="23" placeholder="6">
                                    </div>
                                </div>
                            </div>

                            <!-- Smart Inventory -->
                            <div>
                                <h4 class="font-bold mb-3 text-sm uppercase text-secondary tracking-wide">Inventory Intelligence</h4>
                                <div class="form-group">
                                    <label>Low Stock Prediction</label>
                                    <div class="flex gap-2">
                                        <input type="number" id="ai-inventory-days" class="form-input" min="1" step="1" placeholder="7">
                                        <span class="flex items-center text-xs text-muted">days left</span>
                                    </div>
                                    <p class="text-xs text-muted mt-1">Alert when stock will run out within these days based on velocity.</p>
                                </div>
                                <div class="mt-6">
                                    <button class="btn btn-primary btn-full" onclick="Settings.saveAISettings()">
                                        <i class="fas fa-save mr-2"></i> Save AI Config
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h3>Enterprise Modules</h3>
                        <p class="text-sm text-secondary">Enable or disable features based on your license or needs.</p>
                    </div>
                    <div class="card-body">
                        <div id="module-toggles" class="loading-state">Loading settings...</div>
                    </div>
                </div>
            </div>
        `;

        await this.loadSettings();
    },

    async loadSettings() {
        try {
            const settings = await API.get('/settings');
            const container = document.getElementById('module-toggles');
            container.innerHTML = '';
            container.classList.remove('loading-state');

            // Populate Tax Rate
            const taxRate = parseFloat(settings['tax.rate']) || 0.16;
            const taxInput = document.getElementById('tax-rate-input');
            if (taxInput) taxInput.value = taxRate;

            // Populate Idle Timeout & AI (Secure)
            const user = Utils.getUser();
            if (user && user.role === 'director') {
                document.getElementById('security-settings-card').style.display = 'block';
                document.getElementById('ai-settings-card').style.display = 'block';

                const idleTimeout = parseInt(settings['system.idle_timeout']) || 0;
                const timeoutInput = document.getElementById('idle-timeout-input');
                if (timeoutInput) timeoutInput.value = idleTimeout;

                // AI Values
                document.getElementById('ai-void-threshold').value = settings['ai.fraud_void_threshold'] || 3;
                document.getElementById('ai-hours-start').value = settings['ai.after_hours_start'] || 22;
                document.getElementById('ai-hours-end').value = settings['ai.after_hours_end'] || 6;
                document.getElementById('ai-inventory-days').value = settings['ai.inventory_alert_days'] || 7;
            }

            // Load Inventory Lists
            this.loadListItems('inventory.categories', 'settings-categories-list');
            this.loadListItems('inventory.uoms', 'settings-uoms-list');

            const modules = [
                { key: 'modules.jobs', label: 'Job Management', desc: 'Job cards, proofs, and production pipeline' },
                { key: 'modules.cash', label: 'Cash Drawer', desc: 'Shift management and EOD reconciliation' },
                { key: 'modules.suppliers', label: 'Supplier Management', desc: 'Manage vendors and price lists' },
                { key: 'modules.purchases', label: 'Procurement (POs)', desc: 'Purchase orders and goods received notes' },
                { key: 'modules.returns', label: 'Returns & Exchanges', desc: 'Customer returns, refunds, and restocking' },
                { key: 'modules.quotes', label: 'Quotations', desc: 'Create and convert quotes to sales' },
                { key: 'modules.loyalty', label: 'Loyalty Program', desc: 'Points earning and redemption system' }
            ];

            modules.forEach(mod => {
                const isEnabled = settings[mod.key] === true || settings[mod.key] === 'true';
                const row = document.createElement('div');
                row.className = 'setting-row';
                row.innerHTML = `
                    <div class="setting-info">
                        <strong class="setting-label">${mod.label}</strong>
                        <p class="setting-desc">${mod.desc}</p>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="Settings.toggleModule('${mod.key}', this.checked)">
                        <span class="toggle-slider"></span>
                    </label>
                `;
                container.appendChild(row);
            });

            // Load Inventory Lists
            this.loadListItems('inventory.categories', 'settings-categories-list');
            this.loadListItems('inventory.uoms', 'settings-uoms-list');

        } catch (err) {
            console.error(err);
            document.getElementById('module-toggles').innerHTML = `<p class="error-text">Failed to load settings: ${err.message}</p>`;
        }
    },


    async toggleModule(key, enabled) {
        try {
            await API.put(`/settings/${key}`, { value: enabled });
            Utils.toast(`${enabled ? 'Enabled' : 'Disabled'} ${key.replace('modules.', '')} module`, 'success');

            // Reload page to reflect sidebar changes
            setTimeout(() => window.location.reload(), 500);
        } catch (err) {
            Utils.toast('Failed to update setting', 'error');
            // Revert toggle if failed (tricky without re-render, but okay for now)
            console.error(err);
        }
    },

    async saveTaxRate() {
        const rate = parseFloat(document.getElementById('tax-rate-input').value);
        if (isNaN(rate) || rate < 0 || rate > 1) {
            Utils.toast('Please enter a valid tax rate (0.00 - 1.00)', 'error');
            return;
        }

        try {
            await API.put('/settings/tax.rate', { value: rate.toString() });
            Utils.toast('Tax rate updated successfully', 'success');
            setTimeout(() => window.location.reload(), 1000);
        } catch (err) {
            Utils.toast('Failed to update tax rate', 'error');
            console.error(err);
        }
    },

    async saveIdleTimeout() {
        const minutes = parseInt(document.getElementById('idle-timeout-input').value);
        if (isNaN(minutes) || minutes < 0) {
            Utils.toast('Please enter a valid number of minutes', 'error');
            return;
        }

        try {
            await API.put('/settings/system.idle_timeout', { value: minutes.toString() });
            Utils.toast(`Idle timeout set to ${minutes} minutes`, 'success');
            // Reload to apply immediately
            setTimeout(() => window.location.reload(), 1000);
        } catch (err) {
            Utils.toast('Failed to update idle timeout', 'error');
            console.error(err);
        }
    },

    // --- List Management (Inventory Settings) ---

    async loadListItems(key, containerId) {
        try {
            const settings = await API.get('/settings');
            let items = settings[key];

            // Default lists if not set
            if (!items) {
                if (key === 'inventory.categories') items = ['General', 'Stationery', 'Electronics', 'Services'];
                if (key === 'inventory.uoms') items = ['Piece', 'Box', 'Kg', 'Liter', 'Meter', 'Hour', 'Set'];
            }

            // Ensure array (handle if stored as string by mistake, though JSONB should parse)
            if (typeof items === 'string') {
                try { items = JSON.parse(items); } catch (e) { items = [items]; }
            }
            if (!Array.isArray(items)) items = [];

            this.renderListItems(key, items, containerId);

        } catch (err) {
            console.error(`Failed to load ${key}`, err);
            document.getElementById(containerId).innerHTML = '<span class="text-red-500 text-xs">Failed to load</span>';
        }
    },

    renderListItems(key, items, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (items.length === 0) {
            container.innerHTML = '<span class="text-xs text-secondary italic">No items defined.</span>';
            return;
        }

        container.innerHTML = items.map(item => `
            <span class="setting-tag">
                ${item}
                <button onclick="Settings.removeListItem('${key}', '${item}')" class="setting-tag-remove" title="Remove">&times;</button>
            </span>
        `).join('');
    },

    async addListItem(key, inputId) {
        const input = document.getElementById(inputId);
        const val = input.value.trim();
        if (!val) return;

        try {
            // Fetch current first to append
            const settings = await API.get('/settings');
            let items = settings[key] || [];

            // Handle defaults if empty/new
            if (!settings[key]) {
                if (key === 'inventory.categories') items = ['General', 'Stationery', 'Electronics', 'Services'];
                if (key === 'inventory.uoms') items = ['Piece', 'Box', 'Kg', 'Liter', 'Meter', 'Hour', 'Set'];
            }

            if (typeof items === 'string') try { items = JSON.parse(items); } catch (e) { items = []; }

            if (items.includes(val)) {
                Utils.toast('Item already exists', 'warning');
                return;
            }

            items.push(val);
            items.sort(); // Keep sorted

            await API.put(`/settings/${key}`, { value: items }); // API handles JSONB automatically

            Utils.toast('Added successfully', 'success');
            input.value = '';

            // Refresh list
            const containerId = key === 'inventory.categories' ? 'settings-categories-list' : 'settings-uoms-list';
            this.renderListItems(key, items, containerId);

        } catch (err) {
            console.error(err);
            Utils.toast('Failed to add item', 'error');
        }
    },

    async removeListItem(key, itemToRemove) {
        if (!await Utils.confirm(`Remove "${itemToRemove}"?`, { title: 'Remove Item', confirmText: 'Remove', type: 'danger' })) return;

        try {
            const settings = await API.get('/settings');
            let items = settings[key] || [];
            if (typeof items === 'string') try { items = JSON.parse(items); } catch (e) { items = []; }

            items = items.filter(i => i !== itemToRemove);

            await API.put(`/settings/${key}`, { value: items });

            Utils.toast('Removed successfully', 'success');

            // Refresh list
            const containerId = key === 'inventory.categories' ? 'settings-categories-list' : 'settings-uoms-list';
            this.renderListItems(key, items, containerId);

        } catch (err) {
            console.error(err);
            Utils.toast('Failed to remove item', 'error');
        }
    },

    async saveAISettings() {
        const config = {
            'ai.fraud_void_threshold': document.getElementById('ai-void-threshold').value,
            'ai.after_hours_start': document.getElementById('ai-hours-start').value,
            'ai.after_hours_end': document.getElementById('ai-hours-end').value,
            'ai.inventory_alert_days': document.getElementById('ai-inventory-days').value
        };

        try {
            for (const [key, value] of Object.entries(config)) {
                await API.put(`/settings/${key}`, { value });
            }
            Utils.toast('AI configurations updated successfully', 'success');
            setTimeout(() => window.location.reload(), 1000);
        } catch (err) {
            Utils.toast('Failed to update AI settings', 'error');
            console.error(err);
        }
    }
};
