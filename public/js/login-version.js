(function loadLoginVersion() {
    fetch('/version.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
            if (!d) return;
            var el = document.getElementById('login-version-text');
            if (!el) return;
            var when = '';
            if (d.released_at) {
                try {
                    when = ' · released ' + new Date(d.released_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
                } catch (e) { when = ''; }
            }
            el.textContent = 'Zachi Smart-POS v' + (d.version || '?') + when;
        })
        .catch(function () {
            var el = document.getElementById('login-version-text');
            if (el) el.textContent = 'Version unavailable';
        });
})();
