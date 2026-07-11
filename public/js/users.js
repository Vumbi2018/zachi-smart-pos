/**
 * Zachi Smart-POS - User Management Module
 * Director Only
 */
const Users = {
    activeTab: 'users',
    allUsers: [],
    // v1.0.35 — role chip filter on top of the search box.
    roleFilter: 'all',

    render(container) {
        container.innerHTML = `
            <div class="um-page">
              <div class="um-hero">
                <div class="um-hero-row">
                    <div class="um-hero-icon"><span class="material-icons-outlined">groups</span></div>
                    <div>
                        <div class="um-hero-title">User &amp; Access Management</div>
                        <div class="um-hero-sub">Premium controls for staff, roles &amp; granular permissions.</div>
                    </div>
                    <div class="um-hero-actions">
                        <div class="um-search" id="user-search-wrap">
                            <span class="material-icons-outlined">search</span>
                            <input type="text" id="user-search" placeholder="Search by name, username or email…" data-on-keyup="Users.filterUsers()">
                        </div>
                        <button class="um-btn-primary" id="new-user-btn" data-on-click="Users.showAddModal()">
                            <span class="material-icons-outlined">person_add</span>
                            New User
                        </button>
                    </div>
                </div>
              </div>

              <div class="tabs mb-4 border-b border-white/10">
                <button class="px-4 py-2 text-sm font-medium ${this.activeTab === 'users' ? 'text-primary border-b-2 border-primary' : 'text-white/60 hover:text-white'}"
                        data-on-click="Users.switchTab('users')">
                    <span class="material-icons-outlined" data-style="font-size:16px;vertical-align:middle;">groups</span>
                    Users
                </button>
                <button class="px-4 py-2 text-sm font-medium ${this.activeTab === 'roles' ? 'text-primary border-b-2 border-primary' : 'text-white/60 hover:text-white'}"
                        data-on-click="Users.switchTab('roles')">
                    <span class="material-icons-outlined" data-style="font-size:16px;vertical-align:middle;">shield</span>
                    Roles &amp; Permissions
                </button>
              </div>

              <div id="users-tab-content" class="${this.activeTab === 'users' ? 'block' : 'hidden'}">
                <div id="um-stats" class="um-stats"></div>
                <div class="um-filter-bar" id="um-filter-bar"></div>
                <div id="users-grid" class="um-grid">
                    <div class="um-empty"><span class="material-icons-outlined">hourglass_top</span><div>Loading staff…</div></div>
                </div>
              </div>
            </div>

            <div id="roles-tab-content" class="${this.activeTab === 'roles' ? 'block' : 'hidden'}">
                <!-- Permissions module renders here -->
            </div>

            <!-- Add/Edit User Modal -->
            <div id="user-modal" class="modal-overlay um-modal hidden">
                <div class="modal max-w-lg">
                    <div class="modal-header">
                        <h2 id="user-modal-title" class="text-xl font-bold">Add New User</h2>
                        <button data-on-click="Utils.closeModal('user-modal')" class="text-white/60 hover:text-white">
                            <span class="material-icons-outlined">close</span>
                        </button>
                    </div>
                    <div class="modal-body">
                        <form id="user-form" class="space-y-4">
                            <input type="hidden" id="user-id">

                            <!-- Modal sub-tabs (v1.0.16): Profile vs. Access.
                                 Profile holds identity fields; Access holds the
                                 permission editor. Tab buttons swap visibility
                                 of the panels below; the form wraps both so a
                                 single Save commits everything. -->
                            <!-- v1.0.22: explicit user-modal-tabs row class
                                 so we can guarantee both tab buttons sit
                                 side-by-side via CSS, regardless of whether
                                 Tailwind utility classes are loaded or
                                 inherited margins try to wrap them. -->
                            <div class="user-modal-tabs">
                                <button type="button" class="user-modal-tab active" data-modal-tab="profile" data-on-click="Users.switchModalTab('profile')">
                                    <span class="material-icons-outlined" data-style="font-size:16px;vertical-align:middle;">person</span>
                                    Profile
                                </button>
                                <button type="button" class="user-modal-tab" data-modal-tab="access" data-on-click="Users.switchModalTab('access')">
                                    <span class="material-icons-outlined" data-style="font-size:16px;vertical-align:middle;">vpn_key</span>
                                    Access
                                </button>
                            </div>

                            <!-- ─── Profile panel ─────────────────────────── -->
                            <div data-modal-panel="profile" class="space-y-4">
                                <div class="grid grid-cols-2 gap-4">
                                    <div class="form-group">
                                        <label class="details-label">Username</label>
                                        <input type="text" id="user-username" class="form-input" required>
                                    </div>
                                    <div class="form-group">
                                        <label class="details-label">Role</label>
                                        <select id="user-role" class="form-input" required>
                                            <option value="cashier">Cashier</option>
                                            <option value="manager">Manager</option>
                                            <option value="director">Director</option>
                                            <option value="designer">Designer</option>
                                            <option value="consultant">Consultant</option>
                                        </select>
                                    </div>
                                </div>

                                <div class="form-group">
                                    <label class="details-label">Full Name</label>
                                    <input type="text" id="user-fullname" class="form-input" required>
                                </div>

                                <div class="grid grid-cols-2 gap-4">
                                    <div class="form-group">
                                        <label class="details-label">Email</label>
                                        <input type="email" id="user-email" class="form-input">
                                    </div>
                                    <div class="form-group">
                                        <label class="details-label">Phone</label>
                                        <input type="tel" id="user-phone" class="form-input">
                                    </div>
                                </div>

                                <div class="form-group" id="password-group">
                                    <label class="details-label">Password</label>
                                    <div class="relative">
                                        <input type="password" id="user-password" class="form-input pr-10" minlength="6" data-on-keyup="Users.checkPasswordStrength($value)">
                                        <button type="button" class="absolute right-2 top-2 text-white/50 hover:text-white" data-on-click="Users.togglePassword('user-password')">
                                            <span class="material-icons-outlined text-sm" id="user-password-icon">visibility</span>
                                        </button>
                                    </div>
                                    <div class="h-1 mt-1 bg-white/10 rounded overflow-hidden">
                                        <div id="password-strength-bar" class="h-full w-0 transition-all duration-300"></div>
                                    </div>
                                    <p class="text-xs text-white/50 mt-1 flex justify-between">
                                        <span id="password-hint">Leave blank to keep current</span>
                                        <span id="password-strength-text" class="font-bold"></span>
                                    </p>
                                </div>

                                <div class="form-group flex items-center gap-2">
                                    <input type="checkbox" id="user-active" checked>
                                    <label for="user-active">Account Active</label>
                                </div>
                            </div>

                            <!-- ─── Access panel (v1.0.41 premium redesign) ── -->
                            <div data-modal-panel="access" class="hidden">
                                <div class="um-access-tip">
                                    <span class="material-icons-outlined um-access-tip-icon">info</span>
                                    <div>
                                        <b>Tick</b> a permission to give it to <i>this user only</i>.
                                        <b>Untick</b> a role default to take it away from this user.
                                        Changes apply instantly — no need to log out and back in.
                                    </div>
                                </div>

                                <div id="user-perms-director-note" class="um-access-director hidden">
                                    <span class="material-icons-outlined">workspace_premium</span>
                                    <div>
                                        <div class="um-access-director-title">Director — full access</div>
                                        <div class="um-access-director-sub">Directors bypass every permission check by design. Per-user overrides are disabled.</div>
                                    </div>
                                </div>

                                <div id="user-perms-block" class="hidden">
                                    <div class="um-access-summary">
                                        <div class="um-access-summary-main">
                                            <div class="um-access-summary-label">Effective permissions</div>
                                            <div class="um-access-summary-value">
                                                <span id="um-access-granted">0</span>
                                                <span class="um-access-summary-divider">of</span>
                                                <span id="um-access-total">0</span>
                                            </div>
                                            <div class="um-access-summary-bar"><div id="um-access-bar" class="um-access-summary-bar-fill"></div></div>
                                            <div class="um-access-summary-meta" id="user-perms-summary">No user loaded.</div>
                                        </div>
                                        <div class="um-access-summary-actions">
                                            <label class="um-access-toggle" title="Hide rows matching role defaults — show only this user's explicit grants/revokes.">
                                                <input type="checkbox" id="user-perms-only-overrides" data-on-change="Users.toggleOverridesOnly($el)">
                                                <span>Overrides only</span>
                                            </label>
                                            <button type="button" class="um-btn-ghost" data-on-click="Users.resetPermsToRoleDefaults()" title="Discard overrides — keep only this role's defaults">
                                                <span class="material-icons-outlined">restart_alt</span>
                                                Reset to role defaults
                                            </button>
                                        </div>
                                    </div>

                                    <div class="um-access-search">
                                        <span class="material-icons-outlined">search</span>
                                        <input type="search" id="user-perms-search" placeholder="Filter permissions — type 'inventory', 'sale.refund'…" data-on-input="Users.filterUserPerms($value)">
                                    </div>

                                    <div id="user-perms-grid" class="um-access-grid"></div>
                                </div>
                            </div>

                            <div class="um-modal-foot">
                                <button type="button" data-on-click="Utils.closeModal('user-modal')" class="um-btn-ghost">Cancel</button>
                                <button type="submit" class="um-btn-save">
                                    <span class="material-icons-outlined">save</span>
                                    Save changes
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `;

        this.attachEvents();
        if (this.activeTab === 'users') {
            this.loadUsers();
        } else {
            this.loadRoles();
        }
    },

    switchTab(tab) {
        this.activeTab = tab;
        const container = document.querySelector('#page-container') || document.querySelector('.main-content');
        if (container && container.firstElementChild && container.firstElementChild.parentNode) {
            this.render(container.firstElementChild.parentNode);
        } else {
            // Fallback if re-rendering from scratch
            const appContainer = document.getElementById('page-container');
            if (appContainer) this.render(appContainer);
        }
    },

    loadRoles() {
        if (typeof Permissions !== 'undefined') {
            const container = document.getElementById('roles-tab-content');
            Permissions.render(container);
            setTimeout(() => {
                const header = container.querySelector('.page-header');
                if (header) header.style.display = 'none';
            }, 50);
            document.getElementById('new-user-btn')?.classList.add('hidden');
            document.getElementById('user-search-wrap')?.classList.add('hidden');
        } else {
            document.getElementById('roles-tab-content').innerHTML = '<p class="p-4 text-red-400">Error: Permissions module not loaded.</p>';
        }
    },

    attachEvents() {
        // Search
        document.getElementById('user-search')?.addEventListener('input', (e) => {
            this.filterUsers(e.target.value);
        });

        // Form Submit
        document.getElementById('user-form')?.addEventListener('submit', (e) => this.handleSubmit(e));

        // Role change → re-render override grid against the new role's
        // defaults so the operator always sees "what this user would have
        // if I saved right now" without needing to click reset.
        document.getElementById('user-role')?.addEventListener('change', (e) => this.onRoleChange(e.target.value));
    },

    async loadUsers() {
        try {
            const users = await API.get('/users');
            this.allUsers = users || [];
            this.renderUserTable(this.allUsers);
        } catch (err) {
            Utils.toast('Failed to load users', 'error');
        }
    },

    /** Role chip filter (called by the chip strip). */
    setRoleFilter(role) {
        this.roleFilter = role || 'all';
        this.filterUsers();
    },

    filterUsers() {
        const term = (document.getElementById('user-search')?.value || '').toLowerCase();
        const role = this.roleFilter || 'all';
        const filtered = this.allUsers.filter(u => {
            if (role !== 'all' && u.role !== role) return false;
            if (!term) return true;
            return (
                (u.username || '').toLowerCase().includes(term) ||
                (u.full_name || '').toLowerCase().includes(term) ||
                (u.email && u.email.toLowerCase().includes(term))
            );
        });
        this.renderUserTable(filtered);
        this._renderFilterBar();
    },

    /** v1.0.35 — premium initials for the avatar (first letter of first
     *  + first letter of last word) so directors with long names still
     *  look clean. */
    _initials(name) {
        if (!name) return '?';
        const parts = String(name).trim().split(/\s+/);
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    },

    _renderStats() {
        const wrap = document.getElementById('um-stats');
        if (!wrap) return;
        const all = this.allUsers || [];
        const total    = all.length;
        const active   = all.filter(u => u.is_active).length;
        const inactive = total - active;
        const director = all.filter(u => u.role === 'director').length;
        wrap.innerHTML = `
            <div class="um-stat">
                <div class="um-stat-icon"><span class="material-icons-outlined">groups</span></div>
                <div class="um-stat-label">Total staff</div>
                <div class="um-stat-value">${total}</div>
                <div class="um-stat-hint">Across all roles</div>
            </div>
            <div class="um-stat um-stat-active">
                <div class="um-stat-icon"><span class="material-icons-outlined">check_circle</span></div>
                <div class="um-stat-label">Active</div>
                <div class="um-stat-value">${active}</div>
                <div class="um-stat-hint">Can sign in right now</div>
            </div>
            <div class="um-stat um-stat-inactive">
                <div class="um-stat-icon"><span class="material-icons-outlined">block</span></div>
                <div class="um-stat-label">Disabled</div>
                <div class="um-stat-value">${inactive}</div>
                <div class="um-stat-hint">Blocked from sign-in</div>
            </div>
            <div class="um-stat um-stat-director">
                <div class="um-stat-icon"><span class="material-icons-outlined">workspace_premium</span></div>
                <div class="um-stat-label">Directors</div>
                <div class="um-stat-value">${director}</div>
                <div class="um-stat-hint">Full-access accounts</div>
            </div>
        `;
    },

    _renderFilterBar() {
        const bar = document.getElementById('um-filter-bar');
        if (!bar) return;
        const counts = (this.allUsers || []).reduce((acc, u) => {
            acc[u.role] = (acc[u.role] || 0) + 1; return acc;
        }, {});
        const roles = ['all', 'director', 'manager', 'cashier', 'designer', 'consultant'];
        const labels = { all: 'All', director: 'Directors', manager: 'Managers', cashier: 'Cashiers', designer: 'Designers', consultant: 'Consultants' };
        bar.innerHTML = `
            <span class="um-filter-label">Filter by role</span>
            ${roles.map(r => `
                <button class="um-chip ${this.roleFilter === r ? 'active' : ''}" data-on-click="Users.setRoleFilter('${r}')">
                    ${labels[r]}
                    <span class="um-chip-count">${r === 'all' ? (this.allUsers || []).length : (counts[r] || 0)}</span>
                </button>
            `).join('')}
        `;
    },

    /** v1.0.35 — kept the name `renderUserTable` so filterUsers and
     *  loadUsers don't need to change, but it now renders a premium
     *  glass card grid instead of an HTML table. */
    renderUserTable(users) {
        const grid = document.getElementById('users-grid');
        if (!grid) return;
        this._renderStats();
        this._renderFilterBar();

        if (!users || users.length === 0) {
            grid.innerHTML = `
                <div class="um-empty" data-style="grid-column:1 / -1;">
                    <span class="material-icons-outlined">person_search</span>
                    <div>No staff match this filter.</div>
                </div>`;
            return;
        }

        grid.innerHTML = users.map(user => {
            const role = (user.role || '').toLowerCase();
            const safeId = String(user.user_id).replace(/'/g, "\\'");
            let permPill;
            if (role === 'director') {
                permPill = `<span class="um-perm-pill is-director" title="Director short-circuits every permission check"><span class="material-icons-outlined">workspace_premium</span>Full access</span>`;
            } else if ((user.override_count || 0) > 0) {
                const n = user.override_count;
                permPill = `<span class="um-perm-pill is-override" title="${n} explicit grant/revoke override${n === 1 ? '' : 's'} on top of the ${role} role defaults"><span class="material-icons-outlined">tune</span>${n} override${n === 1 ? '' : 's'}</span>`;
            } else {
                permPill = `<span class="um-perm-pill" title="No per-user overrides — uses the ${role} role defaults"><span class="material-icons-outlined">shield</span>Role default</span>`;
            }

            const statusCls = user.is_active ? 'active' : 'inactive';
            const statusTxt = user.is_active ? 'Active' : 'Disabled';
            const initials  = this._initials(user.full_name || user.username);

            return `
            <div class="um-card role-${role}">
                <div class="um-card-status ${statusCls}"><span class="um-status-dot"></span>${statusTxt}</div>
                <div class="um-card-head">
                    <div class="um-avatar">${initials}</div>
                    <div class="um-card-id">
                        <div class="um-card-name">${user.full_name || user.username}</div>
                        <div class="um-card-handle">@${user.username}</div>
                    </div>
                </div>
                <div class="um-card-meta">
                    <div class="um-card-meta-row">
                        <span class="um-role-badge">${role}</span>
                    </div>
                    <div class="um-card-meta-row" title="${user.email || ''}">
                        <span class="material-icons-outlined">mail</span>
                        <span>${user.email || '—'}</span>
                    </div>
                    <div class="um-card-meta-row" title="${user.phone || ''}">
                        <span class="material-icons-outlined">call</span>
                        <span>${user.phone || '—'}</span>
                    </div>
                </div>
                <div class="um-card-foot">
                    <button type="button" class="um-perm-pill-btn" data-style="background:transparent;border:0;padding:0;cursor:pointer;" data-on-click="Users.openAccessTab('${safeId}')">${permPill}</button>
                    <div class="um-card-actions">
                        <button class="um-icon-btn is-key" data-on-click="Users.openAccessTab('${safeId}')" title="Permissions">
                            <span class="material-icons-outlined">vpn_key</span>
                        </button>
                        <button class="um-icon-btn is-edit" data-on-click="Users.editUser('${safeId}')" title="Edit profile">
                            <span class="material-icons-outlined">edit</span>
                        </button>
                    </div>
                </div>
            </div>`;
        }).join('');
    },

    showAddModal() {
        document.getElementById('user-form').reset();
        document.getElementById('user-id').value = '';
        document.getElementById('user-modal-title').textContent = 'Add New User';
        document.getElementById('user-username').disabled = false;
        document.getElementById('password-hint').textContent = 'Default password is required';
        document.getElementById('password-group').style.display = 'block';

        // Reset password strength
        document.getElementById('password-strength-bar').style.width = '0%';
        document.getElementById('password-strength-text').textContent = '';

        // Add-User flow has no permissions to edit yet — clear the
        // grid, hide the access section, and start on the Profile tab.
        const block = document.getElementById('user-perms-block');
        const note  = document.getElementById('user-perms-director-note');
        const summary = document.getElementById('user-perms-summary');
        if (block) block.classList.add('hidden');
        if (note)  note.classList.add('hidden');
        if (summary) summary.textContent = 'Save the new user first, then come back here to set permissions.';
        document.getElementById('user-perms-grid').innerHTML = '';
        this.switchModalTab('profile');

        Utils.openModal('user-modal');
    },

    /** Switch between the modal's Profile and Access sub-tabs. Used by
     *  both editUser() (to land on Profile) and openAccessTab() (to
     *  land on Access). */
    switchModalTab(tab) {
        const t = (tab === 'access') ? 'access' : 'profile';
        document.querySelectorAll('[data-modal-tab]').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.modalTab === t);
            // v1.0.24 belt-and-suspenders: a stale `.hidden` on the
            // inactive tab button collapsed it on some renders, leaving
            // only one tab visible. Force-strip `.hidden` from every
            // tab button on every switch so both buttons always render.
            btn.classList.remove('hidden');
        });
        document.querySelectorAll('[data-modal-panel]').forEach((panel) => {
            panel.classList.toggle('hidden', panel.dataset.modalPanel !== t);
        });
    },

    /** Open the user-edit modal and jump straight to the Access tab —
     *  invoked by the key icon in each user row. */
    async openAccessTab(id) {
        await this.editUser(id);
        this.switchModalTab('access');
    },

    async editUser(id) {
        try {
            // Fetch user (now includes effective permissions), the
            // permission catalogue AND the role-default matrix in parallel
            // so the "reset to role defaults" button has something to
            // restore to without an extra roundtrip.
            const [user, catalogue, matrix] = await Promise.all([
                API.get(`/users/${id}`),
                API.get('/permissions').catch((e) => {
                    console.warn('[Users] permissions catalogue load failed:', e);
                    return [];
                }),
                API.get('/permissions/matrix').catch((e) => {
                    console.warn('[Users] permissions matrix load failed:', e);
                    return {};
                }),
            ]);

            if (!user) return;
            this._lastCatalogue = Array.isArray(catalogue) ? catalogue : [];
            this._lastMatrix    = matrix && typeof matrix === 'object' ? matrix : {};
            this._lastUserRole  = user.role;

            document.getElementById('user-id').value = user.user_id;
            document.getElementById('user-username').value = user.username;
            document.getElementById('user-username').disabled = true; // Cannot change username
            document.getElementById('user-fullname').value = user.full_name;
            document.getElementById('user-role').value = user.role;
            document.getElementById('user-email').value = user.email || '';
            document.getElementById('user-phone').value = user.phone || '';
            document.getElementById('user-active').checked = user.is_active;

            document.getElementById('user-password').value = '';
            document.getElementById('password-hint').textContent = 'Leave blank to keep current password';

            // Reset the "Show overrides only" toggle for each newly opened
            // user — the filter is intentionally per-modal-session so it
            // doesn't leak between audits of different users.
            const onlyTog = document.getElementById('user-perms-only-overrides');
            if (onlyTog) onlyTog.checked = false;
            const gridEl = document.getElementById('user-perms-grid');
            if (gridEl) gridEl.classList.remove('perm-only-overrides');

            this._renderPermissionGrid(user, Array.isArray(catalogue) ? catalogue : []);

            document.getElementById('user-modal-title').textContent = `Edit ${user.full_name || user.username}`;
            this.switchModalTab('profile');
            Utils.openModal('user-modal');
        } catch (err) {
            console.error('[Users] editUser failed', err);
            Utils.toast('Error fetching user details', 'error');
        }
    },

    /** Toggle the "Show overrides only" view on the Access tab. When
     *  active, rows whose data-perm-state is "default" or "denied" are
     *  hidden via CSS, leaving only the explicit grants/revokes that
     *  diverge from the role default — handy for quick audits. The
     *  state is intentionally not persisted across users; editUser()
     *  resets it whenever a different user is opened. */
    toggleOverridesOnly(el) {
        const grid = document.getElementById('user-perms-grid');
        if (!grid) return;
        grid.classList.toggle('perm-only-overrides', !!(el && el.checked));
    },

    /** Live-filter the override grid by permission name. */
    filterUserPerms(term) {
        const q = String(term || '').trim().toLowerCase();
        document.querySelectorAll('#user-perms-grid label').forEach((lbl) => {
            const name = (lbl.querySelector('input')?.value || '').toLowerCase();
            lbl.style.display = !q || name.includes(q) ? '' : 'none';
        });
        // Hide whole module fieldsets that have zero visible items
        document.querySelectorAll('#user-perms-grid fieldset').forEach((fs) => {
            const anyVisible = Array.from(fs.querySelectorAll('label'))
                .some((l) => l.style.display !== 'none');
            fs.style.display = anyVisible ? '' : 'none';
        });
    },

    /** Fired when the operator changes the role <select> in the user-edit
     *  modal. Re-renders the override grid against the NEW role's defaults
     *  so the visible permissions always match "what this user would have
     *  if I saved right now" — no need to know to click reset. Director
     *  hides the grid entirely (role short-circuits every check). */
    onRoleChange(newRole) {
        const role = String(newRole || '').trim();
        if (!role) return;

        const matrix    = this._lastMatrix    || {};
        const catalogue = this._lastCatalogue || [];
        // Add-User flow doesn't load these — the override grid isn't shown
        // there anyway, so silently bail rather than firing a toast.
        if (!catalogue.length) return;
        // Map permission_id UUIDs in the role-default matrix back to names
        // so _renderPermissionGrid (which keys off names) can tick them.
        // v1.0.17 — fall back to `p.id` for catalogues coming from the
        // legacy 002 schema (integer ids) so role-change reset still
        // works there. Matches _renderPermissionGrid's mapping exactly.
        const idToName = new Map(catalogue.map((p) => [String(p.id || p.permission_id), p.name]));
        const defaultNames = (matrix[role] || [])
            .map((id) => idToName.get(String(id)))
            .filter(Boolean);

        // Same code path as editUser() so director-hide / empty-catalogue
        // handling stays in one place. _renderPermissionGrid will also
        // call _updateOverallSummary so the new "M overrides" pill
        // refreshes for free.
        this._renderPermissionGrid({ role, permissions: defaultNames }, catalogue);

        if (role === 'director') {
            Utils.toast('Director has all permissions — overrides hidden.', 'info');
        } else {
            Utils.toast(`Overrides cleared — showing ${role} defaults. Save User to apply.`, 'success');
        }
    },

    /** Re-tick the override checkboxes so they reflect ONLY this role's
     *  defaults — i.e. the same effective set the user would have if
     *  every per-user override were removed. Reads the CURRENT value of
     *  the role <select> so an admin who picks a new role and then
     *  clicks reset gets the new role's defaults, not the old one's. */
    resetPermsToRoleDefaults() {
        const liveRole = (document.getElementById('user-role')?.value || '').trim();
        const role = liveRole || this._lastUserRole;
        const matrix = this._lastMatrix || {};
        const catalogue = this._lastCatalogue || [];
        if (!role || !catalogue.length) return;
        // matrix[role] is an array of permission_id UUIDs; map to names.
        // v1.0.17 — fall back to `p.id` for the legacy 002 schema
        // (integer ids) so reset still works there. Matches the
        // mapping in _renderPermissionGrid + onRoleChange exactly.
        const idToName = new Map(catalogue.map((p) => [String(p.id || p.permission_id), p.name]));
        const defaultNames = new Set(((matrix[role] || []).map((id) => idToName.get(String(id))).filter(Boolean)));
        const touchedModules = new Set();
        document.querySelectorAll('.user-perm-checkbox').forEach((cb) => {
            cb.checked = defaultNames.has(cb.value);
            // v1.0.17 — refresh the per-row state badge AND track
            // which module pills need recounting. Without this the
            // "default / + override / − override" badges (and the top
            // summary) would stay stale until the next manual click.
            this._updateRowState(cb);
            if (cb.dataset.module) touchedModules.add(cb.dataset.module);
        });
        // _updateRowState already triggers _updateModuleCount per
        // checkbox via its tail-call to the same helper, but we run
        // it once more per touched module to coalesce the count and
        // make the intent explicit.
        touchedModules.forEach((m) => this._updateModuleCount(m));
        this._updateOverallSummary();
        Utils.toast(`Reset to ${role} defaults — click Save User to apply.`, 'success');
    },

    /** Build the permission-override editor for the Access sub-tab.
     *  Hidden for Director (role short-circuits every check anyway).
     *  v1.0.16: redesigned — module accordions with grant/revoke-all
     *  bulk actions per module, "X of Y granted" pill, and a roomier
     *  description column.                                            */
    _renderPermissionGrid(user, catalogue) {
        const block   = document.getElementById('user-perms-block');
        const grid    = document.getElementById('user-perms-grid');
        const note    = document.getElementById('user-perms-director-note');
        const summary = document.getElementById('user-perms-summary');
        if (!block || !grid) return;

        if (!catalogue.length) {
            block.classList.add('hidden');
            if (note) note.classList.add('hidden');
            if (summary) summary.textContent = 'Permissions catalogue not available.';
            grid.innerHTML = '';
            return;
        }
        if (user.role === 'director') {
            block.classList.add('hidden');
            if (note) note.classList.remove('hidden');
            if (summary) summary.textContent = 'Director — full access (no overrides).';
            grid.innerHTML = '';
            return;
        }
        if (note) note.classList.add('hidden');
        block.classList.remove('hidden');

        const granted = new Set(user.permissions || []);

        // v1.0.17 — compute the role-default set so each row in the
        // grid can be flagged as one of:
        //   • "default"          — checked, matches role default       (neutral)
        //   • "override grant"   — checked, NOT in role defaults       (green hint)
        //   • "override revoke"  — unchecked, IS in role defaults      (amber hint)
        //   • "denied"           — unchecked, also NOT a default       (no badge)
        // The matrix is keyed by role → array of permission_id UUIDs
        // (or integers in the legacy 002 schema). Map back to names.
        const matrix    = this._lastMatrix || {};
        const idToName  = new Map(catalogue.map((p) => [String(p.id || p.permission_id), p.name]));
        const roleDefaults = new Set(((matrix[user.role] || [])
            .map((id) => idToName.get(String(id)))
            .filter(Boolean)));

        const groups = {};
        catalogue.forEach((p) => {
            const name = p.name || '';
            const prefix = (name.split('.')[0] || 'misc').toLowerCase();
            (groups[prefix] = groups[prefix] || []).push(p);
        });
        const orderedPrefixes = Object.keys(groups).sort();

        const html = orderedPrefixes.map((prefix) => {
            const items = groups[prefix].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            const grantedHere = items.filter((p) => granted.has(p.name)).length;
            const safePrefix = prefix.replace(/"/g, '&quot;');
            const rows = items.map((p) => {
                const isGranted = granted.has(p.name);
                const isDefault = roleDefaults.has(p.name);
                const checked   = isGranted ? 'checked' : '';
                const safeName = (p.name || '').replace(/"/g, '&quot;');
                const safeDesc = ((p.description || '').replace(/"/g, '&quot;'));
                const verb = (p.name || '').split('.').slice(1).join('.') || p.name || '';

                // Decorate row + emit a small status badge so the
                // operator can see at a glance which permissions are
                // role-defaults vs explicit overrides.
                let stateClass = '';
                let badge = '';
                if (isGranted && isDefault) {
                    stateClass = 'perm-state-default';
                    badge = '<span class="perm-state-badge state-default" title="Granted by the role default">default</span>';
                } else if (isGranted && !isDefault) {
                    stateClass = 'perm-state-override-grant';
                    badge = '<span class="perm-state-badge state-grant" title="Explicitly granted on top of the role defaults">+ override</span>';
                } else if (!isGranted && isDefault) {
                    stateClass = 'perm-state-override-revoke';
                    badge = '<span class="perm-state-badge state-revoke" title="Explicitly revoked even though the role would normally grant it">− override</span>';
                } else {
                    stateClass = 'perm-state-denied';
                }

                return `
                    <label class="um-perm-row perm-item ${stateClass}"
                           data-module="${safePrefix}" data-perm-state="${stateClass}">
                        <input type="checkbox" class="um-perm-check user-perm-checkbox"
                               value="${safeName}" ${checked} data-perm-name="${safeName}" data-module="${safePrefix}"
                               data-perm-default="${isDefault ? '1' : '0'}"
                               data-on-change="Users._updateRowState($el)">
                        <span class="um-perm-box"><span class="material-icons-outlined">check</span></span>
                        <div class="um-perm-body">
                            <div class="um-perm-title">
                                <span class="um-perm-verb">${verb || safeName}</span>
                                ${badge}
                            </div>
                            ${safeDesc ? `<div class="um-perm-desc">${safeDesc}</div>` : ''}
                        </div>
                    </label>`;
            }).join('');
            const icon = Users._moduleIcon(safePrefix);
            return `
                <details class="um-module" open>
                    <summary class="um-module-head">
                        <div class="um-module-head-left">
                            <span class="um-module-icon"><span class="material-icons-outlined">${icon}</span></span>
                            <div>
                                <div class="um-module-name">${safePrefix}</div>
                                <div class="um-module-count" id="perm-count-${safePrefix}">${grantedHere} of ${items.length} granted</div>
                            </div>
                        </div>
                        <div class="um-module-actions">
                            <button type="button" class="um-mini-btn is-grant"
                                    data-on-click="Users._bulkModule('${safePrefix}', true, $event)" title="Grant every permission in this module">
                                <span class="material-icons-outlined">done_all</span>Grant all
                            </button>
                            <button type="button" class="um-mini-btn is-revoke"
                                    data-on-click="Users._bulkModule('${safePrefix}', false, $event)" title="Revoke every permission in this module">
                                <span class="material-icons-outlined">remove_done</span>Revoke all
                            </button>
                            <span class="um-module-chevron material-icons-outlined">expand_more</span>
                        </div>
                    </summary>
                    <div class="um-module-body">${rows}</div>
                </details>`;
        }).join('');
        grid.innerHTML = html;

        // v1.0.17 — single source of truth for the summary live in
        // _updateOverallSummary(), driven by the rendered checkboxes
        // (so a half-edit reflects accurately). First call after
        // initial render gives us "X of Y granted · role defaults: N
        // · M overrides".
        this._updateOverallSummary();
    },

    /** Tick / untick every checkbox in the named module. Called by
     *  the per-module Grant all / Revoke all buttons. The event arg is
     *  passed in by the data-on-click dispatcher so we can stop the
     *  click bubbling up to the <summary> (which would otherwise
     *  collapse the accordion). */
    _bulkModule(module, on, ev) {
        if (ev && typeof ev.preventDefault === 'function') {
            ev.preventDefault();
            ev.stopPropagation();
        }
        document.querySelectorAll(`.user-perm-checkbox[data-module="${module}"]`).forEach((cb) => {
            cb.checked = !!on;
            // Re-compute each row's default/override state after a
            // bulk action so the badges stay accurate.
            this._updateRowState(cb);
        });
        this._updateModuleCount(module);
    },

    /** Refresh the "X / Y granted" pill on a module accordion after a
     *  per-permission tick or a bulk action. */
    _updateModuleCount(module) {
        const all = document.querySelectorAll(`.user-perm-checkbox[data-module="${module}"]`);
        const on  = Array.from(all).filter((cb) => cb.checked).length;
        const lab = document.getElementById(`perm-count-${module}`);
        if (lab) lab.textContent = `${on} / ${all.length} granted`;
        // Top-of-page summary is only the granted count + role defaults
        // — keep both in sync after every change so the operator can
        // see immediately how many overrides they're about to save.
        this._updateOverallSummary();
    },

    /** v1.0.17 — recompute one row's state badge + class after a
     *  toggle. Reads data-perm-default to avoid re-fetching the matrix.
     *  Called by every checkbox's data-on-change AND by _bulkModule. */
    _updateRowState(cb) {
        if (!cb || !cb.classList || !cb.classList.contains('user-perm-checkbox')) return;
        const label = cb.closest('label.perm-item');
        if (!label) return;
        const isGranted = !!cb.checked;
        const isDefault = cb.dataset.permDefault === '1';

        // Strip prior state classes so a flip from grant → revoke
        // doesn't leave the green tint behind.
        label.classList.remove(
            'perm-state-default',
            'perm-state-override-grant',
            'perm-state-override-revoke',
            'perm-state-denied',
        );

        let stateClass, badgeHtml;
        if (isGranted && isDefault) {
            stateClass = 'perm-state-default';
            badgeHtml = '<span class="perm-state-badge state-default" title="Granted by the role default">default</span>';
        } else if (isGranted && !isDefault) {
            stateClass = 'perm-state-override-grant';
            badgeHtml = '<span class="perm-state-badge state-grant" title="Explicitly granted on top of the role defaults">+ override</span>';
        } else if (!isGranted && isDefault) {
            stateClass = 'perm-state-override-revoke';
            badgeHtml = '<span class="perm-state-badge state-revoke" title="Explicitly revoked even though the role would normally grant it">− override</span>';
        } else {
            stateClass = 'perm-state-denied';
            badgeHtml = '';
        }
        label.classList.add(stateClass);
        label.dataset.permState = stateClass;

        // Replace the existing badge (if any) so the verb stays put.
        const verbCell = label.querySelector('.flex.items-center.gap-2');
        if (verbCell) {
            const old = verbCell.querySelector('.perm-state-badge');
            if (old) old.remove();
            if (badgeHtml) verbCell.insertAdjacentHTML('beforeend', badgeHtml);
        }

        // Module-level count pill stays in sync.
        const mod = cb.dataset.module;
        if (mod) this._updateModuleCount(mod);
    },

    /** Recount the overall "X of Y granted · role defaults: N · M
     *  overrides" summary at the top of the Access tab. Driven by the
     *  current state of every checkbox so a half-saved edit also
     *  reflects accurately.                                          */
    _updateOverallSummary() {
        const summary = document.getElementById('user-perms-summary');
        if (!summary) return;
        const all = document.querySelectorAll('.user-perm-checkbox');
        if (!all.length) return;
        let total = 0, grantedCount = 0, defaultCount = 0, overrideCount = 0;
        all.forEach((cb) => {
            total++;
            const isGranted = !!cb.checked;
            const isDefault = cb.dataset.permDefault === '1';
            if (isDefault) defaultCount++;
            if (isGranted) grantedCount++;
            if (isGranted !== isDefault) overrideCount++;
        });
        const role = (document.getElementById('user-role')?.value || this._lastUserRole || '').trim();
        const overrideText = overrideCount === 0
            ? '<span class="um-meta-muted">no overrides</span>'
            : `<span class="um-meta-warn">${overrideCount} override${overrideCount === 1 ? '' : 's'}</span>`;
        summary.innerHTML =
            `<span class="um-meta-muted">${role || 'role'} defaults: ${defaultCount}</span> ` +
            `&middot; ${overrideText}`;
        const g = document.getElementById('um-access-granted');
        const t = document.getElementById('um-access-total');
        const bar = document.getElementById('um-access-bar');
        if (g) g.textContent = grantedCount;
        if (t) t.textContent = total;
        if (bar) bar.style.width = total > 0 ? `${Math.round((grantedCount / total) * 100)}%` : '0%';
    },

    /** Map a module prefix (audit, cash, inventory, …) to a Material
     *  Icons Outlined glyph. Falls back to `folder` for unknown
     *  modules so a freshly-added namespace still renders cleanly. */
    _moduleIcon(prefix) {
        const map = {
            audit: 'gavel', backup: 'cloud_upload', cash: 'payments',
            customer: 'groups', device: 'devices', inventory: 'inventory_2',
            invoice: 'receipt_long', jobcard: 'assignment',
            loyalty: 'card_giftcard', notification: 'notifications',
            broadcast: 'campaign', product: 'shopping_bag',
            purchase: 'shopping_cart', quote: 'request_quote',
            report: 'bar_chart', return: 'undo', sale: 'point_of_sale',
            service: 'build', settings: 'settings', supplier: 'local_shipping',
            user: 'manage_accounts', permission: 'vpn_key',
            promotion: 'local_offer', approval: 'rule', credit: 'credit_card',
            stock: 'warehouse', expense: 'account_balance_wallet',
            ai: 'auto_awesome', daily: 'today', dashboard: 'dashboard',
        };
        return map[String(prefix || '').toLowerCase()] || 'folder';
    },

    togglePassword(inputId) {
        const input = document.getElementById(inputId);
        const icon = document.getElementById(inputId + '-icon');

        if (input.type === 'password') {
            input.type = 'text';
            // Switch to Eye Off Icon
            icon.innerHTML = `
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07-2.3 2.3"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
            `;
        } else {
            input.type = 'password';
            // Switch to Eye Icon
            icon.innerHTML = `
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
            `;
        }
    },

    checkPasswordStrength(password) {
        const bar = document.getElementById('password-strength-bar');
        const text = document.getElementById('password-strength-text');

        if (!password) {
            bar.style.width = '0%';
            bar.className = 'h-full w-0 transition-all duration-300';
            text.textContent = '';
            return;
        }

        let strength = 0;
        if (password.length > 5) strength += 20;
        if (password.length > 8) strength += 20;
        if (/[A-Z]/.test(password)) strength += 20;
        if (/[0-9]/.test(password)) strength += 20;
        if (/[^A-Za-z0-9]/.test(password)) strength += 20;

        bar.style.width = `${strength}%`;

        if (strength <= 40) {
            bar.className = 'h-full transition-all duration-300 bg-red-500';
            text.textContent = 'Weak';
            text.className = 'font-bold text-red-500';
        } else if (strength <= 80) {
            bar.className = 'h-full transition-all duration-300 bg-yellow-500';
            text.textContent = 'Medium';
            text.className = 'font-bold text-yellow-500';
        } else {
            bar.className = 'h-full transition-all duration-300 bg-green-500';
            text.textContent = 'Strong';
            text.className = 'font-bold text-green-500';
        }
    },

    async handleSubmit(e) {
        e.preventDefault();

        const id = document.getElementById('user-id').value;
        const data = {
            username: document.getElementById('user-username').value.trim(),
            full_name: document.getElementById('user-fullname').value.trim(),
            role: document.getElementById('user-role').value,
            email: document.getElementById('user-email').value.trim(),
            phone: document.getElementById('user-phone').value.trim(),
            is_active: document.getElementById('user-active').checked,
            password: document.getElementById('user-password').value
        };

        // Client-side Validation
        const missing = [];
        if (!data.username) missing.push('Username');
        if (!data.full_name) missing.push('Full Name');
        if (!data.role) missing.push('Role');
        if (!id && !data.password) missing.push('Password');

        if (missing.length > 0) {
            console.error('Validation Error: Missing fields', missing);
            Utils.toast(`Missing required fields: ${missing.join(', ')}`, 'warning');
            return;
        }

        if (id && !data.password) {
            delete data.password;
        }

        // Collect permission overrides ONLY when the perms block is
        // actually visible (i.e. editing a non-Director). Sending an
        // empty array on a Director would just be a no-op server-side,
        // but skipping the field keeps the audit log noise-free.
        const permsBlock = document.getElementById('user-perms-block');
        if (id && permsBlock && !permsBlock.classList.contains('hidden')) {
            const checked = Array.from(document.querySelectorAll('.user-perm-checkbox'))
                .filter((cb) => cb.checked)
                .map((cb) => cb.value);
            data.permissions = checked;
        }

        try {
            if (id) {
                await API.put(`/users/${id}`, data);
                Utils.toast('User updated successfully', 'success');
            } else {
                await API.post('/users', data);
                Utils.toast('User created successfully', 'success');
            }

            Utils.closeModal('user-modal');
            this.loadUsers();
        } catch (err) {
            console.error('Submit Error:', err);
            Utils.toast(err.message || 'Operation failed', 'error');
        }
    }
};

// Expose to global scope for delegated event handlers (data-on-* attributes).
window.Users = Users;
