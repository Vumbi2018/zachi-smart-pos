(function () {
    'use strict';
    var W = typeof window !== 'undefined' ? window : null;
    if (!W) return;

    var fired = false;
    var attempts = 0;
    var MAX_ATTEMPTS = 80;

    function tryNotify() {
        if (fired) return;
        attempts++;
        try {
            var Cap = W.Capacitor;
            if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) {
                fired = true;
                return;
            }
            var Plugins = Cap.Plugins || {};
            var Updater = Plugins.CapacitorUpdater;
            if (Updater && typeof Updater.notifyAppReady === 'function') {
                fired = true;
                Updater.notifyAppReady()
                    .then(function () {
                        try { console.log('[ota-ready] notifyAppReady OK (attempt ' + attempts + ')'); } catch (_) {}
                    })
                    .catch(function (err) {
                        try { console.log('[ota-ready] notifyAppReady rejected', err); } catch (_) {}
                    });
                return;
            }
        } catch (err) {
            try { console.log('[ota-ready] tryNotify threw', err); } catch (_) {}
        }
        if (attempts < MAX_ATTEMPTS) {
            setTimeout(tryNotify, 50);
        } else {
            try { console.log('[ota-ready] gave up after ' + attempts + ' attempts'); } catch (_) {}
        }
    }

    tryNotify();
})();
