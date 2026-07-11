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
        const fallback = document.getElementById('fallback-loading');
        if (fallback) fallback.style.display = 'none';

        // Setup event listeners first (so login form works)
        this.setupAuth();
        this.setupRouter();
        this.setupSidebar();
        this.setupOfflineMode();

        // Decode JWT payload and check expiry BEFORE trusting session storage.
        const token = sessionStorage.getItem('zspos_token');
        const user = Utils.getUser();

        if (!token || !user) {
            this.showLogin();
            return;
        }

        // Read JWT expiry without verifying — verification is done server-side.
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const nowSecs = Math.floor(Date.now() / 1000);
            if (payload.exp && payload.exp < nowSecs) {
                console.warn('[Auth] Token expired, forcing logout.');
                API.clearToken();
                this.showLogin();
                return;
            }
        } catch (e) {
            console.warn('[Auth] Malformed token, forcing logout.', e);
            API.clearToken();
            this.showLogin();
            return;
        }

        // Verify token server-side before rendering the app shell.
        // If we're offline (or the request fails with a network error),
        // trust the JWT-expiry check we already did above and render
        // the app from cache — otherwise the user gets kicked back to
        // the login screen and offline mode is unusable.
        API.token = token;
        const isNetErr = (err) => {
            if (!navigator.onLine) return true;
            if (err instanceof TypeError) return true;
            const m = err && err.message ? err.message : '';
            return m.includes('Failed to fetch') ||
                   m.includes('NetworkError') ||
                   m.includes('ERR_INTERNET_DISCONNECTED') ||
                   m.includes('no cached data');
        };
        try {
            await API.get('/auth/me');
            this.showApp(user);
        } catch (err) {
            if (isNetErr(err)) {
                console.warn('[Auth] Offline at boot — using cached session.', err);
                this.showApp(user);
                return;
            }
            console.warn('[Auth] Server rejected token, forcing logout.', err);
            API.clearToken();
            this.showLogin();
        }
    },

    setupOfflineMode() {
        // Register service-worker v6. It precaches the app shell so the
        // POS boots fully offline (login form, sidebar, all pages),
        // and falls back to cached HTML/JS/CSS when the network is
        // unreachable. The SW deliberately omits clients.claim() and
        // client.navigate() to avoid the v4 multi-iframe reload loop.
        // We skip registration inside the canvas mockup-sandbox iframes
        // (any URL containing '/preview/') as an extra safety net.
        if ('serviceWorker' in navigator) {
            const inSandbox = /\/preview\//.test(location.pathname);
            if (!inSandbox) {
                navigator.serviceWorker
                    .register('/service-worker.js', { updateViaCache: 'none' })
                    .catch((err) => console.warn('[SW] register failed:', err && err.message));
            }
        }

        // Online/Offline Listeners
        window.addEventListener('online', () => {
            this.updateOnlineStatus(true);
            // Single drain via the sync engine (sales + mutations in
            // one batched /api/sync/push, with idempotency replay).
            if (typeof Sync !== 'undefined') {
                Sync.flush().catch((e) => console.warn('[Sync] flush:', e));
                Sync.refresh().catch((e) => console.warn('[Sync] refresh:', e));
            }
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
                sessionStorage.setItem('zspos_user', JSON.stringify(data.user));
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
        const screen = document.getElementById('login-screen');
        // Idempotency guard: api.js calls showLogin() on every 401,
        // which (during a noisy SSE / stale-token storm) used to wipe
        // whatever the cashier was typing. Bail if the screen is
        // already up so the username/password fields keep their
        // in-progress value and focus.
        const wasHidden = screen.classList.contains('hidden');
        screen.classList.remove('hidden');
        document.getElementById('app-shell').classList.add('hidden');
        if (wasHidden) {
            document.getElementById('login-username').value = '';
            document.getElementById('login-password').value = '';
            document.getElementById('login-error').textContent = '';
        }
        this.stopClock();
    },

    // Delegates to API.clearToken() so the correct sessionStorage keys
    // ('zspos_token' / 'zspos_user') are always used.
    logout() {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        if (this._permsPoll) { clearInterval(this._permsPoll); this._permsPoll = null; }
        API.clearToken();
        this.stopClock();
        this.showLogin();
        Utils.toast('Session expired due to inactivity.', 'warning');
    },

    /** Fetch this user's effective permission set from the open
     *  /auth/me/permissions endpoint. Director comes back as a wildcard.
     *  Failure is non-fatal — we leave the existing set in place so a
     *  transient network blip doesn't strip the sidebar. */
    async refreshPermissions() {
        // Hydrate from localStorage on first call so the sidebar is
        // never empty offline — even on a fresh boot where no /auth/
        // me/permissions response has landed yet.
        if (!this.state.perms || this.state.perms.size === 0) {
            try {
                const raw = localStorage.getItem('zspos_perms_cache');
                if (raw) {
                    const cached = JSON.parse(raw);
                    this.state.permsWildcard = !!cached.wildcard;
                    this.state.perms = new Set(Array.isArray(cached.permissions) ? cached.permissions : []);
                }
            } catch (_) { /* ignore */ }
        }
        try {
            const resp = await API.get('/auth/me/permissions');
            if (!resp) return;
            this.state.permsWildcard = !!resp.wildcard;
            this.state.perms = new Set(Array.isArray(resp.permissions) ? resp.permissions : []);
            try {
                localStorage.setItem('zspos_perms_cache', JSON.stringify({
                    wildcard: this.state.permsWildcard,
                    permissions: Array.from(this.state.perms),
                }));
            } catch (_) { /* quota — ignore */ }
        } catch (e) {
            console.warn('[Perms] refresh failed (keeping cached set):', e && e.message);
        }
    },

    /** Apply the current permission + role + module-toggle state to
     *  every .nav-item. Idempotent — safe to call on every navigation
     *  or poll tick. */
    applyNavGates() {
        const user = (this.state && this.state.currentUser) || {};
        const settings = this.settings || {};
        const wildcard = !!(this.state && this.state.permsWildcard);
        const perms = (this.state && this.state.perms) || new Set();
        document.querySelectorAll('.nav-item').forEach(item => {
            const roles = (item.dataset.roles || '').split(',').map(s => s.trim()).filter(Boolean);
            const moduleKey = item.dataset.module;
            const permNames = (item.dataset.permission || '')
                .split(',').map(s => s.trim()).filter(Boolean);
            let visible = false;
            if (wildcard || roles.includes(user.role)) visible = true;
            if (!visible && permNames.length) {
                visible = permNames.some(p => perms.has(p));
            }
            if (moduleKey) {
                const isEnabled = settings[moduleKey] === true || settings[moduleKey] === 'true';
                if (!isEnabled) visible = false;
            }
            item.style.display = visible ? '' : 'none';
        });
        // Hide empty nav groups
        document.querySelectorAll('.nav-group').forEach(group => {
            const items = group.querySelectorAll('.nav-item');
            let anyVisible = false;
            items.forEach(it => { if (it.style.display !== 'none') anyVisible = true; });
            group.style.display = anyVisible ? '' : 'none';
        });
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

        // Register this install with the server (idempotent — safe to
        // call on every login). The returned UUID is then attached as
        // X-Device-Id on every subsequent mutating request.
        if (typeof API.ensureDeviceRegistered === 'function') {
            API.ensureDeviceRegistered().catch((e) =>
                console.warn('[Sync] device register failed:', e.message)
            );
        }
        // Drain anything queued from before this login + pull deltas.
        if (typeof Sync !== 'undefined' && navigator.onLine) {
            Sync.flush().catch(() => {});
            Sync.refresh().catch(() => {});
        }

        // v1.0.43 — proactively warm the offline cache so a user who
        // logs in online and *then* loses connectivity can still open
        // POS / Inventory / Customers / Sales without having visited
        // each page first. Each request is fire-and-forget and any
        // failure is swallowed so a missing endpoint never blocks the
        // app shell from rendering.
        if (navigator.onLine) {
            const warmEndpoints = [
                // Core lookups
                '/products',
                '/products?limit=1000',
                '/services',
                '/customers',
                '/suppliers',
                '/inventory',
                '/settings',
                '/payments',
                '/users',
                '/loyalty',
                '/permissions',
                '/permissions/matrix',
                '/auth/me',
                '/auth/me/permissions',
                '/currency/rates',
                '/notifications?limit=20',
                '/jobs?status=open',
                '/quotes?limit=50',
                '/invoices?limit=50',
                '/promotions',
                '/cash/sessions?limit=10',
                // Dashboard reports — these are the ones the Dashboard
                // page actually requests; warm a dated copy for today
                // so a fresh offline open of the dashboard finds data.
                '/reports/summary',
                '/reports/production-status',
                '/reports/low-stock',
                '/reports/dashboard-charts',
                '/reports/line-removal-alerts',
                '/ai/insights',
                '/ai/fraud-alerts',
            ];
            setTimeout(() => {
                // Fire in small batches so we don't slam the server
                // with 30+ parallel requests at login. Each is fire-
                // and-forget; failures are swallowed.
                let i = 0;
                const tick = () => {
                    const batch = warmEndpoints.slice(i, i + 4);
                    if (!batch.length) return;
                    Promise.allSettled(batch.map((ep) => API.get(ep))).then(() => {
                        i += 4;
                        setTimeout(tick, 250);
                    });
                };
                tick();
            }, 800);
        }

        // v1.0.33 — periodic pull so other devices' changes appear
        // without waiting for an online/offline event. The user reported
        // "sync indicator green but changes aren't showing" — root cause
        // was that Sync.refresh() only fired on app start and on
        // network reconnect. Now we pull every 60s while logged in and
        // online, and re-render the visible page when the delta is
        // non-empty so the cashier doesn't have to navigate away and
        // back to see fresh data.
        if (!this._syncPullTimer && typeof Sync !== 'undefined') {
            this._syncPullTimer = setInterval(() => {
                if (!navigator.onLine) return;
                if (!sessionStorage.getItem('zspos_token')) return;
                Sync.flush()
                    .then(() => Sync.refresh())
                    .then((data) => {
                        if (!data) return;
                        const total =
                            (data.sales || []).length +
                            (data.products || []).length +
                            (data.customers || []).length;
                        if (total > 0) {
                            document.dispatchEvent(new CustomEvent('zspos:sync:delta', {
                                detail: { counts: data },
                            }));
                            // Re-render the current page so fresh rows
                            // appear — BUT skip if the operator is in
                            // the middle of something. A blanket
                            // navigate() was wiping the POS cart,
                            // closing the user-permissions modal mid-
                            // edit, etc. every 60s.
                            const busy =
                                document.querySelector('.modal.is-open, .modal.show, .modal[data-open="true"]') ||
                                document.querySelector('.pos-layout') ||
                                document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
                            if (!busy) {
                                try { this.navigate(window.location.hash); }
                                catch (e) { console.warn('[Sync] auto-rerender failed:', e); }
                            } else {
                                console.log('[Sync] delta received but page is busy — skipping auto-rerender');
                            }
                        }
                    })
                    .catch(() => {});
            }, 60_000);
        }

        // Update sidebar user display
        document.getElementById('user-name').textContent = user.full_name;
        // Sidebar role label was renamed from #user-role to #current-user-role
        // so it doesn't collide with the <select id="user-role"> inside the
        // Add/Edit User modal (getElementById would return the SPAN first,
        // and span.value is undefined → "Missing required fields: Role").
        document.getElementById('current-user-role').textContent = user.role;
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
            // NOTE: system_settings JSONB may return a string or number; coerce with parseInt
            const rawTimeout = this.settings['system.idle_timeout'];
            const idleTimeoutMins = parseInt(rawTimeout, 10);
            if (!isNaN(idleTimeoutMins) && idleTimeoutMins > 0) {
                console.log(`[Auth] Idle timeout set to ${idleTimeoutMins} minutes.`);
                this.startIdleTimer(idleTimeoutMins);
            } else {
                console.log('[Auth] Idle timeout disabled (0 or not set).');
            }
        } catch (err) {
            console.error('Failed to load settings:', err);
            this.settings = {};
        }


        // v1.0.40 — permission overhaul. Sidebar gates on the user's
        // *effective* permission set (role defaults ∪ per-user grants
        // − per-user revokes). Fetched from /auth/me/permissions which
        // any authenticated user can call (the older /users/:id/permissions
        // is director-only and silently 403'd for cashiers, which is why
        // grants weren't unlocking anything in v1.0.39). Re-fetched on
        // every navigation AND on a 30s safety poll so director changes
        // appear in the affected user's sidebar without a relogin.
        this.state = this.state || {};
        this.state.perms = new Set();
        this.state.permsWildcard = false;
        this.state.currentUser = user;
        await this.refreshPermissions();
        this.hasPermission = (name) => {
            if (!name) return true;
            if (this.state.permsWildcard) return true;
            return this.state.perms.has(name);
        };
        this.applyNavGates();
        // Safety net: poll every 30 s so a permission change reaches
        // even a user who is sitting idle on one page. Cheap call —
        // returns a small JSON list. Cleared on logout.
        if (this._permsPoll) clearInterval(this._permsPoll);
        this._permsPoll = setInterval(() => {
            this.refreshPermissions().then(() => this.applyNavGates());
        }, 30000);

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
        const raw = hash.replace('#/', '') || 'dashboard';

        // v1.0.24 — deep-link support for "#/jobs/<uuid>" coming from
        // the email/SMS/WhatsApp assignee notifications. Treat the
        // first segment as the page and any trailing segment as a
        // record id we hand off to the page module after it renders.
        const slash    = raw.indexOf('/');
        const page     = slash === -1 ? raw : raw.slice(0, slash);
        const recordId = slash === -1 ? null : raw.slice(slash + 1);

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

        // v1.0.40 — refresh permissions on every navigation so a director's
        // grant/revoke shows up within a click for the affected user.
        // Fire-and-forget; result is applied as soon as it arrives.
        if (typeof this.refreshPermissions === 'function') {
            this.refreshPermissions().then(() => this.applyNavGates());
        }

        // After the page module mounts, dispatch the trailing id to
        // the right module's "open detail" handler. Wrapped in a
        // microtask + try/catch so a missing module never breaks the
        // top-level navigation.
        if (recordId) {
            setTimeout(() => {
                try {
                    if (page === 'jobs' && typeof Jobs !== 'undefined' && Jobs.showDetailModal) {
                        Jobs.showDetailModal(recordId);
                    }
                } catch (e) {
                    console.warn('[App.navigate] deep-link handler failed', e);
                }
            }, 0);
        }
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
            case 'invoices':
                if (typeof Invoices === 'undefined') {
                    container.innerHTML = '<div class="alert alert-danger">Invoices module failed to load. Please check console.</div>';
                } else {
                    Invoices.render(container);
                }
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
            case 'profile':
                Profile.render(container);
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
            case 'backlog-sales':
                BacklogSales.render(container);
                break;
            case 'credit-orders':
                CreditOrders.render(container);
                break;
            case 'notifications':
                Notifications.render(container);
                break;
            default:
                container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📄</div><p>Page not found</p></div>`;
        }

        // Page renders replace the .header-actions div, which destroys the
        // notification bell. Re-inject it so the badge persists across nav.
        if (this._user) {
            this.setupNotifications(this._user);
        }
    },

    // ── Notifications ──
    /**
     * The notification bell + badge now live statically in the top header
     * (index.html). All this hook does is keep the badge fresh and start
     * the polling loop — clicking the bell navigates to #/notifications.
     */
    async setupNotifications(user) {
        // Cache so loadPage() can re-call us after a page render.
        this._user = user || this._user;

        // Refresh the badge count immediately.
        this.checkNotifications();

        // Set up the polling loop only once per session.
        if (!this._notifPollStarted) {
            this._notifPollStarted = true;
            setInterval(() => this.checkNotifications(), 60000);
        }
    },

    /** Bell click → navigate to the dedicated Notifications page. */
    openNotifications() {
        window.location.hash = '#/notifications';
    },

    /** Always-visible "Update" button in the header. Talks to the same
     *  ZachiOTA bridge as Settings → App updates so cashiers on any
     *  page can pull the latest web bundle without hunting through
     *  settings. Status messages render into #header-update-status. */
    async checkForUpdatesFromHeader() {
        const btn = document.getElementById('header-update-btn');
        const status = document.getElementById('header-update-status');
        const set = (msg) => { if (status) status.textContent = msg || ''; };

        if (!window.ZachiOTA || typeof window.ZachiOTA.checkAndApply !== 'function') {
            set('Update bridge not ready — refresh.');
            return;
        }
        if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
        try {
            await window.ZachiOTA.checkAndApply((s) => {
                switch (s.stage) {
                    case 'checking':    set('Checking…'); break;
                    case 'up-to-date':  set(`Up to date${s.current ? ' (v' + s.current + ')' : ''}`); break;
                    case 'downloading': set(`Downloading v${s.version}…`); if (btn) btn.textContent = 'Downloading…'; break;
                    case 'applying':    set(`Installing v${s.version}…`); if (btn) btn.textContent = 'Installing…'; break;
                    case 'reloading':   set(`Restarting v${s.version}…`); if (btn) btn.textContent = 'Restarting…'; break;
                    case 'error':       set('Update failed: ' + (s.message || 'unknown')); break;
                }
            });
        } catch (err) {
            set('Update failed: ' + ((err && err.message) || String(err)));
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Update'; }
            // Auto-clear the inline status after 8s so the header stays tidy.
            setTimeout(() => set(''), 8000);
        }
    },

    /** Refresh the bell badge. Shows the unread count (capped at "9+")
     *  in a red pill, and switches the bell icon itself to the alert
     *  colour so the change is obvious at a glance. */
    async checkNotifications() {
        try {
            const notifications = await API.get('/notifications/unread');
            const badge = document.getElementById('notification-badge');
            const bell  = document.getElementById('notification-bell');
            if (!badge || !bell) return;
            const n = (notifications && notifications.length) || 0;
            if (n > 0) {
                badge.textContent = n > 9 ? '9+' : String(n);
                badge.classList.remove('hidden');
                bell.classList.add('has-unread');
                bell.setAttribute('title', `${n} unread notification${n === 1 ? '' : 's'}`);
            } else {
                badge.textContent = '0';
                badge.classList.add('hidden');
                bell.classList.remove('has-unread');
                bell.setAttribute('title', 'View notifications');
            }
        } catch (err) {
            console.error('Failed to check notifications:', err);
        }
    },
};

// Boot the app
document.addEventListener('DOMContentLoaded', () => App.init());

// Expose to global scope for delegated event handlers (data-on-* attributes).
window.App = App;
