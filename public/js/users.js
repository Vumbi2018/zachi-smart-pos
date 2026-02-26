/**
 * Zachi Smart-POS - User Management Module
 * Director Only
 */
const Users = {
    activeTab: 'users',
    allUsers: [],

    render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">User & Access Management</h1>
                    <p class="text-secondary">Manage system users, roles, and permissions.</p>
                </div>
                <div class="flex gap-2">
                    <input type="text" id="user-search" placeholder="Search users..." class="form-input py-1 px-3 text-sm w-64" onkeyup="Users.filterUsers()">
                    <button onclick="Users.showAddModal()" class="btn btn-primary" id="new-user-btn">
                        <span class="material-icons-outlined">person_add</span>
                        New User
                    </button>
                </div>
            </div>

            <div class="tabs mb-4 border-b border-white/10">
                <button class="px-4 py-2 text-sm font-medium ${this.activeTab === 'users' ? 'text-primary border-b-2 border-primary' : 'text-white/60 hover:text-white'}" 
                        onclick="Users.switchTab('users')">
                    Users
                </button>
                <button class="px-4 py-2 text-sm font-medium ${this.activeTab === 'roles' ? 'text-primary border-b-2 border-primary' : 'text-white/60 hover:text-white'}" 
                        onclick="Users.switchTab('roles')">
                    Roles & Permissions
                </button>
            </div>

            <div id="users-tab-content" class="${this.activeTab === 'users' ? 'block' : 'hidden'}">
                <div class="card overflow-hidden">
                    <div class="overflow-x-auto">
                        <table class="w-full">
                            <thead>
                                <tr class="text-left border-b border-white/10">
                                    <th class="p-4">Staff</th>
                                    <th class="p-4">Role</th>
                                    <th class="p-4">Contact</th>
                                    <th class="p-4">Status</th>
                                    <th class="p-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody id="users-table-body">
                                <tr><td colspan="5" class="p-4 text-center">Loading...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div id="roles-tab-content" class="${this.activeTab === 'roles' ? 'block' : 'hidden'}">
                <!-- Permissions module renders here -->
            </div>

            <!-- Add/Edit User Modal -->
            <div id="user-modal" class="modal-overlay hidden">
                <div class="modal max-w-lg">
                    <div class="modal-header">
                        <h2 id="user-modal-title" class="text-xl font-bold">Add New User</h2>
                        <button onclick="Utils.closeModal('user-modal')" class="text-white/60 hover:text-white">
                            <span class="material-icons-outlined">close</span>
                        </button>
                    </div>
                    <div class="modal-body">
                        <form id="user-form" class="space-y-4">
                            <input type="hidden" id="user-id">
                            
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
                                    <input type="password" id="user-password" class="form-input pr-10" minlength="6" onkeyup="Users.checkPasswordStrength(this.value)">
                                    <button type="button" class="absolute right-2 top-2 text-white/50 hover:text-white" onclick="Users.togglePassword('user-password')">
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

                            <div class="flex justify-end gap-3 mt-6">
                                <button type="button" onclick="Utils.closeModal('user-modal')" class="btn btn-secondary">Cancel</button>
                                <button type="submit" class="btn btn-primary">Save User</button>
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
            document.getElementById('new-user-btn').classList.add('hidden');
            document.getElementById('user-search').classList.add('hidden');
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

    filterUsers() {
        const term = document.getElementById('user-search').value.toLowerCase();
        const filtered = this.allUsers.filter(u =>
            u.username.toLowerCase().includes(term) ||
            u.full_name.toLowerCase().includes(term) ||
            (u.email && u.email.toLowerCase().includes(term))
        );
        this.renderUserTable(filtered);
    },

    renderUserTable(users) {
        const tbody = document.getElementById('users-table-body');
        if (!tbody) return;

        if (!users || users.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-white/50">No users found</td></tr>`;
            return;
        }

        tbody.innerHTML = users.map(user => `
            <tr class="border-b border-white/5 hover:bg-white/5">
                <td class="p-4">
                    <div class="font-bold">${user.full_name}</div>
                    <div class="text-sm text-white/50">@${user.username}</div>
                </td>
                <td class="p-4">
                    <span class="px-2 py-1 rounded text-xs font-bold uppercase bg-white/10">
                        ${user.role}
                    </span>
                </td>
                <td class="p-4 text-sm text-white/70">
                    <div>${user.email || '-'}</div>
                    <div>${user.phone || '-'}</div>
                </td>
                <td class="p-4">
                    ${Utils.statusBadge(user.is_active ? 'Active' : 'Inactive')}
                </td>
                <td class="p-4 text-right">
                    <button onclick="Users.editUser(${user.user_id})" class="p-2 hover:bg-white/10 rounded text-blue-400" title="Edit">
                        <span class="material-icons-outlined">edit</span>
                    </button>
                </td>
            </tr>
        `).join('');
    },

    showAddModal() {
        document.getElementById('user-form').reset();
        document.getElementById('user-id').value = '';
        document.getElementById('modal-title').textContent = 'Add New User';
        document.getElementById('user-username').disabled = false;
        document.getElementById('password-hint').textContent = 'Default password is required';
        document.getElementById('password-group').style.display = 'block';

        // Reset password strength
        document.getElementById('password-strength-bar').style.width = '0%';
        document.getElementById('password-strength-text').textContent = '';

        Utils.openModal('user-modal');
    },

    async editUser(id) {
        try {
            const user = await API.get(`/users/${id}`);

            if (!user) return;

            document.getElementById('user-id').value = user.user_id;
            document.getElementById('user-username').value = user.username;
            document.getElementById('user-username').disabled = true; // Cannot change username
            document.getElementById('user-fullname').value = user.full_name;
            document.getElementById('modal-user-role').value = user.role;
            document.getElementById('user-email').value = user.email || '';
            document.getElementById('user-phone').value = user.phone || '';
            document.getElementById('user-active').checked = user.is_active;

            document.getElementById('user-password').value = '';
            document.getElementById('password-hint').textContent = 'Leave blank to keep current password';

            document.getElementById('modal-title').textContent = 'Edit User';
            Utils.openModal('user-modal');
        } catch (err) {
            Utils.toast('Error fetching user details', 'error');
        }
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
            role: document.getElementById('modal-user-role').value,
            email: document.getElementById('user-email').value.trim(),
            phone: document.getElementById('user-phone').value.trim(),
            is_active: document.getElementById('user-active').checked,
            password: document.getElementById('user-password').value
        };

        console.log('Submitting User Data:', JSON.stringify(data, null, 2));

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
