/**
 * Zachi Smart-POS - Utility Functions
 */
const Utils = {
    /**
     * Format currency (Zambian Kwacha)
     */
    currency(amount) {
        return 'K ' + parseFloat(amount || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },

    formatCurrency(amount) {
        return this.currency(amount);
    },

    /**
     * Format date
     */
    date(dateStr) {
        if (!dateStr) return '—';
        return new Date(dateStr).toLocaleDateString('en-ZM', {
            year: 'numeric', month: 'short', day: 'numeric'
        });
    },

    /**
     * Format date and time
     */
    dateTime(dateStr) {
        if (!dateStr) return '—';
        return new Date(dateStr).toLocaleString('en-ZM', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    },

    /**
     * Show toast notification
     */
    toast(message, type = 'info', duration = 4000) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
        const labels = { success: 'Success', error: 'Error', warning: 'Warning', info: 'Info' };

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.style.setProperty('--toast-duration', `${duration}ms`);
        toast.innerHTML = `
          <div class="toast-icon">${icons[type] || 'ℹ'}</div>
          <div class="toast-body">
            <div class="toast-title">${labels[type] || type}</div>
            <div class="toast-msg">${message}</div>
          </div>
          <button class="toast-close" title="Dismiss">✕</button>
          <div class="toast-progress"></div>
        `;

        // Dismiss on close button click
        toast.querySelector('.toast-close').addEventListener('click', () => dismiss(toast));

        container.appendChild(toast);

        function dismiss(el) {
            el.classList.add('dismissing');
            setTimeout(() => el.remove(), 280);
        }

        // Auto-dismiss after duration
        setTimeout(() => dismiss(toast), duration);
    },

    /**
     * Show premium confirm dialog — returns a Promise<boolean>
     * Usage: if (await Utils.confirm('Delete item?')) { ... }
     */
    confirm(message, { title = 'Confirm', confirmText = 'Confirm', cancelText = 'Cancel', type = 'danger' } = {}) {
        return new Promise((resolve) => {
            // Remove any existing confirm overlays
            document.getElementById('utils-confirm-overlay')?.remove();

            const icons = { danger: '⚠', warning: '⚠', info: 'ℹ', primary: '?', success: '✓' };
            const overlay = document.createElement('div');
            overlay.id = 'utils-confirm-overlay';
            overlay.className = 'utils-confirm-overlay';
            overlay.innerHTML = `
              <div class="utils-confirm-dialog" role="dialog" aria-modal="true">
                <div class="utils-confirm-icon utils-confirm-icon--${type}">${icons[type] || '?'}</div>
                <div class="utils-confirm-title">${title}</div>
                <div class="utils-confirm-msg">${message}</div>
                <div class="utils-confirm-actions">
                  <button class="btn btn-outline utils-confirm-cancel">${cancelText}</button>
                  <button class="btn btn-${type === 'danger' ? 'danger' : 'primary'} utils-confirm-ok">${confirmText}</button>
                </div>
              </div>
            `;

            document.body.appendChild(overlay);

            // Focus confirm button for keyboard accessibility
            const okBtn = overlay.querySelector('.utils-confirm-ok');
            const cancelBtn = overlay.querySelector('.utils-confirm-cancel');
            setTimeout(() => okBtn.focus(), 50);

            function done(result) {
                overlay.classList.add('utils-confirm-out');
                setTimeout(() => overlay.remove(), 220);
                resolve(result);
            }

            okBtn.addEventListener('click', () => done(true));
            cancelBtn.addEventListener('click', () => done(false));

            // Backdrop click = cancel
            overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });

            // Keyboard: Enter = confirm, Escape = cancel
            function onKey(e) {
                if (e.key === 'Enter') { e.preventDefault(); done(true); }
                if (e.key === 'Escape') { e.preventDefault(); done(false); }
                document.removeEventListener('keydown', onKey);
            }
            document.addEventListener('keydown', onKey);
        });
    },

    /**
     * Show premium prompt dialog — returns a Promise<string|null>
     * Usage: const reason = await Utils.prompt('Reason for voiding?');
     */
    prompt(message, { title = 'Input Required', defaultValue = '', placeholder = '', type = 'primary' } = {}) {
        return new Promise((resolve) => {
            document.getElementById('utils-confirm-overlay')?.remove();

            const icons = { primary: '✎', info: 'ℹ', warning: '⚠' };
            const overlay = document.createElement('div');
            overlay.id = 'utils-confirm-overlay';
            overlay.className = 'utils-confirm-overlay';
            overlay.innerHTML = `
              <div class="utils-confirm-dialog utils-prompt-dialog" role="dialog" aria-modal="true">
                <div class="utils-confirm-icon utils-confirm-icon--${type}">${icons[type] || '✎'}</div>
                <div class="utils-confirm-title">${title}</div>
                <div class="utils-confirm-msg">${message}</div>
                <div class="utils-prompt-input-wrapper">
                  <input type="text" class="utils-prompt-input" value="${defaultValue}" placeholder="${placeholder}" autocomplete="off">
                </div>
                <div class="utils-confirm-actions">
                  <button class="btn btn-outline utils-confirm-cancel">Cancel</button>
                  <button class="btn btn-primary utils-confirm-ok">Submit</button>
                </div>
              </div>
            `;

            document.body.appendChild(overlay);

            const input = overlay.querySelector('.utils-prompt-input');
            const okBtn = overlay.querySelector('.utils-confirm-ok');
            const cancelBtn = overlay.querySelector('.utils-confirm-cancel');

            // Focus and select input
            setTimeout(() => {
                input.focus();
                input.select();
            }, 50);

            function done(result) {
                overlay.classList.add('utils-confirm-out');
                setTimeout(() => overlay.remove(), 220);
                resolve(result);
            }

            okBtn.addEventListener('click', () => done(input.value));
            cancelBtn.addEventListener('click', () => done(null));

            // Escape / Enter
            const onKey = (e) => {
                if (e.key === 'Enter') { e.preventDefault(); done(input.value); }
                if (e.key === 'Escape') { e.preventDefault(); done(null); }
                if (e.key === 'Enter' || e.key === 'Escape') {
                    input.removeEventListener('keydown', onKey);
                }
            };
            input.addEventListener('keydown', onKey);

            overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
        });
    },

    /**
     * Show modal (HTML content)
     */
    showModal(html) {
        const overlay = document.getElementById('modal-overlay');
        const content = document.getElementById('modal-content');
        if (content) {
            content.innerHTML = html;
            content.classList.remove('hidden');
        }
        if (overlay) overlay.classList.remove('hidden');
    },

    /**
     * Open specific modal by ID
     */
    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('hidden');
        } else {
            console.error(`Modal with ID '${modalId}' not found.`);
        }
    },

    /**
     * Close modal
     */
    closeModal(modalId = null) {
        if (modalId) {
            // Close specific named modal
            const modal = document.getElementById(modalId);
            if (modal) modal.classList.add('hidden');
        } else {
            // Close generic overlay modal
            const overlay = document.getElementById('modal-overlay');
            if (overlay) overlay.classList.add('hidden');

            // Also close any open specific modals just in case
            document.querySelectorAll('.modal').forEach(m => {
                if (!m.id.includes('overlay')) m.classList.add('hidden');
            });
        }
    },

    /**
     * Get current user from localStorage
     */
    getUser() {
        const data = localStorage.getItem('zspos_user');
        return data ? JSON.parse(data) : null;
    },

    /**
     * Debounce function
     */
    debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    },

    /**
     * Generate a status badge
     */
    statusBadge(status) {
        const map = {
            'Paid': 'success', 'Partial': 'warning', 'Credit': 'danger',
            'Pending': 'neutral', 'Designing': 'info', 'Printing': 'warning',
            'Completed': 'success', 'Collected': 'success',
        };
        const cls = map[status] || 'neutral';
        return `<span class="badge badge-${cls}">${status}</span>`;
    }
};

// Close modal on overlay click
document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) Utils.closeModal();
});
