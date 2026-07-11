/**
 * apps/zachi-pos/public/js/ota-bridge.js
 *
 * Task #65 — OTA update bridge. Same file ships in the web/PWA bundle,
 * the Capacitor (Android) wrapper, and the Tauri (Windows) wrapper.
 * It detects which shell it is running inside and wires up the right
 * over-the-air update path:
 *
 *   • Browser / PWA          → no-op. The server already serves the
 *                              latest assets; the next refresh has them.
 *   • Capacitor (Android)    → calls CapacitorUpdater.notifyAppReady()
 *                              so the Capgo plugin marks the freshly
 *                              swapped bundle as healthy and refuses to
 *                              roll back. The actual download is driven
 *                              by `autoUpdate: true` in
 *                              apps/zachi-android/capacitor.config.json.
 *   • Tauri (Windows)        → polls the configured updater endpoint
 *                              on launch and, if a signed update is
 *                              available, downloads + installs it
 *                              silently. Falls back cleanly when the
 *                              OTA host is unreachable.
 *
 * No inline handlers, no inline styles — CSP-safe. Pure detection +
 * dynamic import of the per-platform SDK; on the web the dynamic
 * imports never fire so the bundle stays untouched.
 */
(function () {
    'use strict';

    var W = typeof window !== 'undefined' ? window : null;
    if (!W) return;

    var IS_CAP = !!(W.Capacitor && W.Capacitor.isNativePlatform && W.Capacitor.isNativePlatform());
    var IS_TAURI = !!W.__TAURI_INTERNALS__;

    function log(msg, extra) {
        try {
            if (extra !== undefined) {
                console.log('[ota-bridge] ' + msg, extra);
            } else {
                console.log('[ota-bridge] ' + msg);
            }
        } catch (_e) { /* console may be stripped on some shells */ }
    }

    // --- Capacitor / Android via @capgo/capacitor-updater -------------
    // Capgo handles download + swap natively. We only need to tell it
    // "the new bundle booted successfully, don't roll me back" once the
    // app has reached an interactive state. Without this call the
    // plugin's `appReadyTimeout` will fire and revert.
    function bootCapgo() {
        if (!IS_CAP) return;
        // The plugin is registered on the global Capacitor.Plugins object
        // once the native bridge boots. Wait one tick so we don't race it.
        setTimeout(function () {
            try {
                var Plugins = W.Capacitor && W.Capacitor.Plugins;
                var Updater = Plugins && Plugins.CapacitorUpdater;
                if (!Updater || typeof Updater.notifyAppReady !== 'function') {
                    log('CapacitorUpdater plugin not available — skipping notifyAppReady');
                    return;
                }
                Updater.notifyAppReady()
                    .then(function () { log('CapacitorUpdater.notifyAppReady OK'); })
                    .catch(function (err) { log('CapacitorUpdater.notifyAppReady failed', err); });
            } catch (err) {
                log('Capgo bridge threw', err);
            }
        }, 0);
    }

    // --- Tauri / Windows via tauri-plugin-updater --------------------
    // The POS public/ bundle is plain static (no bundler resolves bare
    // module specifiers at runtime), so we cannot `import('@tauri-apps/
    // plugin-updater')` here. Instead we invoke the plugin commands
    // directly through `window.__TAURI_INTERNALS__.invoke`, the same
    // pattern the existing tauri-bridge.js uses for printer / cash
    // drawer / counter-mode commands. This is the documented
    // bundler-free path for Tauri 2.
    function tauriInvoke(cmd, args) {
        var internals = W.__TAURI_INTERNALS__;
        if (internals && typeof internals.invoke === 'function') {
            return internals.invoke(cmd, args || {});
        }
        if (W.__TAURI__ && W.__TAURI__.core && typeof W.__TAURI__.core.invoke === 'function') {
            return W.__TAURI__.core.invoke(cmd, args || {});
        }
        return Promise.reject(new Error('Tauri invoke unavailable'));
    }

    // Tauri / Windows runs TWO parallel update channels:
    //
    //   (a) web-bundle swap — primary path, mirrors how Android works:
    //       pull the same web-<version>.zip Capgo consumes, verify
    //       sha256, atomic-swap into %APPDATA%\zachi-pos\web-bundle\.
    //       The next launch boots straight into the new UI; the MSI
    //       is never touched. This is what satisfies the task's
    //       "without rebuilding installers" objective.
    //
    //   (b) tauri-plugin-updater — secondary path, only fires when
    //       the manifest carries a `platforms["windows-x86_64"]`
    //       entry (i.e. we cut a real Tauri binary release because
    //       lib.rs / Cargo deps changed). minisign-verified.
    //
    // Both swallow errors so the till always boots on its current
    // bundle if the OTA host is unreachable.
    var WEB_MANIFEST_URL = 'https://pos.zachicomputercentre.com/ota/windows-latest.json';

    // Manifest fetch goes through a Rust command (ureq + rustls)
    // instead of `fetch()`. The webview's `zachi://localhost` origin
    // is cross-origin to the OTA host, and the OTA host intentionally
    // serves no CORS headers — pulling on the Rust side dodges the
    // CORS preflight entirely and keeps the same code path the
    // tauri-plugin-updater itself uses for its manifest.
    function fetchManifest() {
        return tauriInvoke('ota_fetch_windows_manifest', { url: WEB_MANIFEST_URL })
            .then(function (body) { return JSON.parse(body); });
    }

    // Semver-ish comparator; falls back to string compare. Good enough
    // for the "1.0.31" / "1.0.31.1" shapes we use.
    function isNewer(remote, local) {
        if (!remote) return false;
        if (!local) return true;
        var a = String(remote).split('.').map(function (n) { return parseInt(n, 10) || 0; });
        var b = String(local).split('.').map(function (n) { return parseInt(n, 10) || 0; });
        var len = Math.max(a.length, b.length);
        for (var i = 0; i < len; i++) {
            var x = a[i] || 0, y = b[i] || 0;
            if (x > y) return true;
            if (x < y) return false;
        }
        return false;
    }

    function bootTauriWebBundle(manifest) {
        var wb = manifest && manifest.web_bundle;
        if (!wb || !wb.url || !wb.sha256) {
            log('Tauri web-bundle: manifest has no web_bundle entry');
            return Promise.resolve();
        }
        return tauriInvoke('ota_web_bundle_current_version').then(function (current) {
            if (!isNewer(manifest.version, current)) {
                log('Tauri web-bundle: already on ' + (current || 'installer bundle'));
                return;
            }
            log('Tauri web-bundle: pulling ' + manifest.version + ' (from ' + (current || 'installer') + ')');
            return tauriInvoke('ota_web_bundle_pull', {
                url: wb.url,
                expectedSha256: wb.sha256,
                version: manifest.version,
            }).then(function () {
                log('Tauri web-bundle: swap OK, relaunching');
                return tauriInvoke('plugin:process|restart');
            });
        });
    }

    function bootTauriBinaryUpdater() {
        // Only attempt the binary-updater channel; if the manifest
        // has no Windows platform entry the plugin returns
        // `{available:false}` and we no-op.
        return tauriInvoke('plugin:updater|check').then(function (update) {
            // Tauri v2 returns the Update object directly (or null when
            // no update is available); older shapes returned
            // `{available: bool, ...}`. Accept either: any truthy
            // payload that is NOT the explicit `{available:false}`
            // counts as "update found".
            if (!update) return;
            if (typeof update.available === 'boolean' && !update.available) return;
            log('Tauri binary: update ' + (update.version || '?') + ' available, downloading');
            return tauriInvoke('plugin:updater|download_and_install')
                .then(function () {
                    log('Tauri binary: installed, relaunching');
                    return tauriInvoke('plugin:process|restart');
                });
        });
    }

    function bootTauri() {
        if (!IS_TAURI) return;
        setTimeout(function () {
            // The two channels are deliberately independent: a failure
            // (network, parse, sha mismatch) in the web-bundle path
            // must NOT prevent the binary updater from running, and
            // vice-versa. We log every failure but otherwise swallow
            // it so the till keeps booting on its current bundle.
            fetchManifest()
                .then(bootTauriWebBundle)
                .catch(function (err) {
                    log('Tauri web-bundle: check failed (keeping current bundle)', err);
                });
            bootTauriBinaryUpdater().catch(function (err) {
                log('Tauri binary: check failed (keeping current MSI)', err);
            });
        }, 0);
    }

    function boot() {
        if (IS_CAP) bootCapgo();
        if (IS_TAURI) bootTauri();
    }

    // ── Manual update entry point ─────────────────────────────────────
    // Exposed as window.ZachiOTA.checkAndApply() so a "Check for updates"
    // button anywhere in the UI can force-pull the latest bundle even
    // when autoUpdate hasn't fired yet (e.g. flaky network on launch,
    // or the user wants to update right now).
    //
    // Status callback receives one of:
    //   { stage:'checking' }
    //   { stage:'up-to-date', current }
    //   { stage:'downloading', version }
    //   { stage:'applying',    version }
    //   { stage:'reloading',   version }   // app is about to reboot
    //   { stage:'error',       message }
    function capgoUpdater() {
        var Plugins = W.Capacitor && W.Capacitor.Plugins;
        return Plugins && Plugins.CapacitorUpdater;
    }

    function tauriBundleApi() {
        return IS_TAURI ? {
            current: function () { return tauriInvoke('ota_web_bundle_current_version'); },
            fetchManifest: fetchManifest,
            apply: bootTauriWebBundle,
        } : null;
    }

    function manualCheckAndApply(onStatus) {
        var notify = typeof onStatus === 'function' ? onStatus : function () {};

        // --- Capacitor / Android ---------------------------------------
        // We deliberately bypass U.getLatest() and fetch the OTA manifest
        // ourselves over plain HTTPS. This way the update works even if
        // the APK was built without the CapacitorUpdater config block in
        // capacitor.config.json (some older builds shipped without it),
        // because we hand the {url, version, sessionKey, checksum} tuple
        // straight to download().
        if (IS_CAP) {
            var U = capgoUpdater();
            if (!U || typeof U.download !== 'function' || typeof U.set !== 'function') {
                notify({ stage: 'error', message: 'Update plugin missing from this APK build — a one-time reinstall is required.' });
                return Promise.resolve();
            }
            notify({ stage: 'checking' });
            var manifestUrl = 'https://pos.zachicomputercentre.com/ota/android-latest.json?t=' + Date.now();
            return fetch(manifestUrl, { cache: 'no-store' })
                .then(function (r) {
                    if (!r.ok) throw new Error('Update server returned HTTP ' + r.status);
                    return r.json();
                })
                .then(function (latest) {
                    var newVer = latest && latest.version;
                    if (!newVer || !latest.url) {
                        notify({ stage: 'error', message: 'Update manifest is missing version/url.' });
                        return;
                    }
                    var getCur = (typeof U.current === 'function')
                        ? U.current().catch(function () { return null; })
                        : Promise.resolve(null);
                    return getCur.then(function (curObj) {
                        var curVer = (curObj && curObj.bundle && curObj.bundle.version) || (curObj && curObj.version) || null;
                        if (curVer && String(curVer) === String(newVer)) {
                            notify({ stage: 'up-to-date', current: curVer });
                            return;
                        }
                        notify({ stage: 'downloading', version: newVer });
                        var dlArgs = { url: latest.url, version: newVer };
                        if (latest.sessionKey) dlArgs.sessionKey = latest.sessionKey;
                        if (latest.checksum)   dlArgs.checksum   = latest.checksum;
                        return U.download(dlArgs)
                            .then(function (bundle) {
                                notify({ stage: 'applying', version: newVer });
                                return U.set({ id: bundle.id });
                            })
                            .then(function () {
                                notify({ stage: 'reloading', version: newVer });
                                // notifyAppReady() must be called by the new
                                // bundle on boot or Capgo will roll back.
                                // ota-bridge.js already does this in bootCapgo.
                                if (typeof U.reload === 'function') {
                                    return U.reload();
                                }
                                setTimeout(function () { W.location.reload(); }, 600);
                            });
                    });
                })
                .catch(function (err) {
                    log('manual update failed', err);
                    var msg = (err && err.message) || String(err);
                    notify({ stage: 'error', message: msg });
                });
        }

        // --- Tauri / Windows -------------------------------------------
        if (IS_TAURI) {
            notify({ stage: 'checking' });
            return fetchManifest()
                .then(function (manifest) {
                    var wb = manifest && manifest.web_bundle;
                    if (!wb) {
                        notify({ stage: 'up-to-date', current: manifest && manifest.version });
                        return;
                    }
                    return tauriInvoke('ota_web_bundle_current_version').then(function (current) {
                        if (!isNewer(manifest.version, current)) {
                            notify({ stage: 'up-to-date', current: current });
                            return;
                        }
                        notify({ stage: 'downloading', version: manifest.version });
                        return tauriInvoke('ota_web_bundle_pull', {
                            url: wb.url, expectedSha256: wb.sha256, version: manifest.version,
                        }).then(function () {
                            notify({ stage: 'reloading', version: manifest.version });
                            return tauriInvoke('plugin:process|restart');
                        });
                    });
                })
                .catch(function (err) {
                    log('Tauri manual update failed', err);
                    notify({ stage: 'error', message: (err && err.message) || String(err) });
                });
        }

        // --- Browser / PWA ---------------------------------------------
        // We seed W.__APP_VERSION__ from /version.json on first load so a
        // subsequent manual check can detect "still on the loaded version"
        // and only reload when the server has actually published a newer
        // one. Without this seed every click would reload, which spooks
        // a non-technical user.
        notify({ stage: 'checking' });
        return fetch('/version.json', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
                var newVer = d && d.version;
                var pageVer = W.__APP_VERSION__ || null;
                if (!pageVer && newVer) {
                    // First call after boot — just record it.
                    W.__APP_VERSION__ = newVer;
                    pageVer = newVer;
                }
                if (!newVer) { notify({ stage: 'up-to-date', current: pageVer }); return; }
                if (pageVer && pageVer === newVer) { notify({ stage: 'up-to-date', current: pageVer }); return; }
                notify({ stage: 'reloading', version: newVer });
                setTimeout(function () { W.location.reload(); }, 400);
            })
            .catch(function (err) {
                notify({ stage: 'error', message: (err && err.message) || 'Update check failed.' });
            });
    }

    // Seed __APP_VERSION__ at boot so the browser-branch manual check
    // has a baseline to compare against on the very first click.
    if (!IS_CAP && !IS_TAURI) {
        try {
            fetch('/version.json', { cache: 'no-store' })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (d) {
                    if (d && d.version && !W.__APP_VERSION__) {
                        W.__APP_VERSION__ = d.version;
                    }
                })
                .catch(function () { /* offline — ignore */ });
        } catch (_) { /* noop */ }
    }

    function getCurrentVersion() {
        if (IS_CAP) {
            var U = capgoUpdater();
            if (U && typeof U.current === 'function') {
                return U.current().then(function (c) {
                    return (c && c.bundle && c.bundle.version) || (c && c.version) || null;
                }).catch(function () { return null; });
            }
            return Promise.resolve(null);
        }
        return fetch('/version.json', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { return d && d.version; })
            .catch(function () { return null; });
    }

    W.ZachiOTA = {
        checkAndApply: manualCheckAndApply,
        getCurrentVersion: getCurrentVersion,
        isNative: IS_CAP || IS_TAURI,
        platform: IS_CAP ? 'android' : (IS_TAURI ? 'windows' : 'web'),
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
