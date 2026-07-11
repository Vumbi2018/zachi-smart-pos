/**
 * My Profile page.
 *
 * Self-service screen so any signed-in user (cashier, director, etc.)
 * can:
 *   - view their account (username, role, created date) — read-only,
 *   - update their full name, email and phone number,
 *   - change their password (requires current password as proof).
 *
 * Username and role are intentionally read-only here. Those are
 * privileged operations (Director-only) and live in the Users
 * Management page; surfacing them here would invite confusion.
 *
 * All form handlers go through the delegated event system —
 * data-on-click / data-on-submit — to comply with the strict CSP
 * (no inline JavaScript). The `Profile` object is exposed on
 * `window` at the bottom for the delegation parser.
 */
const Profile = {
    _user: null,

    async render(container) {
        container.innerHTML = `
            <div class="page-header">
                <div>
                    <h1 class="page-title">My Profile</h1>
                    <p class="text-secondary">Update your contact details and password.</p>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="card">
                    <div class="card-header">
                        <h3>Account</h3>
                        <p class="text-sm text-secondary">Read-only details managed by your administrator.</p>
                    </div>
                    <div class="card-body" id="profile-account-body">
                        <p class="text-secondary">Loading…</p>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h3>Contact Details</h3>
                        <p class="text-sm text-secondary">Used for low-stock alerts, password resets and receipts.</p>
                    </div>
                    <div class="card-body">
                        <div class="form-group">
                            <label for="profile-full-name">Full Name</label>
                            <input type="text" id="profile-full-name" class="form-input" autocomplete="name">
                        </div>
                        <div class="form-group">
                            <label for="profile-email">Email</label>
                            <input type="email" id="profile-email" class="form-input"
                                   placeholder="you@example.com" autocomplete="email">
                        </div>
                        <div class="form-group">
                            <label for="profile-phone">Phone</label>
                            <input type="tel" id="profile-phone" class="form-input"
                                   placeholder="+260…" autocomplete="tel">
                        </div>
                        <div class="flex justify-end">
                            <button class="btn btn-primary" data-on-click="Profile.saveContact()">
                                <span class="material-icons-outlined text-sm">save</span> Save Changes
                            </button>
                        </div>
                    </div>
                </div>

                <div class="card md:col-span-2">
                    <div class="card-header">
                        <h3>Change Password</h3>
                        <p class="text-sm text-secondary">
                            For your safety we ask for your current password before
                            setting a new one. Minimum 8 characters.
                        </p>
                    </div>
                    <div class="card-body">
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div class="form-group">
                                <label for="profile-cur-pw">Current Password</label>
                                <input type="password" id="profile-cur-pw" class="form-input"
                                       autocomplete="current-password">
                            </div>
                            <div class="form-group">
                                <label for="profile-new-pw">New Password</label>
                                <input type="password" id="profile-new-pw" class="form-input"
                                       minlength="8" autocomplete="new-password">
                            </div>
                            <div class="form-group">
                                <label for="profile-new-pw2">Confirm New Password</label>
                                <input type="password" id="profile-new-pw2" class="form-input"
                                       minlength="8" autocomplete="new-password">
                            </div>
                        </div>
                        <div class="flex justify-end mt-2">
                            <button class="btn btn-primary" data-on-click="Profile.changePassword()">
                                <span class="material-icons-outlined text-sm">lock_reset</span> Update Password
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        await this.load();
    },

    async load() {
        try {
            const me = await API.get('/auth/me');
            this._user = me;

            const created = me.created_at
                ? new Date(me.created_at).toLocaleDateString()
                : '—';
            document.getElementById('profile-account-body').innerHTML = `
                <dl class="grid grid-cols-2 gap-y-2 text-sm">
                    <dt class="text-secondary">Username</dt>
                    <dd><strong>${this._escape(me.username || '')}</strong></dd>
                    <dt class="text-secondary">Role</dt>
                    <dd><span class="badge badge-info">${this._escape(me.role || '')}</span></dd>
                    <dt class="text-secondary">Member since</dt>
                    <dd>${created}</dd>
                    <dt class="text-secondary">App version</dt>
                    <dd id="profile-app-version">…</dd>
                </dl>
            `;
            this._loadVersion();

            document.getElementById('profile-full-name').value = me.full_name || '';
            document.getElementById('profile-email').value = me.email || '';
            document.getElementById('profile-phone').value = me.phone || '';
        } catch (err) {
            console.error('Profile load failed', err);
            document.getElementById('profile-account-body').innerHTML =
                `<p class="text-error">Failed to load profile: ${this._escape(err.message || String(err))}</p>`;
        }
    },

    async saveContact() {
        const full_name = document.getElementById('profile-full-name').value.trim();
        const email = document.getElementById('profile-email').value.trim();
        const phone = document.getElementById('profile-phone').value.trim();

        if (!full_name) {
            Utils.toast('Full name is required.', 'warning');
            return;
        }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            Utils.toast('Enter a valid email address.', 'warning');
            return;
        }

        try {
            const updated = await API.put('/auth/me', { full_name, email, phone });
            this._user = updated;
            // Refresh the cached user so the sidebar header updates on
            // next navigation. We update sessionStorage directly because
            // Utils only exposes a getUser() helper, not a setter.
            try {
                const cached = Utils.getUser() || {};
                sessionStorage.setItem('zspos_user', JSON.stringify({
                    ...cached,
                    full_name: updated.full_name,
                    email: updated.email,
                    phone: updated.phone,
                }));
            } catch (_) { /* sessionStorage may be unavailable in some shells */ }
            Utils.toast('Profile updated.', 'success');
        } catch (err) {
            Utils.toast(`Save failed: ${err.message || err}`, 'error');
        }
    },

    async changePassword() {
        const cur = document.getElementById('profile-cur-pw').value;
        const nw = document.getElementById('profile-new-pw').value;
        const nw2 = document.getElementById('profile-new-pw2').value;
        if (!cur || !nw) {
            Utils.toast('Enter your current and new password.', 'warning');
            return;
        }
        if (nw.length < 8) {
            Utils.toast('New password must be at least 8 characters.', 'warning');
            return;
        }
        if (nw !== nw2) {
            Utils.toast('New passwords do not match.', 'warning');
            return;
        }

        try {
            await API.post('/auth/me/password', { current_password: cur, new_password: nw });
            document.getElementById('profile-cur-pw').value = '';
            document.getElementById('profile-new-pw').value = '';
            document.getElementById('profile-new-pw2').value = '';
            Utils.toast('Password updated successfully.', 'success');
        } catch (err) {
            Utils.toast(`Password update failed: ${err.message || err}`, 'error');
        }
    },

    async _loadVersion() {
        const el = document.getElementById('profile-app-version');
        if (!el) return;
        try {
            const res = await fetch('/version.json', { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            const ver = this._escape(data.version || '?');
            const released = data.released_at
                ? ` <span class="text-xs text-secondary">(released ${new Date(data.released_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })})</span>`
                : '';
            el.innerHTML = `<strong>v${ver}</strong>${released}`;
        } catch (e) {
            el.textContent = 'unknown';
        }
    },

    _escape(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },
};

window.Profile = Profile;
