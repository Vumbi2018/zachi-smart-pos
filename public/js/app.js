/**
 * Zachi Smart-POS - Main App Controller
 * SPA Router & Authentication
 */
const App = {
    currentPage: null,
    clockInterval: null,
    state: {
        settings: null,
        services: null,
        products: null,
        lastFetch: {}
    },

    async init() {
        // Hide fallback loading
        const fallback = document.getElementById('fallback-loading');
        if (fallback) fallback.style.display = 'none';

        // DIAGNOSTIC: Catch startup errors
        window.onerror = function (msg, url, line, col, error) {
            alert(`CRITICAL ERROR:\n${msg}\nAt: ${url}:${line}:${col}\n${error?.stack || ''}`);
            return false;
        };
        console.log('App starting...');

        // Setup event listeners first (so login form works)
        this.setupAuth();
        this.setupRouter();
        this.setupSidebar();
        this.setupOfflineMode();

        // BUG 1 FIX: Decode JWT payload and check expiry BEFORE trusting localStorage
        const token = localStorage.getItem('zspos_token');
        const user = Utils.getUser();

        if (!token || !user) {
            this.showLogin();
            return;
        }

        // Decode JWT (without verification — just to read expiry field)
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const nowSecs = Math.floor(Date.now() / 1000);
            if (payload.exp && payload.exp < nowSecs) {
                // Token is expired client-side — clear immediately, no flash
                console.warn('[Auth] Token expired, forcing logout.');
                API.clearToken();
                this.showLogin();
                return;
            }
        } catch (e) {
            // Malformed token — clear it
            console.warn('[Auth] Malformed token, forcing logout.', e);
            API.clearToken();
            this.showLogin();
            return;
        }

        // BUG 6 FIX: Verify token server-side before rendering the app shell
        API.token = token;
        try {
            await API.get('/auth/me');
            // Server confirmed token is valid — safe to show the app
            this.showApp(user);
        } catch (err) {
            // Server rejected token (expired, revoked, wrong secret, etc.)
            console.warn('[Auth] Server rejected token, forcing logout.', err);
            API.clearToken();
            this.showLogin();
        }
    },

    setupOfflineMode() {
        // Register Service Worker
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/service-worker.js')
                    .then(reg => console.log('SW Registered:', reg.scope))
                    .catch(err => console.log('SW Registration Failed:', err));
            });
        }

        // Online/Offline Listeners
        window.addEventListener('online', () => {
            this.updateOnlineStatus(true);
            API.syncOfflineSales();
        });
        window.addEventListener('offline', () => {
            this.updateOnlineStatus(false);
        });

        this.updateOnlineStatus(navigator.onLine);
    },

    updateOnlineStatus(isOnline) {
        let badge = document.getElementById('offline-badge');
        if (!badge) {
            // Create badge
            badge = document.createElement('div');
            badge.id = 'offline-badge';
            badge.className = 'fixed bottom-4 right-4 bg-red-600 text-white px-3 py-1 rounded shadow-lg z-50 text-sm font-bold hidden';
            badge.textContent = '⚠️ You are Offline';
            document.body.appendChild(badge);
        }

        if (isOnline) {
            badge.classList.add('hidden');
            Utils.toast('You are back online!', 'success');
        } else {
            badge.classList.remove('hidden');
            Utils.toast('You are offline. Offline mode enabled.', 'warning');
        }
    },

    setupAuth() {
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('login-btn');
            const errorEl = document.getElementById('login-error');
            const username = document.getElementById('login-username').value.trim();
            const password = document.getElementById('login-password').value;

            btn.disabled = true;
            btn.innerHTML = '<span>Signing in...</span>';
            errorEl.textContent = '';

            try {
                const data = await API.post('/auth/login', { username, password });
                API.setToken(data.token);
                localStorage.setItem('zspos_user', JSON.stringify(data.user));
                this.showApp(data.user);
                Utils.toast(`Welcome back, ${data.user.full_name}!`, 'success');
            } catch (err) {
                errorEl.textContent = err.message || 'Login failed.';
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span>Sign In</span>';
            }
        });

        document.getElementById('logout-btn').addEventListener('click', async () => {
            if (await Utils.confirm('Are you sure you want to sign out?', { title: 'Sign Out', confirmText: 'Sign Out', type: 'warning' })) {
                API.clearToken();
                this.stopClock();
                this.showLogin();
                Utils.toast('Signed out successfully.', 'info');
            }
        });
    },

    showLogin() {
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('app-shell').classList.add('hidden');
        document.getElementById('login-username').value = '';
        document.getElementById('login-password').value = '';
        document.getElementById('login-error').textContent = '';
        this.stopClock();
    },

    // BUG 2 FIX: Previously this used wrong localStorage keys ('token'/'user' instead of
    // 'zspos_token'/'zspos_user'), so idle-timer logouts left the real token in storage.
    // Now delegates to API.clearToken() which always uses the correct key names.
    logout() {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        API.clearToken();
        this.stopClock();
        this.showLogin();
        Utils.toast('Session expired due to inactivity.', 'warning');
    },

    startIdleTimer(minutes) {
        if (!minutes || minutes <= 0) return;

        const timeoutMs = minutes * 60 * 1000;
        const warningMs = timeoutMs - 60000; // Warn 1 min before (optional, skipping for simplicity)

        const resetTimer = () => {
            if (this.idleTimer) clearTimeout(this.idleTimer);
            this.idleTimer = setTimeout(() => {
                Utils.toast('Session expired due to inactivity.', 'error');
                this.logout();
            }, timeoutMs);
        };

        // Events to listen for activity
        const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];

        // Debounce the reset to avoid performance issues
        let lastActivity = Date.now();
        const handleActivity = () => {
            const now = Date.now();
            if (now - lastActivity > 1000) { // Only reset once per second max
                resetTimer();
                lastActivity = now;
            }
        };

        events.forEach(event => {
            document.removeEventListener(event, handleActivity); // clear old listeners if any
            document.addEventListener(event, handleActivity);
        });

        // Start initial timer
        resetTimer();
        console.log(`Idle timer started: ${minutes} minutes`);
    },

    async showApp(user) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('app-shell').classList.remove('hidden');

        // Update sidebar user display
        document.getElementById('user-name').textContent = user.full_name;
        document.getElementById('user-role').textContent = user.role;
        document.getElementById('user-avatar').textContent = user.full_name.charAt(0).toUpperCase();

        // Update header user display
        document.getElementById('header-welcome').textContent = `Welcome back, ${user.full_name}`;
        document.getElementById('header-user-name').textContent = user.full_name;
        document.getElementById('header-user-role').textContent = user.role;
        document.getElementById('header-avatar').textContent = user.full_name.charAt(0).toUpperCase();

        // Start the live clock
        this.startClock();

        // Setup notifications
        this.setupNotifications(user);

        // Fetch settings and init idle timer
        try {
            if (!this.state.settings) {
                this.state.settings = await API.get('/settings');
            }
            this.settings = this.state.settings;

            // Initialize Idle Timer if configured
            const idleTimeoutMins = parseInt(this.settings['system.idle_timeout']);
            if (idleTimeoutMins > 0) {
                this.startIdleTimer(idleTimeoutMins);
            }
        } catch (err) {
            console.error('Failed to load settings:', err);
            this.settings = {};
        }

        // Filter nav items based on role AND settings
        document.querySelectorAll('.nav-item').forEach(item => {
            const roles = (item.dataset.roles || '').split(',');
            const moduleKey = item.dataset.module;

            let visible = false;
            // Check role access
            if (roles.includes(user.role) || user.role === 'director') {
                visible = true;
            }

            // Check module toggle
            if (moduleKey && this.settings) {
                const isEnabled = this.settings[moduleKey] === true || this.settings[moduleKey] === 'true';
                if (!isEnabled) visible = false;
            }

            item.style.display = visible ? '' : 'none';
        });

        // Hide empty groups
        document.querySelectorAll('.nav-group').forEach(group => {
            const items = group.querySelectorAll('.nav-item');
            let hasVisibleItem = false;
            items.forEach(item => {
                if (item.style.display !== 'none') hasVisibleItem = true;
            });
            group.style.display = hasVisibleItem ? '' : 'none';
        });

        // Restore sidebar state
        const collapsed = localStorage.getItem('zspos_sidebar_collapsed') === 'true';
        if (collapsed) {
            document.getElementById('sidebar').classList.add('collapsed');
        }

        // Navigate to appropriate default page
        const hash = window.location.hash;
        if (!hash || hash === '#/' || hash === '#/login') {
            const defaultPage = user.role === 'cashier' ? '#/pos' : '#/dashboard';
            window.location.hash = defaultPage;
        } else {
            this.navigate(hash);
        }
    },

    // ── Live Clock ──
    startClock() {
        this.updateClock();
        this.clockInterval = setInterval(() => this.updateClock(), 1000);
    },

    stopClock() {
        if (this.clockInterval) {
            clearInterval(this.clockInterval);
            this.clockInterval = null;
        }
    },

    updateClock() {
        const now = new Date();
        const options = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        };
        const dateStr = now.toLocaleDateString('en-US', options);
        const timeStr = now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
        const el = document.getElementById('header-datetime');
        if (el) {
            el.textContent = `${dateStr}  •  ${timeStr}`;
        }
    },

    // ── Sidebar Toggle ──
    setupSidebar() {
        console.log('[Sidebar] init');
        const toggleBtn = document.getElementById('sidebar-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const sidebar = document.getElementById('sidebar');
                sidebar.classList.toggle('collapsed');
                const isCollapsed = sidebar.classList.contains('collapsed');
                localStorage.setItem('zspos_sidebar_collapsed', isCollapsed);
            });
        }

        const groupHeaders = document.querySelectorAll('.nav-group-header');
        console.log(`[Sidebar] Found ${groupHeaders.length} group headers`);

        groupHeaders.forEach((header, idx) => {
            console.log(`[Sidebar] Attaching listener to header ${idx}: ${header.innerText.trim()}`);
            header.addEventListener('click', (e) => {
                const group = header.closest('.nav-group');
                console.log(`[Sidebar] Clicked header: ${header.innerText.trim()}`);
                if (group) {
                    group.classList.toggle('expanded');
                    console.log(`[Sidebar] Toggled group: ${group.dataset.group}, expanded: ${group.classList.contains('expanded')}`);
                } else {
                    console.error('[Sidebar] Clicked header has no parent .nav-group');
                }
            });
        });

    },

    setupRouter() {
        window.addEventListener('hashchange', () => {
            this.navigate(window.location.hash);
        });
    },

    navigate(hash) {
        const page = hash.replace('#/', '') || 'dashboard';

        // Update active nav
        document.querySelectorAll('.nav-item').forEach(item => {
            const isActive = item.dataset.page === page;
            item.classList.toggle('active', isActive);

            // Auto-expand the parent group if active
            if (isActive) {
                const group = item.closest('.nav-group');
                if (group) {
                    group.classList.add('expanded');
                }
            }
        });

        this.currentPage = page;
        this.loadPage(page);
    },

    async loadPage(page) {
        const container = document.getElementById('page-container');

        switch (page) {
            case 'dashboard':
                Dashboard.render(container);
                break;
            case 'pos':
                POS.render(container);
                break;
            case 'inventory':
                Inventory.render(container);
                break;
            case 'customers':
                Customers.render(container);
                break;
            case 'services':
                Services.render(container);
                break;
            case 'reports':
                ReportsAdv.render(container);
                break;
            case 'users':
                Users.render(container);
                break;
            case 'audit':
                Audit.render(container);
                break;
            case 'permissions':
                Permissions.render(container);
                break;
            case 'jobs':
                Jobs.render(container);
                break;
            case 'cash':
                CashDrawer.render(container);
                break;
            case 'suppliers':
                Suppliers.render(container);
                break;
            case 'purchases':
                Purchases.render(container);
                break;
            case 'returns':
                Returns.render(container);
                break;
            case 'quotes':
                Quotes.render(container);
                break;
            case 'loyalty':
                Loyalty.render(container);
                break;
            case 'promotions':
                Promotions.render(container);
                break;
            case 'payments':
                Payments.render(container);
                break;
            case 'settings':
                Settings.render(container);
                break;
            case 'daily-sales':
                DailySales.render(container);
                break;
            case 'stock-receiving':
                console.log('[App] Loading stock-receiving module...');
                if (typeof StockReceiving === 'undefined') {
                    console.error('[App] StockReceiving is NOT defined!');
                    container.innerHTML = '<div class="alert alert-danger">StockReceiving module failed to load. Please check console.</div>';
                } else {
                    StockReceiving.render(container);
                }
                break;

            case 'approvals':
                Approvals.render(container);
                break;
            default:
                container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📄</div><p>Page not found</p></div>`;
        }
    },

    // ── Notifications ──
    async setupNotifications(user) {
        // Create UI elements if they don't exist
        if (!document.getElementById('notification-bell')) {
            const headerActions = document.querySelector('.header-actions');
            if (headerActions) {
                const bellContainer = document.createElement('div');
                bellContainer.className = 'relative';
                bellContainer.innerHTML = `
                    <button id="notification-bell" class="p-2 text-white/70 hover:text-white relative">
                        <span class="material-icons-outlined">notifications</span>
                        <span id="notification-badge" class="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full hidden"></span>
                    </button>
                    <div id="notification-dropdown" class="absolute right-0 top-full mt-2 w-80 bg-slate-800 border border-white/10 rounded shadow-xl hidden z-50">
                        <div class="p-3 border-b border-white/10 flex justify-between items-center">
                            <h3 class="font-bold text-sm">Notifications</h3>
                            <button onclick="App.markAllRead()" class="text-xs text-primary hover:underline">Mark all read</button>
                        </div>
                        <div id="notification-list" class="max-h-64 overflow-y-auto">
                            <div class="p-4 text-center text-white/50 text-sm">No new notifications</div>
                        </div>
                    </div>
                `;
                headerActions.insertBefore(bellContainer, headerActions.firstChild);

                // Toggle dropdown
                document.getElementById('notification-bell').addEventListener('click', (e) => {
                    e.stopPropagation();
                    document.getElementById('notification-dropdown').classList.toggle('hidden');
                });

                // Close on click outside
                document.addEventListener('click', () => {
                    document.getElementById('notification-dropdown')?.classList.add('hidden');
                });

                document.getElementById('notification-dropdown').addEventListener('click', (e) => e.stopPropagation());
            }
        }

        this.checkNotifications();
        // Poll every minute
        setInterval(() => this.checkNotifications(), 60000);
    },

    async checkNotifications() {
        try {
            const notifications = await API.get('/notifications/unread');
            const badge = document.getElementById('notification-badge');
            const list = document.getElementById('notification-list');

            if (!badge || !list) return; // Prevent crash if elements missing

            if (notifications && notifications.length > 0) {
                badge.classList.remove('hidden');
                list.innerHTML = notifications.map(n => `
                    <div class="p-3 border-b border-white/5 hover:bg-white/5 cursor-pointer" onclick="App.markRead(${n.id})">
                        <div class="text-sm text-white/90">${n.message}</div>
                        <div class="text-xs text-white/50 mt-1">${new Date(n.created_at).toLocaleString()}</div>
                    </div>
                `).join('');
            } else {
                badge.classList.add('hidden');
                list.innerHTML = '<div class="p-4 text-center text-white/50 text-sm">No new notifications</div>';
            }
        } catch (err) {
            console.error('Failed to check notifications:', err);
        }
    },

    async markRead(id) {
        try {
            await API.put(`/notifications/${id}/read`);
            this.checkNotifications();
        } catch (err) {
            console.error(err);
        }
    },

    async markAllRead() {
        try {
            await API.put('/notifications/read-all');
            this.checkNotifications();
        } catch (err) {
            console.error(err);
        }
    }
};

// Boot the app
document.addEventListener('DOMContentLoaded', () => App.init());
