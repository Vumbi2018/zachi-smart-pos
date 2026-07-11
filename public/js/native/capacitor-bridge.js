/**
 * Zachi Smart-POS — Capacitor bridge.
 *
 * No-op on web. On Capacitor (Android today), this file:
 *   1. Routes the backend URL through Capacitor Preferences so the
 *      background runner can read it from a separate JS context.
 *   2. Replaces the WebView BarcodeDetector path with the ML Kit
 *      barcode plugin.
 *   3. Routes Printer.print() through a real custom Kotlin plugin
 *      (`ZachiUsbPrinter` — see apps/zachi-android/native-plugins/)
 *      with system-print-intent and window.print as fallbacks.
 *   4. Wires @capacitor/network so a returning signal triggers
 *      Sync.syncNow() instantly, on top of the 15-min runner cadence.
 *   5. Mirrors the offline queue + auth token + device id into
 *      Capacitor Preferences so runner.js can replay queued ops to
 *      `${backendUrl}/api/sync/push` while the app is closed.
 */
(function () {
    'use strict';

    const BACKEND_URL_KEY = 'zspos_backend_url';
    const RUNNER_PAYLOAD_KEY = 'zspos_runner_payload';
    const DEFAULT_BACKEND_URL = 'https://pos.zachicomputercentre.com';
    const MIRROR_INTERVAL_MS = 30 * 1000;

    const cap = () => (typeof window !== 'undefined' ? window.Capacitor : null);
    const isNative = () =>
        !!(cap() && typeof cap().isNativePlatform === 'function' && cap().isNativePlatform());
    const platform = () =>
        (cap() && typeof cap().getPlatform === 'function' && cap().getPlatform()) || 'web';
    const plugin = (name) => (cap() && cap().Plugins && cap().Plugins[name]) || null;

    // Seed default URL into localStorage on first native launch so api.js
    // can read it synchronously before Preferences resolves.
    if (isNative()) {
        try {
            if (!localStorage.getItem(BACKEND_URL_KEY)) {
                localStorage.setItem(BACKEND_URL_KEY, DEFAULT_BACKEND_URL);
            }
        } catch (_) { /* storage disabled */ }
    }

    const Native = {
        BACKEND_URL_KEY,
        DEFAULT_BACKEND_URL,
        isNative,
        platform,

        async getBackendUrl() {
            const Pref = plugin('Preferences');
            if (Pref) {
                try {
                    const r = await Pref.get({ key: BACKEND_URL_KEY });
                    if (r && r.value) {
                        try { localStorage.setItem(BACKEND_URL_KEY, r.value); } catch (_) {}
                        return r.value;
                    }
                } catch (e) { console.warn('[Native] Preferences.get:', e.message); }
            }
            try {
                const v = localStorage.getItem(BACKEND_URL_KEY);
                if (v) return v;
            } catch (_) {}
            return isNative() ? DEFAULT_BACKEND_URL : '';
        },

        async setBackendUrl(rawUrl) {
            const cleaned = String(rawUrl || '').trim().replace(/\/+$/, '');
            if (!/^https?:\/\//i.test(cleaned)) {
                throw new Error('Backend URL must start with http:// or https://');
            }
            try { localStorage.setItem(BACKEND_URL_KEY, cleaned); } catch (_) {}
            const Pref = plugin('Preferences');
            if (Pref) {
                try { await Pref.set({ key: BACKEND_URL_KEY, value: cleaned }); }
                catch (e) { console.warn('[Native] Preferences.set:', e.message); }
            }
            await Native._mirrorRunnerPayload();
            return cleaned;
        },

        /**
         * Snapshot { backendUrl, token, deviceId, ops[] } into
         * Capacitor Preferences so the background runner can replay
         * queued sales/mutations to /api/sync/push while the app is
         * closed. Idempotency keys ensure the WebView's next foreground
         * flush is a no-op for already-accepted ops.
         */
        async _mirrorRunnerPayload() {
            if (!isNative()) return;
            const Pref = plugin('Preferences');
            if (!Pref) return;
            try {
                const backendUrl = await Native.getBackendUrl();
                const token =
                    (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('zspos_token')) ||
                    null;
                const deviceId =
                    (typeof API !== 'undefined' && typeof API.getDeviceId === 'function' && API.getDeviceId()) ||
                    null;

                let ops = [];
                if (token && typeof DB !== 'undefined' && typeof Sync !== 'undefined') {
                    const [sales, muts] = await Promise.all([
                        DB.getQueuedSales().catch(() => []),
                        DB.getQueuedMutations().catch(() => []),
                    ]);
                    const salesOps = await Sync._buildOps(sales, '/sales', 'POST');
                    const mutOps = await Sync._buildOps(muts, null, null);
                    ops = [...salesOps, ...mutOps].map(({ _localId, _store, ...wire }) => wire);
                }

                await Pref.set({
                    key: RUNNER_PAYLOAD_KEY,
                    value: JSON.stringify({
                        backendUrl,
                        token,
                        deviceId,
                        ops,
                        updatedAt: Date.now(),
                    }),
                });
            } catch (e) {
                console.warn('[Native] mirror payload:', e.message);
            }
        },
    };

    window.Native = Native;

    if (isNative()) {
        window.__ZSPOS_NATIVE_UA__ =
            `ZachiPOS-${platform()}/1.0 (Capacitor; ${navigator.platform || 'unknown'})`;
    }

    // ── Native barcode scanner override ────────────────────────────
    function _installNativeScanner() {
        const Scanner = window.Scanner;
        if (!Scanner) return;
        const Barcode = plugin('BarcodeScanner');
        if (!Barcode) {
            console.warn('[Native] BarcodeScanner plugin not registered.');
            return;
        }

        let activeContainer = null;
        let activeOnDetect = null;
        let activeOnError = null;

        async function ensurePermission() {
            const r = await Barcode.checkPermissions();
            if (r && r.camera === 'granted') return;
            const req = await Barcode.requestPermissions();
            if (!req || req.camera !== 'granted') {
                throw new Error('Camera permission denied. Grant it in Settings → Apps → ZachiPOS.');
            }
        }

        async function startScan() {
            await ensurePermission();
            if (activeContainer) {
                activeContainer.innerHTML =
                    '<div data-style="color:#fff;padding:24px;text-align:center;">Native scanner active. Aim at a barcode…</div>';
            }
            try {
                const result = await Barcode.scan({
                    formats: ['CODE_128','CODE_39','CODE_93','EAN_13','EAN_8','ITF','QR_CODE','UPC_A','UPC_E','DATA_MATRIX','PDF_417','AZTEC'],
                });
                for (const c of (result && result.barcodes) || []) {
                    if (activeOnDetect) {
                        try { activeOnDetect(c.rawValue || c.displayValue, c.format); }
                        catch (cb) { console.error('[Native] onDetect:', cb); }
                    }
                }
            } catch (err) {
                if (activeOnError) activeOnError(err);
                else console.warn('[Native] scan rejected:', err.message);
            }
        }

        Scanner.init = async function (containerId, onDetect, onError) {
            const container = document.getElementById(containerId);
            if (!container) {
                const msg = `Scanner: container "#${containerId}" not found`;
                if (onError) onError(new Error(msg));
                return;
            }
            activeContainer = container;
            activeOnDetect = onDetect || null;
            activeOnError = onError || null;
            return startScan();
        };
        Scanner.start = () => startScan();
        Scanner.stop = () => { try { Barcode.stopScan && Barcode.stopScan(); } catch (_) {} };
        Scanner.isSupported = () => true;
        Scanner._native = true;
    }

    // ── Printer: real USB plugin first, then system print, then window.print ──
    const Printer = {
        async print(receiptHtml, options) {
            const opts = options || {};
            if (isNative()) {
                const usb = await this._tryUsbEscPos(receiptHtml, opts);
                if (usb && usb.printed) return usb;
                const intent = await this._tryPrintIntent(receiptHtml, opts);
                if (intent && intent.printed) return intent;
            }
            return this._tryWebPrint(receiptHtml, opts);
        },

        /**
         * Use the in-repo Kotlin plugin `ZachiUsbPrinter` (see
         * apps/zachi-android/native-plugins/zachi-usb-printer/). It
         * enumerates USB-OTG devices, matches a known thermal-printer
         * VID/PID, requests permission, claims the bulk OUT endpoint,
         * and writes ESC/POS bytes built from the receipt text.
         */
        async _tryUsbEscPos(receiptHtml) {
            const Usb = plugin('ZachiUsbPrinter');
            if (!Usb || typeof Usb.print !== 'function') {
                return { printed: false, reason: 'no-usb-plugin' };
            }
            try {
                const text = String(receiptHtml || '')
                    .replace(/<style[\s\S]*?<\/style>/gi, '')
                    .replace(/<script[\s\S]*?<\/script>/gi, '')
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<\/p>/gi, '\n')
                    .replace(/<[^>]+>/g, '')
                    .replace(/&nbsp;/g, ' ')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>');
                const r = await Usb.print({ text, cut: true });
                return { printed: !!(r && r.printed), via: 'usb-esc-pos', device: r && r.device };
            } catch (e) {
                console.warn('[Printer] USB plugin failed:', e.message);
                return { printed: false, reason: 'usb-error', error: e };
            }
        },

        async _tryPrintIntent(receiptHtml) {
            const PrinterPlugin = plugin('Printer');
            if (!PrinterPlugin || typeof PrinterPlugin.print !== 'function') {
                return { printed: false, reason: 'no-print-plugin' };
            }
            try {
                await PrinterPlugin.print({
                    content: receiptHtml,
                    name: `ZachiPOS-Receipt-${Date.now()}`,
                    orientation: 'portrait',
                });
                return { printed: true, via: 'print-intent' };
            } catch (e) {
                console.warn('[Printer] system intent failed:', e.message);
                return { printed: false, reason: 'intent-error', error: e };
            }
        },

        _tryWebPrint(receiptHtml) {
            try {
                const w = window.open('', '_blank', 'width=380,height=600');
                if (!w) return { printed: false, reason: 'popup-blocked' };
                w.document.write(`<!doctype html><html><head><title>Receipt</title></head><body>${receiptHtml}</body></html>`);
                w.document.close();
                w.focus();
                w.print();
                return { printed: true, via: 'window-print' };
            } catch (e) {
                return { printed: false, reason: 'web-error', error: e };
            }
        },
    };
    window.Printer = Printer;

    function _installNetworkWatcher() {
        const Network = plugin('Network');
        if (!Network) return;
        Network.addListener('networkStatusChange', (status) => {
            if (status && status.connected && typeof Sync !== 'undefined') {
                Sync.syncNow()
                    .then(() => Native._mirrorRunnerPayload())
                    .catch((e) => console.warn('[Native] syncNow:', e.message));
            }
        });
    }

    function _installMirrorRefresh() {
        const refresh = () => Native._mirrorRunnerPayload();
        // Refresh on common app-lifecycle moments and a slow heartbeat.
        document.addEventListener('visibilitychange', refresh);
        window.addEventListener('pageshow', refresh);
        window.addEventListener('online', refresh);
        window.addEventListener('offline', refresh);
        document.addEventListener('zspos:sync', refresh);
        setInterval(refresh, MIRROR_INTERVAL_MS);
    }

    function _boot() {
        if (!isNative()) return;
        _installNativeScanner();
        _installNetworkWatcher();
        _installMirrorRefresh();
        // Initial snapshot once the WebView and api.js are warm.
        setTimeout(() => Native._mirrorRunnerPayload(), 1500);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(_boot, 0);
    } else {
        document.addEventListener('DOMContentLoaded', () => setTimeout(_boot, 0));
    }
})();
