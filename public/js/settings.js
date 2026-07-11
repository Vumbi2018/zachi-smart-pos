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
                                <button class="btn btn-sm btn-primary" data-on-click="Settings.saveTaxRate()">Save</button>
                            </div>
                        </div>

                        <div class="setting-row mt-4 pt-4 border-t">
                            <div class="setting-info">
                                <strong class="setting-label">Payment Methods</strong>
                                <p class="setting-desc">Configure accepted payment types (Mobile Money, Bank, etc).</p>
                            </div>
                            <button class="btn btn-sm btn-outline" data-on-click="Dom.navigate('#/payments')">Manage Methods</button>
                        </div>
                    </div>
                </div>

                <!-- Notification Recipients (Director Only) -->
                <div class="card mb-6" id="notif-recipients-card" data-style="display:none;">
                    <div class="card-header">
                        <h3>Notification Recipients</h3>
                        <p class="text-sm text-secondary">
                            Extra email addresses that receive low-stock and credit-due
                            digests. Active director users with an email are always
                            included automatically — list anyone <em>else</em> who should
                            be looped in (managers, accountants, owners).
                        </p>
                    </div>
                    <div class="card-body">
                        <div class="flex gap-2 mb-3" data-style="flex-wrap:wrap;">
                            <input type="text" id="notif-recipient-name" class="form-input"
                                   placeholder="Name (optional)" data-style="max-width:180px;">
                            <input type="email" id="notif-recipient-email" class="form-input"
                                   placeholder="email@example.com" data-style="min-width:240px;">
                            <button class="btn btn-primary"
                                    data-on-click="Settings.addNotificationRecipient()">
                                <span class="material-icons-outlined text-sm">add</span> Add
                            </button>
                        </div>
                        <div id="notif-recipients-list" class="setting-tags-list">
                            <span class="text-xs text-secondary">Loading…</span>
                        </div>
                    </div>
                </div>

                <!-- WhatsApp Recipients (Director Only) -->
                <div class="card mb-6" id="notif-whatsapp-card" data-style="display:none;">
                    <div class="card-header">
                        <h3>WhatsApp Recipients</h3>
                        <p class="text-sm text-secondary">
                            Phone numbers (E.164 format, e.g. +260974210067) that receive
                            scheduled-job WhatsApp alerts. Set <code>WHATSAPP_PROVIDER=webhook</code>
                            and <code>WHATSAPP_WEBHOOK_URL</code> to forward to a
                            Make/Zapier/n8n flow that dispatches to your WhatsApp Business
                            gateway. Without those env vars the scheduler logs each intended
                            send instead of dispatching it.
                        </p>
                    </div>
                    <div class="card-body">
                        <div class="flex gap-2 mb-3" data-style="flex-wrap:wrap;">
                            <input type="text" id="notif-whatsapp-name" class="form-input"
                                   placeholder="Name (optional)" data-style="max-width:180px;">
                            <input type="tel" id="notif-whatsapp-phone" class="form-input"
                                   placeholder="+260974210067" data-style="min-width:200px;">
                            <button class="btn btn-primary"
                                    data-on-click="Settings.addWhatsappRecipient()">
                                <span class="material-icons-outlined text-sm">add</span> Add
                            </button>
                        </div>
                        <div id="notif-whatsapp-list" class="setting-tags-list">
                            <span class="text-xs text-secondary">Loading…</span>
                        </div>
                    </div>
                </div>

                <!-- Messaging Gateway (Director Only) -->
                <div class="card mb-6" id="messaging-gateway-card" data-style="display:none;">
                    <div class="card-header">
                        <h3>SMS &amp; WhatsApp Gateway</h3>
                        <p class="text-sm text-secondary">
                            Configure how the server dispatches SMS and WhatsApp messages
                            (receipts, low-stock alerts, credit reminders). Without a
                            provider configured, messages fall back to opening the device's
                            SMS / WhatsApp app from the cashier's terminal.
                        </p>
                    </div>
                    <div class="card-body">
                        <div class="setting-row">
                            <div class="setting-info">
                                <strong class="setting-label">SMS provider</strong>
                                <p class="setting-desc">Set to <code>webhook</code> to POST messages to your gateway URL. Leave blank to disable.</p>
                            </div>
                            <input type="text" id="msg-sms-provider" class="form-input" placeholder="webhook" data-style="max-width:160px;">
                        </div>
                        <div class="setting-row">
                            <div class="setting-info">
                                <strong class="setting-label">SMS webhook URL</strong>
                                <p class="setting-desc">HTTPS endpoint (Make / Zapier / n8n / your own) that relays to your SMS gateway.</p>
                            </div>
                            <input type="url" id="msg-sms-url" class="form-input" placeholder="https://..." data-style="min-width:260px;">
                        </div>
                        <div class="setting-row">
                            <div class="setting-info">
                                <strong class="setting-label">SMS webhook token</strong>
                                <p class="setting-desc">Optional. Sent as <code>Authorization: Bearer &lt;token&gt;</code>.</p>
                            </div>
                            <input type="text" id="msg-sms-token" class="form-input" placeholder="(optional)" data-style="min-width:200px;">
                        </div>
                        <div class="setting-row">
                            <div class="setting-info">
                                <strong class="setting-label">SMS sender number</strong>
                                <p class="setting-desc">Number / sender ID shown to recipients (E.164, e.g. +260974210067).</p>
                            </div>
                            <input type="tel" id="msg-sms-from" class="form-input" placeholder="+260..." data-style="max-width:200px;">
                        </div>
                        <hr data-style="border:none;border-top:1px solid var(--border);margin:1rem 0;">
                        <div class="setting-row">
                            <div class="setting-info">
                                <strong class="setting-label">WhatsApp provider</strong>
                                <p class="setting-desc">Set to <code>webhook</code> for the same relay pattern as SMS. Leave blank to disable server-side WhatsApp.</p>
                            </div>
                            <input type="text" id="msg-wa-provider" class="form-input" placeholder="webhook" data-style="max-width:160px;">
                        </div>
                        <div class="setting-row">
                            <div class="setting-info">
                                <strong class="setting-label">WhatsApp webhook URL</strong>
                                <p class="setting-desc">HTTPS endpoint that forwards to your WhatsApp Business gateway.</p>
                            </div>
                            <input type="url" id="msg-wa-url" class="form-input" placeholder="https://..." data-style="min-width:260px;">
                        </div>
                        <div class="setting-row">
                            <div class="setting-info">
                                <strong class="setting-label">WhatsApp webhook token</strong>
                                <p class="setting-desc">Optional bearer token.</p>
                            </div>
                            <input type="text" id="msg-wa-token" class="form-input" placeholder="(optional)" data-style="min-width:200px;">
                        </div>
                        <div class="setting-row">
                            <div class="setting-info">
                                <strong class="setting-label">WhatsApp sender number</strong>
                                <p class="setting-desc">The WhatsApp Business number that messages appear from.</p>
                            </div>
                            <input type="tel" id="msg-wa-from" class="form-input" placeholder="+260..." data-style="max-width:200px;">
                        </div>
                        <div data-style="display:flex;justify-content:flex-end;margin-top:1rem;">
                            <button class="btn btn-primary" data-on-click="Settings.saveMessagingGateway()">Save gateway settings</button>
                        </div>
                    </div>
                </div>

                <!-- Store Profile (Director Only) — appears on every PDF letterhead, v1.0.15 -->
                <div class="card mb-6" id="store-profile-card" data-style="display:none;">
                    <div class="card-header">
                        <h3>Store Profile</h3>
                        <p class="text-sm text-secondary">
                            Identity that appears on the top of every PDF (receipts, quotes,
                            invoices, job cards) and in scheduled email/WhatsApp/SMS bodies.
                            Leave any field blank to omit it. Add a secondary phone or email
                            when the business publishes more than one number/inbox.
                        </p>
                    </div>
                    <div class="card-body">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div class="form-group">
                                <label for="store-name">Trading name</label>
                                <input type="text" id="store-name" class="form-input" placeholder="e.g. Zachi Computer Centre" maxlength="120">
                            </div>
                            <div class="form-group">
                                <label for="store-tagline">Tagline (optional)</label>
                                <input type="text" id="store-tagline" class="form-input" placeholder="e.g. Solwezi's IT &amp; print partner" maxlength="120">
                            </div>
                            <div class="form-group md:col-span-2">
                                <label for="store-address">Address</label>
                                <input type="text" id="store-address" class="form-input" placeholder="Street, town" maxlength="200">
                            </div>
                            <div class="form-group">
                                <label for="store-phone">Primary phone</label>
                                <input type="tel" id="store-phone" class="form-input" placeholder="+260..." maxlength="40">
                            </div>
                            <div class="form-group">
                                <label for="store-phone2">Secondary phone (optional)</label>
                                <input type="tel" id="store-phone2" class="form-input" placeholder="0963328807" maxlength="40">
                            </div>
                            <div class="form-group">
                                <label for="store-email">Primary email</label>
                                <input type="email" id="store-email" class="form-input" placeholder="info@example.com" maxlength="120">
                            </div>
                            <div class="form-group">
                                <label for="store-email2">Secondary email (optional)</label>
                                <input type="email" id="store-email2" class="form-input" placeholder="zachicomputercentre120@gmail.com" maxlength="120">
                            </div>
                            <div class="form-group">
                                <label for="store-tpin">TPIN (Tax ID)</label>
                                <input type="text" id="store-tpin" class="form-input" placeholder="e.g. 1000000000" maxlength="40">
                            </div>
                        </div>
                        <div data-style="display:flex;justify-content:flex-end;margin-top:1rem;">
                            <button class="btn btn-primary" data-on-click="Settings.saveStoreProfile()">Save store profile</button>
                        </div>
                    </div>
                </div>

                <!-- Banking Details (Director Only) — invoices module v1.0.14 -->
                <div class="card mb-6" id="banking-details-card" data-style="display:none;">
                    <div class="card-header">
                        <h3>Banking Details</h3>
                        <p class="text-sm text-secondary">
                            These details appear <strong>on invoices only</strong> (PDF, email, WhatsApp, SMS)
                            and are automatically suppressed once an invoice is marked Paid. Receipts and
                            quotations are not affected. Leave any field blank to omit it.
                        </p>
                    </div>
                    <div class="card-body">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <!-- Bank account -->
                            <div>
                                <h4 class="font-bold mb-3 text-sm uppercase text-secondary tracking-wide">Bank Account</h4>
                                <div class="form-group">
                                    <label for="bank-name">Bank name</label>
                                    <input type="text" id="bank-name" class="form-input" placeholder="e.g. Zanaco" maxlength="100">
                                </div>
                                <div class="form-group">
                                    <label for="bank-account-name">Account name</label>
                                    <input type="text" id="bank-account-name" class="form-input" placeholder="e.g. Zachi Computer Centre Ltd" maxlength="120">
                                </div>
                                <div class="form-group">
                                    <label for="bank-account-number">Account number</label>
                                    <input type="text" id="bank-account-number" class="form-input" placeholder="0000000000" maxlength="40">
                                </div>
                                <div class="form-group">
                                    <label for="bank-branch">Branch</label>
                                    <input type="text" id="bank-branch" class="form-input" placeholder="e.g. Solwezi Main" maxlength="80">
                                </div>
                                <div class="form-group">
                                    <label for="bank-branch-code">Branch / sort code</label>
                                    <input type="text" id="bank-branch-code" class="form-input" placeholder="e.g. 010101" maxlength="20">
                                </div>
                                <div class="form-group">
                                    <label for="bank-swift">SWIFT / BIC</label>
                                    <input type="text" id="bank-swift" class="form-input" placeholder="e.g. ZNCOZMLX" maxlength="20">
                                </div>
                            </div>
                            <!-- Mobile money -->
                            <div>
                                <h4 class="font-bold mb-3 text-sm uppercase text-secondary tracking-wide">Mobile Money</h4>
                                <div class="form-group">
                                    <label for="momo-provider">Provider</label>
                                    <input type="text" id="momo-provider" class="form-input" placeholder="e.g. Airtel Money, MTN MoMo, Zamtel Kwacha" maxlength="40">
                                </div>
                                <div class="form-group">
                                    <label for="momo-number">Number</label>
                                    <input type="tel" id="momo-number" class="form-input" placeholder="+260..." maxlength="20">
                                </div>
                            </div>
                        </div>
                        <div data-style="display:flex;justify-content:flex-end;margin-top:1rem;">
                            <button class="btn btn-primary" data-on-click="Settings.saveBankingDetails()">Save banking details</button>
                        </div>
                    </div>
                </div>

                <!-- Currency Rates (Director Only) -->
                <div class="card mb-6" id="currency-rates-card" data-style="display:none;">
                    <div class="card-header">
                        <h3>Currency Rates</h3>
                        <p class="text-sm text-secondary">
                            Manual override of USD-based exchange rates used in the multi-currency
                            display. Listed currencies use your rate; everything else falls back to
                            the live exchange feed. Leave blank to use the live feed for everything.
                        </p>
                    </div>
                    <div class="card-body">
                        <div class="flex gap-2 mb-3" data-style="flex-wrap:wrap;align-items:center;">
                            <input type="text" id="currency-rate-code" class="form-input"
                                   placeholder="ZMW" maxlength="3" data-style="max-width:90px;text-transform:uppercase;">
                            <span class="text-sm text-secondary">= </span>
                            <input type="number" id="currency-rate-value" class="form-input"
                                   placeholder="27.50" step="0.0001" min="0" data-style="max-width:140px;">
                            <span class="text-sm text-secondary">per 1 USD</span>
                            <button class="btn btn-primary"
                                    data-on-click="Settings.addCurrencyRate()">
                                <span class="material-icons-outlined text-sm">add</span> Add / Update
                            </button>
                        </div>
                        <div id="currency-rates-list" class="setting-tags-list">
                            <span class="text-xs text-secondary">Loading…</span>
                        </div>
                    </div>
                </div>

                <!-- Backend URL (Director Only — relevant in Capacitor / Tauri shells) -->
                <div class="card mb-6" id="backend-url-card" data-style="display:none;">
                    <div class="card-header">
                        <h3>Backend Server URL</h3>
                        <p class="text-sm text-secondary">
                            Where this device sends sales, sync, and login requests.
                            Change only if you are pointing this terminal at a staging
                            server or a self-hosted instance.
                        </p>
                    </div>
                    <div class="card-body">
                        <div class="setting-row">
                            <div class="setting-info">
                                <strong class="setting-label">Server URL</strong>
                                <p class="setting-desc">
                                    Default: <code>https://pos.zachicomputercentre.com</code>.
                                    Must start with <code>http://</code> or <code>https://</code>.
                                    Persisted across reinstalls on Android/desktop wrappers.
                                </p>
                                <p class="setting-desc" id="backend-url-current"></p>
                            </div>
                            <div class="flex gap-2 items-center">
                                <input type="url" id="backend-url-input"
                                    class="form-input" data-style="min-width:280px;"
                                    placeholder="https://pos.zachicomputercentre.com">
                                <button class="btn btn-sm btn-primary"
                                    data-on-click="Settings.saveBackendUrl()">Save</button>
                                <button class="btn btn-sm btn-outline"
                                    data-on-click="Settings.resetBackendUrl()">Reset</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- App Updates -->
                <div class="card mb-6">
                    <div class="card-header">
                        <h2 class="card-title">App updates</h2>
                        <p class="card-subtitle">
                            Manually check for and install the latest version of Zachi Smart-POS.
                        </p>
                    </div>
                    <div class="card-body">
                        <div class="setting-row">
                            <div class="setting-info">
                                <strong class="setting-label">Current version</strong>
                                <p class="setting-desc" id="ota-current-version">Checking…</p>
                                <p class="setting-desc" id="ota-update-status" data-style="margin-top:0.5rem;font-weight:600;"></p>
                            </div>
                            <div class="flex gap-2 items-center">
                                <button class="btn btn-primary"
                                    id="ota-check-btn"
                                    data-on-click="Settings.checkForUpdates()">
                                    Check for updates
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Security Settings (Director Only) -->
                <div class="card mb-6" id="security-settings-card" data-style="display:none;">
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
                                <button class="btn btn-sm btn-primary" data-on-click="Settings.saveIdleTimeout()">Save</button>
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
                                    <button class="btn btn-primary" data-on-click="Settings.addListItem('inventory.categories', 'new-category-input')">
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
                                    <button class="btn btn-primary" data-on-click="Settings.addListItem('inventory.uoms', 'new-uom-input')">
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
                <div class="card mb-6" id="ai-settings-card" data-style="display:none;">
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
                                    <button class="btn btn-primary btn-full" data-on-click="Settings.saveAISettings()">
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

                <!-- Desktop Settings (Tauri / Windows app only, Director only). Hidden when running in a browser or on Android. -->
                <div class="card mt-6" id="desktop-settings-card" data-style="display:none;">
                    <div class="card-header">
                        <h3>Desktop Settings</h3>
                        <p class="text-sm text-secondary">Backend connection, receipt printer, cash drawer, and updates for the Windows app.</p>
                    </div>
                    <div class="card-body" id="desktop-settings-body">
                        <div class="setting-row">
                            <div class="setting-info">
                                <strong class="setting-label">Backend URL</strong>
                                <p class="setting-desc">Where this till sends sales and reads catalog data. Production by default; switch to a LAN server or local Counter Mode if needed.</p>
                            </div>
                            <div class="flex gap-2 items-center" data-style="flex-wrap:wrap;">
                                <input type="url" id="desktop-backend-url" class="form-input" data-style="min-width:280px;" placeholder="https://pos.zachicomputercentre.com">
                                <button class="btn btn-sm btn-primary" data-on-click="Settings.saveDesktopBackendUrl()">Save</button>
                            </div>
                        </div>

                        <div class="setting-row mt-4 pt-4 border-t">
                            <div class="setting-info">
                                <strong class="setting-label">Receipt Printer</strong>
                                <p class="setting-desc">Send thermal receipts to a specific printer. Leave on "System default" for the Windows default printer.</p>
                            </div>
                            <div class="flex gap-2 items-center">
                                <select id="desktop-receipt-printer" class="form-input" data-style="min-width:240px;">
                                    <option value="">System default</option>
                                </select>
                                <button class="btn btn-sm btn-outline" data-on-click="Settings.testDesktopPrinter()">Test print</button>
                            </div>
                        </div>

                        <div class="setting-row mt-4 pt-4 border-t">
                            <div class="setting-info">
                                <strong class="setting-label">Cash Drawer</strong>
                                <p class="setting-desc">Where to send the open-drawer pulse. Pick a serial port for a USB-serial drawer, or leave blank to send through the receipt printer's RJ-12 port.</p>
                            </div>
                            <div class="flex gap-2 items-center">
                                <select id="desktop-drawer-port" class="form-input" data-style="min-width:200px;">
                                    <option value="">Via receipt printer</option>
                                </select>
                                <button class="btn btn-sm btn-primary" data-on-click="Settings.saveDesktopDrawer()">Save</button>
                                <button class="btn btn-sm btn-outline" data-on-click="Settings.testDesktopDrawer()">Test drawer</button>
                            </div>
                        </div>

                        <div class="setting-row mt-4 pt-4 border-t">
                            <div class="setting-info">
                                <strong class="setting-label">Counter Mode</strong>
                                <p class="setting-desc">Run the Zachi backend locally on this PC so the till keeps working without internet. Off by default — only enable for shops with chronic connectivity issues.</p>
                            </div>
                            <label class="toggle-switch">
                                <input type="checkbox" id="desktop-counter-mode" data-on-change="Settings.toggleCounterMode(this.checked)">
                                <span class="slider"></span>
                            </label>
                        </div>

                        <div class="setting-row mt-4 pt-4 border-t">
                            <div class="setting-info">
                                <strong class="setting-label">Software Updates</strong>
                                <p class="setting-desc">The app checks for updates automatically at launch. Use this to check now.</p>
                            </div>
                            <button class="btn btn-sm btn-outline" data-on-click="Settings.checkDesktopUpdates()">Check for updates</button>
                        </div>
                    </div>
                </div>

                <div class="card mt-6" id="settings-about-card">
                    <div class="card-header">
                        <h3>About</h3>
                    </div>
                    <div class="card-body">
                        <div class="setting-row">
                            <div class="setting-info">
                                <strong class="setting-label">App version</strong>
                                <p class="setting-desc">Reported by <code>/version.json</code>.</p>
                            </div>
                            <span id="settings-app-version" class="text-secondary">…</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        await this.loadSettings();
        await this.loadDesktopSettings();
        await this._loadAppVersion();
    },

    async _loadAppVersion() {
        const el = document.getElementById('settings-app-version');
        if (!el) return;
        try {
            const res = await fetch('/version.json', { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            const ver = String(data.version || '?')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const released = data.released_at
                ? ` <span class="text-xs text-secondary">(released ${new Date(data.released_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })})</span>`
                : '';
            el.innerHTML = `<strong>v${ver}</strong>${released}`;
        } catch (e) {
            el.textContent = 'unknown';
        }
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
                document.getElementById('backend-url-card').style.display = 'block';
                document.getElementById('notif-recipients-card').style.display = 'block';
                document.getElementById('notif-whatsapp-card').style.display = 'block';
                document.getElementById('currency-rates-card').style.display = 'block';
                document.getElementById('messaging-gateway-card').style.display = 'block';
                document.getElementById('banking-details-card').style.display = 'block';
                document.getElementById('store-profile-card').style.display = 'block';
                this._loadBackendUrl();
                this.loadNotificationRecipients();
                this.loadWhatsappRecipients();
                this.loadCurrencyRates();
                this._loadMessagingGateway(settings);
                this._loadBankingDetails(settings);
                this._loadStoreProfile(settings);

                const idleTimeout = parseInt(settings['system.idle_timeout']) || 0;
                const timeoutInput = document.getElementById('idle-timeout-input');
                if (timeoutInput) timeoutInput.value = idleTimeout;

                // AI Values
                document.getElementById('ai-void-threshold').value = settings['ai.fraud_void_threshold'] || 3;
                document.getElementById('ai-hours-start').value = settings['ai.after_hours_start'] || 22;
                document.getElementById('ai-hours-end').value = settings['ai.after_hours_end'] || 6;
                document.getElementById('ai-inventory-days').value = settings['ai.inventory_alert_days'] || 7;
            }

            // OTA card is visible to everyone — load current version always.
            this._loadCurrentVersion();

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
                        <input type="checkbox" ${isEnabled ? 'checked' : ''} data-on-change="Settings.toggleModule('${mod.key}', $checked)">
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
                <button data-on-click="Settings.removeListItem('${key}', '${item}')" class="setting-tag-remove" title="Remove">&times;</button>
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

    // ── Backend URL (gated to director, persisted via Capacitor
    //    Preferences when running in a native shell) ──────────────────
    async _loadBackendUrl() {
        const input = document.getElementById('backend-url-input');
        const note = document.getElementById('backend-url-current');
        if (!input) return;
        let current = '';
        try {
            if (typeof Native !== 'undefined' && Native && typeof Native.getBackendUrl === 'function') {
                current = await Native.getBackendUrl();
            } else {
                current = (localStorage.getItem('zspos_backend_url') || '').trim();
            }
        } catch (_) { current = ''; }
        input.value = current || '';
        if (note) {
            const isNative = typeof Native !== 'undefined' && Native && Native.isNative && Native.isNative();
            const eff = current || (isNative ? 'https://pos.zachicomputercentre.com' : '(same origin as this page)');
            note.textContent = `Currently using: ${eff}`;
        }
    },

    async saveBackendUrl() {
        const raw = (document.getElementById('backend-url-input').value || '').trim();
        if (!raw) {
            Utils.toast('Enter a URL or click Reset to clear', 'error');
            return;
        }
        if (!/^https?:\/\//i.test(raw)) {
            Utils.toast('URL must start with http:// or https://', 'error');
            return;
        }
        try {
            let saved;
            if (typeof Native !== 'undefined' && Native && typeof Native.setBackendUrl === 'function') {
                saved = await Native.setBackendUrl(raw);
            } else {
                saved = raw.replace(/\/+$/, '');
                localStorage.setItem('zspos_backend_url', saved);
            }
            Utils.toast(`Backend URL saved: ${saved}`, 'success');
            this._loadBackendUrl();
        } catch (err) {
            console.error('saveBackendUrl', err);
            Utils.toast(err.message || 'Failed to save backend URL', 'error');
        }
    },

    async resetBackendUrl() {
        if (!await Utils.confirm('Reset backend URL to the default?', { title: 'Reset Backend URL', confirmText: 'Reset' })) return;
        try {
            try { localStorage.removeItem('zspos_backend_url'); } catch (_) {}
            if (typeof Native !== 'undefined' && Native && Native.isNative && Native.isNative()) {
                // Re-seed the default so Native.getBackendUrl() returns it.
                await Native.setBackendUrl(Native.DEFAULT_BACKEND_URL);
            }
            Utils.toast('Backend URL reset to default', 'success');
            this._loadBackendUrl();
        } catch (err) {
            console.error('resetBackendUrl', err);
            Utils.toast('Failed to reset backend URL', 'error');
        }
    },

    // ── App updates (OTA) ──
    async _loadCurrentVersion() {
        const el = document.getElementById('ota-current-version');
        if (!el) return;
        try {
            let ver = null;
            if (window.ZachiOTA && typeof window.ZachiOTA.getCurrentVersion === 'function') {
                ver = await window.ZachiOTA.getCurrentVersion();
            }
            if (!ver) {
                try {
                    const r = await fetch('/version.json', { cache: 'no-store' });
                    if (r.ok) { const d = await r.json(); ver = d && d.version; }
                } catch (_) {}
            }
            const platform = (window.ZachiOTA && window.ZachiOTA.platform) || 'web';
            el.textContent = ver ? `v${ver} (${platform})` : `Unknown (${platform})`;
        } catch (_) {
            el.textContent = 'Unable to read current version.';
        }
    },

    async checkForUpdates() {
        const btn = document.getElementById('ota-check-btn');
        const status = document.getElementById('ota-update-status');
        if (!window.ZachiOTA || typeof window.ZachiOTA.checkAndApply !== 'function') {
            if (status) status.textContent = 'Update bridge not loaded — refresh the page.';
            return;
        }
        if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
        if (status) status.textContent = '';

        const setStatus = (msg) => { if (status) status.textContent = msg; };

        try {
            await window.ZachiOTA.checkAndApply((s) => {
                switch (s.stage) {
                    case 'checking':
                        setStatus('Checking for updates…');
                        if (btn) btn.textContent = 'Checking…';
                        break;
                    case 'up-to-date':
                        setStatus(`You're on the latest version${s.current ? ' (v' + s.current + ')' : ''}.`);
                        if (btn) { btn.disabled = false; btn.textContent = 'Check for updates'; }
                        break;
                    case 'downloading':
                        setStatus(`Downloading v${s.version}…`);
                        if (btn) btn.textContent = 'Downloading…';
                        break;
                    case 'applying':
                        setStatus(`Installing v${s.version}…`);
                        if (btn) btn.textContent = 'Installing…';
                        break;
                    case 'reloading':
                        setStatus(`Restarting to apply v${s.version}…`);
                        if (btn) btn.textContent = 'Restarting…';
                        break;
                    case 'error':
                        setStatus('Update failed: ' + (s.message || 'unknown error'));
                        if (btn) { btn.disabled = false; btn.textContent = 'Check for updates'; }
                        break;
                }
            });
        } catch (err) {
            setStatus('Update failed: ' + ((err && err.message) || String(err)));
            if (btn) { btn.disabled = false; btn.textContent = 'Check for updates'; }
        }
    },

    // ── Messaging Gateway (SMS / WhatsApp) ──
    _loadMessagingGateway(settings) {
        const get = (k) => (settings && settings[k] != null) ? String(settings[k]) : '';
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        set('msg-sms-provider', get('messaging.sms.provider'));
        set('msg-sms-url',      get('messaging.sms.webhook_url'));
        set('msg-sms-token',    get('messaging.sms.webhook_token'));
        set('msg-sms-from',     get('messaging.sms.from_number'));
        set('msg-wa-provider',  get('messaging.whatsapp.provider'));
        set('msg-wa-url',       get('messaging.whatsapp.webhook_url'));
        set('msg-wa-token',     get('messaging.whatsapp.webhook_token'));
        set('msg-wa-from',      get('messaging.whatsapp.from_number'));
    },

    // ── Store Profile (Director Only) ────────────────────────────
    // v1.0.15 — letterhead identity (name/tagline/address/phone(s)/
    // email(s)/TPIN). All eight values are individual `store.*` settings;
    // pdfService reads them on every render so a save is reflected on
    // the next print. `phone2`/`email2` are seeded by migration 022.
    _loadStoreProfile(settings) {
        const set = (id, key) => {
            const el = document.getElementById(id);
            if (el) el.value = settings[key] || '';
        };
        set('store-name',    'store.name');
        set('store-tagline', 'store.tagline');
        set('store-address', 'store.address');
        set('store-phone',   'store.phone');
        set('store-phone2',  'store.phone2');
        set('store-email',   'store.email');
        set('store-email2',  'store.email2');
        set('store-tpin',    'store.tpin');
    },

    async saveStoreProfile() {
        const val = (id) => (document.getElementById(id).value || '').trim();
        const pairs = {
            'store.name':    val('store-name'),
            'store.tagline': val('store-tagline'),
            'store.address': val('store-address'),
            'store.phone':   val('store-phone'),
            'store.phone2':  val('store-phone2'),
            'store.email':   val('store-email'),
            'store.email2':  val('store-email2'),
            'store.tpin':    val('store-tpin'),
        };
        if (!pairs['store.name']) {
            Utils.toast('Trading name is required.', 'warning');
            return;
        }
        try {
            for (const [k, v] of Object.entries(pairs)) {
                await API.put('/settings/' + encodeURIComponent(k), { value: v });
            }
            // Refresh the in-memory cache so other pages see the new values
            // immediately — but if the GET fails we still consider the save
            // successful (the next page nav will reload settings anyway).
            API.get('/settings').then((fresh) => {
                if (window.App) window.App.settings = fresh;
            }).catch(() => { /* non-fatal */ });
            Utils.toast('Store profile saved — appears on the next PDF you print.', 'success');
        } catch (err) {
            console.error('saveStoreProfile', err);
            Utils.toast(err.message || 'Failed to save store profile', 'error');
        }
    },

    // ── Banking Details (Director Only) ──────────────────────────
    // v1.0.14 — values land on invoice PDFs/emails/WA/SMS bodies only.
    // Stored as plain string settings (`store.bank_*`, `store.momo_*`)
    // seeded by migration 020.
    _loadBankingDetails(settings) {
        const set = (id, key) => {
            const el = document.getElementById(id);
            if (el) el.value = settings[key] || '';
        };
        set('bank-name',           'store.bank_name');
        set('bank-account-name',   'store.bank_account_name');
        set('bank-account-number', 'store.bank_account_number');
        set('bank-branch',         'store.bank_branch');
        set('bank-branch-code',    'store.bank_branch_code');
        set('bank-swift',          'store.bank_swift');
        set('momo-provider',       'store.momo_provider');
        set('momo-number',         'store.momo_number');
    },

    async saveBankingDetails() {
        const val = (id) => (document.getElementById(id).value || '').trim();
        const pairs = {
            'store.bank_name':           val('bank-name'),
            'store.bank_account_name':   val('bank-account-name'),
            'store.bank_account_number': val('bank-account-number'),
            'store.bank_branch':         val('bank-branch'),
            'store.bank_branch_code':    val('bank-branch-code'),
            'store.bank_swift':          val('bank-swift'),
            'store.momo_provider':       val('momo-provider'),
            'store.momo_number':         val('momo-number'),
        };
        try {
            for (const [k, v] of Object.entries(pairs)) {
                await API.put('/settings/' + encodeURIComponent(k), { value: v });
            }
            // Refresh the in-memory App.settings so the next invoice
            // WhatsApp/SMS body picks up the new values without a reload.
            try {
                const fresh = await API.get('/settings');
                if (window.App) window.App.settings = fresh;
            } catch (_) { /* non-fatal */ }
            Utils.toast('Banking details saved', 'success');
        } catch (err) {
            console.error('saveBankingDetails', err);
            Utils.toast(err.message || 'Failed to save banking details', 'error');
        }
    },

    async saveMessagingGateway() {
        const val = (id) => (document.getElementById(id).value || '').trim();
        const pairs = {
            'messaging.sms.provider'        : val('msg-sms-provider').toLowerCase(),
            'messaging.sms.webhook_url'     : val('msg-sms-url'),
            'messaging.sms.webhook_token'   : val('msg-sms-token'),
            'messaging.sms.from_number'     : val('msg-sms-from'),
            'messaging.whatsapp.provider'   : val('msg-wa-provider').toLowerCase(),
            'messaging.whatsapp.webhook_url': val('msg-wa-url'),
            'messaging.whatsapp.webhook_token': val('msg-wa-token'),
            'messaging.whatsapp.from_number': val('msg-wa-from'),
        };
        for (const [k, v] of Object.entries(pairs)) {
            if (v && /url/i.test(k) && !/^https?:\/\//i.test(v)) {
                Utils.toast(`${k}: must start with http:// or https://`, 'error');
                return;
            }
        }
        try {
            for (const [k, v] of Object.entries(pairs)) {
                await API.put('/settings/' + encodeURIComponent(k), { value: v });
            }
            Utils.toast('Messaging gateway saved', 'success');
        } catch (err) {
            console.error('saveMessagingGateway', err);
            Utils.toast(err.message || 'Failed to save gateway settings', 'error');
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
    },

    // ── Desktop Settings (Tauri / Windows app only) ────────────────
    // These methods short-circuit to a no-op on web/Android. They
    // only run when `window.IS_TAURI_DESKTOP` is true and the user
    // is a director.
    async loadDesktopSettings() {
        if (!window.IS_TAURI_DESKTOP || !window.ZachiDesktop) return;
        const user = (typeof Utils !== 'undefined' && Utils.getUser) ? Utils.getUser() : null;
        if (!user || user.role !== 'director') return;

        const card = document.getElementById('desktop-settings-card');
        if (!card) return;
        card.style.display = 'block';

        try {
            // Backend URL.
            const url = await window.ZachiDesktop.getBackendUrl();
            const urlInput = document.getElementById('desktop-backend-url');
            if (urlInput) urlInput.value = url || '';

            // Receipt printer list.
            const printerSelect = document.getElementById('desktop-receipt-printer');
            const currentPrinter = await window.ZachiDesktop.getReceiptPrinter();
            try {
                const printers = await window.ZachiDesktop.listPrinters();
                if (printerSelect && Array.isArray(printers)) {
                    for (const p of printers) {
                        const opt = document.createElement('option');
                        opt.value = p.name;
                        opt.textContent = p.isDefault ? `${p.name} (default)` : p.name;
                        if (currentPrinter && currentPrinter === p.name) opt.selected = true;
                        printerSelect.appendChild(opt);
                    }
                    printerSelect.addEventListener('change', () => {
                        window.ZachiDesktop.setReceiptPrinter(printerSelect.value || null);
                    });
                }
            } catch (e) {
                console.warn('listPrinters failed', e);
            }

            // Cash drawer port list.
            const drawerSelect = document.getElementById('desktop-drawer-port');
            const drawerCfg = await window.ZachiDesktop.getCashDrawerConfig();
            try {
                const ports = await window.ZachiDesktop.listSerialPorts();
                if (drawerSelect && Array.isArray(ports)) {
                    for (const p of ports) {
                        const opt = document.createElement('option');
                        opt.value = p.name;
                        opt.textContent = `${p.name} (${p.kind})`;
                        if (drawerCfg && drawerCfg.port === p.name) opt.selected = true;
                        drawerSelect.appendChild(opt);
                    }
                }
            } catch (e) {
                console.warn('listSerialPorts failed', e);
            }

            // Counter mode toggle.
            const counter = await window.ZachiDesktop.getCounterMode();
            const cm = document.getElementById('desktop-counter-mode');
            if (cm) cm.checked = !!(counter && counter.enabled);
        } catch (err) {
            console.error('loadDesktopSettings failed', err);
        }
    },

    async saveDesktopBackendUrl() {
        const v = document.getElementById('desktop-backend-url').value.trim();
        try {
            const saved = await window.ZachiDesktop.setBackendUrl(v);
            Utils.toast(`Backend URL set to ${saved}`, 'success');
        } catch (e) {
            Utils.toast(e.message || 'Failed to save backend URL', 'error');
        }
    },

    async testDesktopPrinter() {
        try {
            const text =
                'Zachi POS — Test Print\n' +
                '------------------------\n' +
                `Time: ${new Date().toLocaleString()}\n` +
                'If you can read this, the printer is wired up correctly.\n\n\n';
            await window.ZachiDesktop.printReceipt(text);
            Utils.toast('Test page sent to printer', 'success');
        } catch (e) {
            Utils.toast(`Print failed: ${e.message || e}`, 'error');
        }
    },

    async saveDesktopDrawer() {
        const port = document.getElementById('desktop-drawer-port').value || null;
        try {
            await window.ZachiDesktop.setCashDrawerConfig({ port });
            Utils.toast(port ? `Cash drawer set to ${port}` : 'Cash drawer routed via printer', 'success');
        } catch (e) {
            Utils.toast(e.message || 'Failed to save drawer', 'error');
        }
    },

    async testDesktopDrawer() {
        try {
            await window.ZachiDesktop.openCashDrawer();
            Utils.toast('Drawer pulse sent', 'success');
        } catch (e) {
            Utils.toast(`Drawer test failed: ${e.message || e}`, 'error');
        }
    },

    async toggleCounterMode(enabled) {
        try {
            await window.ZachiDesktop.setCounterMode(!!enabled);
            Utils.toast(
                enabled ? 'Counter Mode ON — talking to local backend' : 'Counter Mode OFF — talking to remote backend',
                'success'
            );
        } catch (e) {
            Utils.toast(`Counter Mode change failed: ${e.message || e}`, 'error');
            // Revert checkbox on failure.
            const cm = document.getElementById('desktop-counter-mode');
            if (cm) cm.checked = !enabled;
        }
    },

    async checkDesktopUpdates() {
        try {
            const meta = await window.ZachiDesktop.checkForUpdates();
            if (meta && meta.available) {
                Utils.toast(`Update available: v${meta.version || '?'} — installing in background.`, 'info');
            } else if (meta && meta.error) {
                Utils.toast(`Update check failed: ${meta.error}`, 'error');
            } else {
                Utils.toast('You are on the latest version.', 'success');
            }
        } catch (e) {
            Utils.toast(`Update check failed: ${e.message || e}`, 'error');
        }
    },

    // Notification Recipients
    // Reads / writes `notifications.recipients` ([{email,name}]). The
    // scheduler honours the same key for low-stock & credit-due digests.
    _notifRecipients: [],

    async loadNotificationRecipients() {
        const list = document.getElementById('notif-recipients-list');
        if (!list) return;
        try {
            const settings = await API.get('/settings');
            const raw = settings['notifications.recipients'];
            // The settings endpoint returns parsed JSON for jsonb values, but
            // older browsers may receive a string — handle both.
            let arr = [];
            if (Array.isArray(raw)) arr = raw;
            else if (typeof raw === 'string' && raw.length > 0) {
                try { arr = JSON.parse(raw); } catch (_) { arr = []; }
            }
            this._notifRecipients = arr.filter(x => x && x.email);
            this._renderNotificationRecipients();
        } catch (err) {
            console.error('loadNotificationRecipients failed', err);
            list.innerHTML = `<span class="text-xs text-error">Failed to load: ${err.message}</span>`;
        }
    },

    _renderNotificationRecipients() {
        const list = document.getElementById('notif-recipients-list');
        if (!list) return;
        if (this._notifRecipients.length === 0) {
            list.innerHTML = `<span class="text-xs text-secondary">No extra recipients configured. Active directors with an email still receive alerts.</span>`;
            return;
        }
        list.innerHTML = this._notifRecipients.map((r) => {
            const esc = (s) => String(s == null ? '' : s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
            const email = esc(r.email);
            const name = esc(r.name);
            const display = name ? `${name} &lt;${email}&gt;` : email;
            return `
                <span class="setting-tag">
                    ${display}
                    <button class="setting-tag-remove" title="Remove"
                            data-on-click="Settings.removeNotificationRecipient('${email}')">×</button>
                </span>`;
        }).join('');
    },

    async _saveNotificationRecipients() {
        await API.put('/settings/notifications.recipients', { value: this._notifRecipients });
    },

    async addNotificationRecipient() {
        const emailEl = document.getElementById('notif-recipient-email');
        const nameEl = document.getElementById('notif-recipient-name');
        const email = (emailEl.value || '').trim();
        const name = (nameEl.value || '').trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            Utils.toast('Enter a valid email address.', 'warning');
            return;
        }
        if (this._notifRecipients.some(r => r.email.toLowerCase() === email.toLowerCase())) {
            Utils.toast('That email is already on the list.', 'info');
            return;
        }
        this._notifRecipients.push({ email, name });
        try {
            await this._saveNotificationRecipients();
            emailEl.value = '';
            nameEl.value = '';
            this._renderNotificationRecipients();
            Utils.toast('Recipient added.', 'success');
        } catch (err) {
            // Roll back on failure so the UI matches the server.
            this._notifRecipients.pop();
            Utils.toast(`Failed to save: ${err.message || err}`, 'error');
        }
    },

    async removeNotificationRecipient(email) {
        const before = this._notifRecipients;
        this._notifRecipients = before.filter(r => r.email.toLowerCase() !== String(email).toLowerCase());
        try {
            await this._saveNotificationRecipients();
            this._renderNotificationRecipients();
            Utils.toast('Recipient removed.', 'success');
        } catch (err) {
            this._notifRecipients = before;
            this._renderNotificationRecipients();
            Utils.toast(`Failed to save: ${err.message || err}`, 'error');
        }
    },

    // WhatsApp Recipients
    // Reads / writes `notifications.whatsapp_recipients` (array of
    // {phone, name?}). The scheduler honours the same key.
    _whatsappRecipients: [],

    async loadWhatsappRecipients() {
        const list = document.getElementById('notif-whatsapp-list');
        if (!list) return;
        try {
            const settings = await API.get('/settings');
            const raw = settings['notifications.whatsapp_recipients'];
            let arr = [];
            if (Array.isArray(raw)) arr = raw;
            else if (typeof raw === 'string' && raw.length > 0) {
                try { arr = JSON.parse(raw); } catch (_) { arr = []; }
            }
            this._whatsappRecipients = arr.filter(x => x && x.phone);
            this._renderWhatsappRecipients();
        } catch (err) {
            console.error('loadWhatsappRecipients failed', err);
            list.innerHTML = `<span class="text-xs text-error">Failed to load: ${err.message}</span>`;
        }
    },

    _renderWhatsappRecipients() {
        const list = document.getElementById('notif-whatsapp-list');
        if (!list) return;
        if (this._whatsappRecipients.length === 0) {
            list.innerHTML = `<span class="text-xs text-secondary">No WhatsApp recipients configured.</span>`;
            return;
        }
        const esc = (s) => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        list.innerHTML = this._whatsappRecipients.map((r) => {
            const phone = esc(r.phone);
            const name = esc(r.name);
            const display = name ? `${name} &lt;${phone}&gt;` : phone;
            return `
                <span class="setting-tag">
                    ${display}
                    <button class="setting-tag-remove" title="Remove"
                            data-on-click="Settings.removeWhatsappRecipient('${phone}')">×</button>
                </span>`;
        }).join('');
    },

    async _saveWhatsappRecipients() {
        await API.put('/settings/notifications.whatsapp_recipients', { value: this._whatsappRecipients });
    },

    async addWhatsappRecipient() {
        const phoneEl = document.getElementById('notif-whatsapp-phone');
        const nameEl = document.getElementById('notif-whatsapp-name');
        const phone = (phoneEl.value || '').trim();
        const name = (nameEl.value || '').trim();
        // E.164: leading + then 8-15 digits.
        if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
            Utils.toast('Enter a phone number in E.164 format, e.g. +260974210067.', 'warning');
            return;
        }
        if (this._whatsappRecipients.some(r => r.phone === phone)) {
            Utils.toast('That number is already on the list.', 'info');
            return;
        }
        this._whatsappRecipients.push({ phone, name });
        try {
            await this._saveWhatsappRecipients();
            phoneEl.value = '';
            nameEl.value = '';
            this._renderWhatsappRecipients();
            Utils.toast('WhatsApp recipient added.', 'success');
        } catch (err) {
            this._whatsappRecipients.pop();
            Utils.toast(`Failed to save: ${err.message || err}`, 'error');
        }
    },

    async removeWhatsappRecipient(phone) {
        const before = this._whatsappRecipients;
        this._whatsappRecipients = before.filter(r => r.phone !== String(phone));
        try {
            await this._saveWhatsappRecipients();
            this._renderWhatsappRecipients();
            Utils.toast('WhatsApp recipient removed.', 'success');
        } catch (err) {
            this._whatsappRecipients = before;
            this._renderWhatsappRecipients();
            Utils.toast(`Failed to save: ${err.message || err}`, 'error');
        }
    },

    // Currency Rates
    // Reads / writes `currency.rates` ({ZMW: 27.5, ...}); merged on top
    // of the live exchangerate-api feed by /api/currency.
    _currencyRates: {},

    async loadCurrencyRates() {
        const list = document.getElementById('currency-rates-list');
        if (!list) return;
        try {
            const r = await API.get('/currency/overrides');
            this._currencyRates = (r && r.rates) || {};
            this._renderCurrencyRates();
        } catch (err) {
            console.error('loadCurrencyRates failed', err);
            list.innerHTML = `<span class="text-xs text-error">Failed to load: ${err.message}</span>`;
        }
    },

    _renderCurrencyRates() {
        const list = document.getElementById('currency-rates-list');
        if (!list) return;
        const entries = Object.entries(this._currencyRates).sort(([a], [b]) => a.localeCompare(b));
        if (entries.length === 0) {
            list.innerHTML = `<span class="text-xs text-secondary">No overrides set. Using the live rate feed for every currency.</span>`;
            return;
        }
        // The same row can be written through the generic /settings/:key
        // endpoint, so escape the code before innerHTML injection.
        const esc = (s) => String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        list.innerHTML = entries.map(([code, rate]) => {
            const safeCode = esc(code);
            return `
                <span class="setting-tag">
                    <strong>${safeCode}</strong> = ${Number(rate).toFixed(4)} per USD
                    <button class="setting-tag-remove" title="Remove"
                            data-on-click="Settings.removeCurrencyRate('${safeCode}')">×</button>
                </span>`;
        }).join('');
    },

    async _saveCurrencyRates() {
        await API.put('/currency/overrides', { rates: this._currencyRates });
    },

    async addCurrencyRate() {
        const codeEl = document.getElementById('currency-rate-code');
        const valEl = document.getElementById('currency-rate-value');
        const code = (codeEl.value || '').trim().toUpperCase();
        const val = Number(valEl.value);
        if (!/^[A-Z]{3}$/.test(code)) {
            Utils.toast('Currency code must be 3 letters (e.g. ZMW).', 'warning');
            return;
        }
        if (!Number.isFinite(val) || val <= 0) {
            Utils.toast('Enter a positive exchange rate.', 'warning');
            return;
        }
        const prev = { ...this._currencyRates };
        this._currencyRates[code] = val;
        try {
            await this._saveCurrencyRates();
            codeEl.value = '';
            valEl.value = '';
            this._renderCurrencyRates();
            Utils.toast(`Saved ${code} = ${val}.`, 'success');
        } catch (err) {
            this._currencyRates = prev;
            this._renderCurrencyRates();
            Utils.toast(`Failed to save: ${err.message || err}`, 'error');
        }
    },

    async removeCurrencyRate(code) {
        const prev = { ...this._currencyRates };
        delete this._currencyRates[String(code).toUpperCase()];
        try {
            // Use the dedicated PUT endpoint (not /settings/...) — it has
            // a stricter shape and triggers extra validation.
            await this._saveCurrencyRates();
            this._renderCurrencyRates();
            Utils.toast(`Removed ${code}.`, 'success');
        } catch (err) {
            this._currencyRates = prev;
            this._renderCurrencyRates();
            Utils.toast(`Failed to save: ${err.message || err}`, 'error');
        }
    }
};

// Expose to global scope for delegated event handlers (data-on-* attributes).
window.Settings = Settings;
