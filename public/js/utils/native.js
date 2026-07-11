/**
 * Native shim — one helper to launch URLs (whatsapp:, sms:, mailto:,
 * https://) regardless of whether we're in:
 *
 *   - The Tauri desktop shell (window.IS_TAURI_DESKTOP === true)
 *     → use ZachiDesktop.openExternal which calls plugin:shell|open.
 *     Required because Tauri's webview won't navigate to custom
 *     schemes like whatsapp:// without going through the shell
 *     plugin (and we configured `shell:default` capability).
 *
 *   - Capacitor (Android/iOS) → use the App plugin's openUrl when
 *     present. window.open() works for sms: but custom schemes
 *     are unreliable.
 *
 *   - Plain browser → fall back to window.open() for https/http
 *     and window.location.href for sms:/mailto:/whatsapp: which
 *     the OS handler picks up.
 *
 * Each path catches its own errors so the caller doesn't have to.
 * Returns true if at least one path appeared to launch the URL.
 */
(function () {
    function isCustomScheme(url) {
        return /^(whatsapp|sms|mailto|tel):/i.test(url);
    }

    async function tryTauri(url) {
        try {
            if (window.IS_TAURI_DESKTOP && window.ZachiDesktop && window.ZachiDesktop.openExternal) {
                return await window.ZachiDesktop.openExternal(url);
            }
        } catch (e) {
            console.warn('[Native] Tauri openExternal threw:', e);
        }
        return false;
    }

    async function tryCapacitor(url) {
        try {
            const cap = window.Capacitor;
            if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return false;
            const App = cap.Plugins && cap.Plugins.App;
            if (App && typeof App.openUrl === 'function') {
                await App.openUrl({ url });
                return true;
            }
            // Fallback: Browser plugin handles https well.
            const Browser = cap.Plugins && cap.Plugins.Browser;
            if (Browser && typeof Browser.open === 'function' && /^https?:/i.test(url)) {
                await Browser.open({ url });
                return true;
            }
        } catch (e) {
            console.warn('[Native] Capacitor openUrl threw:', e);
        }
        return false;
    }

    function tryWeb(url) {
        try {
            if (isCustomScheme(url)) {
                // window.open() with custom schemes is silently
                // blocked by some browsers. Navigating top-level is
                // the most reliable handoff to the OS.
                window.location.href = url;
            } else {
                const win = window.open(url, '_blank', 'noopener');
                if (!win) {
                    // Pop-up blocker — last-resort top-level nav.
                    window.location.href = url;
                }
            }
            return true;
        } catch (e) {
            console.error('[Native] Web fallback failed:', e);
            return false;
        }
    }

    // Extend the existing window.Native (installed by capacitor-bridge.js)
    // instead of replacing it — overwriting would clobber getBackendUrl,
    // setBackendUrl, isNative, _mirrorRunnerPayload, etc.
    const existing = (typeof window !== 'undefined' && window.Native) || {};
    window.Native = Object.assign(existing, {
        async openExternal(url) {
            if (!url) return false;
            if (await tryTauri(url)) return true;
            if (await tryCapacitor(url)) return true;
            return tryWeb(url);
        },
    });
})();
