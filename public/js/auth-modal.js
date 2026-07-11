// Forgot-password / reset-password modal handler.
// Loaded as an external script so the strict CSP can disallow inline <script>.
(function () {
    function init() {
        const overlay = document.getElementById('auth-modal-overlay');
        if (!overlay) return;

        const title = document.getElementById('auth-modal-title');
        const forgotForm = document.getElementById('forgot-form');
        const resetForm = document.getElementById('reset-form');
        const forgotMsg = document.getElementById('forgot-message');
        const resetMsg = document.getElementById('reset-message');

        function show(mode) {
            overlay.classList.remove('hidden');
            if (mode === 'reset') {
                title.textContent = 'Reset Password';
                forgotForm.classList.add('hidden');
                resetForm.classList.remove('hidden');
            } else {
                title.textContent = 'Forgot Password';
                forgotForm.classList.remove('hidden');
                resetForm.classList.add('hidden');
            }
            forgotMsg.textContent = '';
            resetMsg.textContent = '';
        }
        function hide() {
            overlay.classList.add('hidden');
        }

        const link = document.getElementById('forgot-password-link');
        if (link) {
            link.addEventListener('click', function (e) {
                e.preventDefault();
                show('forgot');
            });
        }
        const closeBtn = document.getElementById('auth-modal-close');
        if (closeBtn) closeBtn.addEventListener('click', hide);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) hide();
        });

        forgotForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            forgotMsg.style.color = '';
            forgotMsg.textContent = 'Sending...';
            const username = document.getElementById('forgot-username').value.trim();
            try {
                const r = await fetch('/api/auth/forgot-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username }),
                });
                const data = await r.json().catch(function () {
                    return {};
                });
                forgotMsg.style.color = '#4ade80';
                forgotMsg.textContent =
                    data.message ||
                    'If an account exists, a password reset email has been sent.';
            } catch (err) {
                forgotMsg.style.color = '#f87171';
                forgotMsg.textContent = 'Network error. Please try again.';
            }
        });

        // Pull the reset token from either the search query (`?reset_token=…`,
        // legacy form) or the hash route (`#/reset-password?token=…`, the
        // shape the backend currently emails out).
        function readResetToken() {
            try {
                const search = new URLSearchParams(window.location.search);
                if (search.get('reset_token')) return search.get('reset_token');
                if (search.get('token')) return search.get('token');

                const hash = window.location.hash || '';
                const qIdx = hash.indexOf('?');
                if (qIdx >= 0) {
                    const hashParams = new URLSearchParams(hash.slice(qIdx + 1));
                    if (hashParams.get('token')) return hashParams.get('token');
                    if (hashParams.get('reset_token')) return hashParams.get('reset_token');
                }
            } catch (_) {
                // Fall through and return null.
            }
            return null;
        }

        resetForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            resetMsg.style.color = '';
            const pw = document.getElementById('reset-password').value;
            const pw2 = document.getElementById('reset-password-confirm').value;
            if (pw !== pw2) {
                resetMsg.style.color = '#f87171';
                resetMsg.textContent = 'Passwords do not match.';
                return;
            }
            const token = readResetToken();
            if (!token) {
                resetMsg.style.color = '#f87171';
                resetMsg.textContent =
                    'Missing reset token. Please use the link in your email.';
                return;
            }
            resetMsg.textContent = 'Updating...';
            try {
                const r = await fetch('/api/auth/reset-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // Send both `password` and `new_password` so the request
                    // works regardless of which field the backend reads.
                    body: JSON.stringify({
                        token: token,
                        password: pw,
                        new_password: pw,
                    }),
                });
                const data = await r.json().catch(function () {
                    return {};
                });
                if (r.ok) {
                    resetMsg.style.color = '#4ade80';
                    resetMsg.textContent =
                        (data.message || 'Password updated.') + ' Redirecting...';
                    setTimeout(function () {
                        // Strip both ?reset_token=… and #/reset-password?token=… so
                        // the URL is clean before the user lands on the login form.
                        window.location.hash = '';
                        window.location.search = '';
                    }, 1500);
                } else {
                    resetMsg.style.color = '#f87171';
                    resetMsg.textContent = data.error || 'Could not reset password.';
                }
            } catch (err) {
                resetMsg.style.color = '#f87171';
                resetMsg.textContent = 'Network error. Please try again.';
            }
        });

        // Auto-open the reset form if the user landed via an emailed link.
        // Backend sends links shaped like  /#/reset-password?token=…  so we
        // also have to look at window.location.hash, not just .search.
        if (readResetToken()) show('reset');

        // Notification bell now uses data-on-click="App.openNotifications()"
        // to navigate to the dedicated #/notifications page — no dropdown
        // toggle to wire up here anymore.
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
