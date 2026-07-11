/**
 * Zachi Smart-POS — Tauri (Windows desktop) bridge.
 *
 * This file is a NO-OP on the web and Android. It only lights up
 * when running inside the Tauri shell from `apps/zachi-windows/`.
 *
 * What it does (in order, before app.js fires its first request):
 *   1. Detect Tauri via `window.__TAURI_INTERNALS__`.
 *   2. Load the persistent settings store and apply the operator's
 *      backend URL choice to `API.baseUrl` (default: production).
 *   3. Read / generate the per-install device id from the same
 *      store and seed `localStorage.zspos_device_id` so the
 *      existing api.js plumbing keeps working unchanged.
 *   4. Expose `window.ZachiDesktop` with the small set of
 *      Settings-screen actions: setBackendUrl, setCounterMode,
 *      print, openCashDrawer, checkForUpdates, etc.
 *
 * Order matters: this file is loaded BEFORE app.js in
 * apps/zachi-pos/public/index.html so the override happens before
 * any auth call goes out.
 */
(function () {
    'use strict';

    // ── Detect ─────────────────────────────────────────────────────
    // Tauri 2 exposes `__TAURI_INTERNALS__` always, and
    // `__TAURI__` only when `withGlobalTauri: true`. We support both
    // so this works regardless of how the bundle was built.
    const isTauri =
        typeof window !== 'undefined' &&
        (window.__TAURI_INTERNALS__ || window.__TAURI__);
    if (!isTauri) {
        // Marker the rest of the bundle (Settings UI) checks.
        window.IS_TAURI_DESKTOP = false;
        return;
    }
    window.IS_TAURI_DESKTOP = true;

    const STORE_FILE = 'settings.json';
    const STORE_KEYS = {
        BACKEND_URL: 'backend.url',
        DEVICE_ID: 'device.id',
        CASH_DRAWER_PORT: 'cash_drawer.port',
        CASH_DRAWER_PRINTER: 'cash_drawer.printer',
        RECEIPT_PRINTER: 'receipt.printer',
        COUNTER_MODE: 'counter_mode.enabled',
    };

    const DEFAULT_BACKEND_URL = 'https://pos.zachicomputercentre.com';
    const COUNTER_MODE_URL = 'http://127.0.0.1:5000';

    // Lazily resolved Tauri APIs — they live on
    // `window.__TAURI_INTERNALS__.invoke` in v2 with
    // `withGlobalTauri:false`. We import the JS shims only if the
    // app bundled them; otherwise we fall back to the raw invoke.
    function tauriInvoke(cmd, args) {
        const internals = window.__TAURI_INTERNALS__;
        if (internals && typeof internals.invoke === 'function') {
            return internals.invoke(cmd, args || {});
        }
        if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
            return window.__TAURI__.core.invoke(cmd, args || {});
        }
        return Promise.reject(new Error('Tauri invoke unavailable'));
    }

    // ── Tiny store wrapper around the Tauri store plugin ───────────
    // The plugin exposes `plugin:store|*` IPC commands directly, so
    // we go through invoke instead of pulling in the JS package
    // (which would mean shipping another bundle for a single page).
    const Store = {
        async get(key) {
            try {
                const v = await tauriInvoke('plugin:store|get', {
                    path: STORE_FILE,
                    key,
                });
                return v == null ? null : v;
            } catch (e) {
                console.warn('[tauri-bridge] store get failed', key, e);
                return null;
            }
        },
        async set(key, value) {
            try {
                await tauriInvoke('plugin:store|set', {
                    path: STORE_FILE,
                    key,
                    value,
                });
                await tauriInvoke('plugin:store|save', { path: STORE_FILE });
            } catch (e) {
                console.warn('[tauri-bridge] store set failed', key, e);
            }
        },
    };

    // ── Backend URL override ───────────────────────────────────────
    // We can't await a top-level promise before api.js has loaded,
    // but api.js doesn't fire any request until login. So we read
    // the store synchronously *enough*: kick off the load
    // immediately and resolve a global promise the rest of the
    // bundle can await before its first request.
    let resolveReady;
    window.__ZACHI_DESKTOP_READY = new Promise((r) => {
        resolveReady = r;
    });

    function genUuid() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        // Fallback rfc4122 v4 — same shape as db.js's helper.
        const b = new Uint8Array(16);
        (window.crypto || window.msCrypto).getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
        return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
    }

    async function bootstrap() {
        // 1) Backend URL. If Counter Mode was on at last shutdown, the
        //    Rust side (`resume_if_enabled`) is bringing the local
        //    sidecar back up — point the front end at it instead of
        //    the operator-configured remote URL. Otherwise use the
        //    stored remote URL.
        const counterEnabled = !!(await Store.get(STORE_KEYS.COUNTER_MODE));
        let url;
        if (counterEnabled) {
            url = COUNTER_MODE_URL;
            console.log('[tauri-bridge] Counter Mode resume — using local backend');
        } else {
            url = (await Store.get(STORE_KEYS.BACKEND_URL)) || DEFAULT_BACKEND_URL;
        }
        // Trim trailing slash so we don't accidentally produce //api.
        url = String(url).replace(/\/+$/, '');
        if (typeof API !== 'undefined' && API && url) {
            API.baseUrl = url + '/api';
            // Mirror to localStorage so api.js's `_resolveBaseUrl()`
            // (added for the Capacitor wrapper) picks up our URL too.
            try { localStorage.setItem('zspos_backend_url', url); } catch (_) {}
            console.log('[tauri-bridge] API.baseUrl =', API.baseUrl);
        }

        // 2) Device id. The store is the source of truth; localStorage
        //    is just a mirror so api.js's existing `getDeviceId` /
        //    `setDeviceId` keep working unchanged. On first install we
        //    mint a UUID immediately and persist it BEFORE any request
        //    can fire — that way the device row is created the first
        //    time the user logs in, and a localStorage wipe (or a fresh
        //    install where we restore the store from backup) keeps the
        //    same identity.
        let deviceId = await Store.get(STORE_KEYS.DEVICE_ID);
        const lsDevice = localStorage.getItem('zspos_device_id');
        if (!deviceId && lsDevice) {
            // Migrating an existing install: keep the localStorage id
            // and promote it to the store as the new source of truth.
            deviceId = lsDevice;
            await Store.set(STORE_KEYS.DEVICE_ID, deviceId);
        } else if (!deviceId && !lsDevice) {
            // First run on this machine — mint one now.
            deviceId = genUuid();
            await Store.set(STORE_KEYS.DEVICE_ID, deviceId);
            localStorage.setItem('zspos_device_id', deviceId);
            console.log('[tauri-bridge] minted new device id', deviceId);
        } else if (deviceId && deviceId !== lsDevice) {
            // Store wins — replace whatever localStorage had.
            localStorage.setItem('zspos_device_id', deviceId);
        }

        resolveReady({ url, deviceId });
    }

    // Patch window.print so the existing receipt-print buttons
    // (which call `window.print()`) flow through the native printer
    // when one is configured. If not, fall back to the browser
    // print dialog.
    const originalPrint = window.print.bind(window);
    window.print = function tauriPrint() {
        ZachiDesktop.printVisibleReceipt().catch((e) => {
            console.warn('[tauri-bridge] native print failed, falling back', e);
            originalPrint();
        });
    };

    // ── Public surface used by Settings UI + POS receipt code ──────
    const ZachiDesktop = {
        isDesktop: true,

        // Backend URL ---------------------------------------------------
        async getBackendUrl() {
            return (await Store.get(STORE_KEYS.BACKEND_URL)) || DEFAULT_BACKEND_URL;
        },
        async setBackendUrl(url) {
            const clean = String(url || '').replace(/\/+$/, '');
            if (!/^https?:\/\//i.test(clean)) {
                throw new Error('URL must start with http:// or https://');
            }
            await Store.set(STORE_KEYS.BACKEND_URL, clean);
            if (typeof API !== 'undefined') API.baseUrl = clean + '/api';
            try { localStorage.setItem('zspos_backend_url', clean); } catch (_) {}
            return clean;
        },

        // Counter Mode -------------------------------------------------
        async getCounterMode() {
            const enabled = !!(await Store.get(STORE_KEYS.COUNTER_MODE));
            const status = await tauriInvoke('counter_mode_status').catch(() => null);
            return { enabled, status };
        },
        async setCounterMode(enabled) {
            // Important: persist AFTER the Rust call succeeds, so a
            // missing sidecar binary (or any spawn failure) doesn't
            // strand the store in `enabled=true` and cause
            // `resume_if_enabled` to fail on every subsequent launch.
            if (enabled) {
                await tauriInvoke('start_counter_mode');
                await Store.set(STORE_KEYS.COUNTER_MODE, true);
                // Point the front end at the local sidecar.
                if (typeof API !== 'undefined') API.baseUrl = COUNTER_MODE_URL + '/api';
                try { localStorage.setItem('zspos_backend_url', COUNTER_MODE_URL); } catch (_) {}
            } else {
                await tauriInvoke('stop_counter_mode');
                await Store.set(STORE_KEYS.COUNTER_MODE, false);
                // Restore the operator's chosen backend URL.
                const u = await this.getBackendUrl();
                if (typeof API !== 'undefined') API.baseUrl = u + '/api';
                try { localStorage.setItem('zspos_backend_url', u); } catch (_) {}
            }
            return enabled;
        },

        // Printers -----------------------------------------------------
        async listPrinters() {
            return tauriInvoke('list_printers');
        },
        async setReceiptPrinter(name) {
            await Store.set(STORE_KEYS.RECEIPT_PRINTER, name || null);
        },
        async getReceiptPrinter() {
            return (await Store.get(STORE_KEYS.RECEIPT_PRINTER)) || null;
        },
        async printRaw(bytes, opts) {
            return tauriInvoke('print_raw', {
                bytes: Array.from(bytes),
                printerName: (opts && opts.printerName) || (await this.getReceiptPrinter()),
                jobTitle: (opts && opts.jobTitle) || 'Zachi POS Receipt',
            });
        },
        async printReceipt(text, opts) {
            return tauriInvoke('print_receipt', {
                text: String(text || ''),
                opts: {
                    printerName: (opts && opts.printerName) || (await this.getReceiptPrinter()),
                    jobTitle: (opts && opts.jobTitle) || 'Zachi POS Receipt',
                },
            });
        },
        // Pull plain text out of the currently-rendered receipt
        // panel. POS code that wants paper output already builds a
        // printable region (`#receipt-print-area` in pos.js); we
        // just pluck its text and ship it.
        async printVisibleReceipt() {
            const area =
                document.getElementById('receipt-print-area') ||
                document.getElementById('print-area') ||
                document.querySelector('.print-area');
            if (!area) throw new Error('No printable receipt region on page.');
            const text = area.innerText || area.textContent || '';
            return this.printReceipt(text);
        },

        /**
         * Render a sale into an 80mm-thermal-friendly plain-text
         * receipt and ship it to the configured printer. Called by
         * POS.printReceipt when running inside Tauri so we route
         * through the native printer instead of opening a browser
         * print preview popup (which doesn't work in a webview).
         *
         * The text we build is deliberately ASCII + the ESC/POS init
         * + cut sequences so it works on the popular Epson TM-T20III,
         * TM-T88VI, and Xprinter XP-58IIH that Zachi has on counters.
         */
        async printSale(sale) {
            const items = sale.items || [];
            const total = Number(sale.total_amount || 0);
            const paid = Number(sale.amount_paid || total);
            const change = Math.max(0, paid - total);
            const tax = Number(sale.tax_amount || 0);
            const disc = Number(sale.discount_amount || 0);
            const sub = total + disc - tax;
            const method = (sale.payment_method || 'Cash').toUpperCase();
            const cashier = sale.staff_name || sale.cashier_name || '';
            const dateStr = new Date(sale.transaction_date || Date.now())
                .toLocaleString('en-ZM', {
                    year: 'numeric', month: 'short', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', hour12: true,
                });

            const W = 42; // 80mm @ Font A ≈ 42 columns; fine for 58mm too.
            const center = (s) => {
                const t = String(s);
                const pad = Math.max(0, Math.floor((W - t.length) / 2));
                return ' '.repeat(pad) + t;
            };
            const row = (l, r) => {
                const ls = String(l);
                const rs = String(r);
                const pad = Math.max(1, W - ls.length - rs.length);
                return ls + ' '.repeat(pad) + rs;
            };
            const hr = (ch) => ch.repeat(W);
            const money = (n) => `K ${Number(n).toFixed(2)}`;

            const lines = [];
            // ESC @ — initialize printer
            lines.push('\x1B\x40');
            lines.push(center('ZACHI COMPUTER CENTRE'));
            lines.push(center('Independence Ave, Solwezi'));
            lines.push(center('Tel: +260 974 210 067'));
            lines.push(hr('='));
            lines.push(center(sale.is_offline ? '*** OFFLINE RECEIPT ***' : 'OFFICIAL RECEIPT'));
            lines.push(hr('-'));
            lines.push(row('Date:', dateStr));
            if (cashier) lines.push(row('Cashier:', cashier));
            lines.push(center(sale.sale_number || ''));
            lines.push(hr('-'));
            for (const it of items) {
                const qty = it.quantity || 1;
                const price = Number(it.unit_price || 0);
                const lineT = Number(it.line_total || it.total_price || (price * qty));
                const name = it.name || it.description || 'Item';
                lines.push(name.slice(0, W));
                lines.push(row(`  ${qty} x ${money(price)}`, money(lineT)));
            }
            lines.push(hr('-'));
            if (sub > 0) lines.push(row('Subtotal', money(sub)));
            if (disc > 0) lines.push(row('Discount', `- ${money(disc)}`));
            if (tax > 0) lines.push(row('VAT', money(tax)));
            lines.push(row('TOTAL', money(total)));
            lines.push(row(method, money(paid)));
            if (change > 0) lines.push(row('CHANGE', money(change)));
            lines.push(hr('='));
            lines.push(center('Thank you for shopping with us!'));
            lines.push(center('Goods sold are not returnable'));
            lines.push(center('unless defective. Exchange only'));
            lines.push(center('within 7 days with receipt.'));
            lines.push('');
            lines.push('');
            // GS V 0 — full cut (most thermal printers)
            lines.push('\x1D\x56\x00');

            const text = lines.join('\n');
            return this.printReceipt(text);
        },

        // Cash drawer --------------------------------------------------
        async listSerialPorts() {
            return tauriInvoke('list_serial_ports');
        },
        async getCashDrawerConfig() {
            return {
                port: await Store.get(STORE_KEYS.CASH_DRAWER_PORT),
                printer: await Store.get(STORE_KEYS.CASH_DRAWER_PRINTER),
            };
        },
        async setCashDrawerConfig({ port, printer }) {
            if (port !== undefined) await Store.set(STORE_KEYS.CASH_DRAWER_PORT, port || null);
            if (printer !== undefined) await Store.set(STORE_KEYS.CASH_DRAWER_PRINTER, printer || null);
        },
        async openCashDrawer() {
            const cfg = await this.getCashDrawerConfig();
            return tauriInvoke('open_cash_drawer', {
                args: {
                    port: cfg.port || null,
                    baud: 9600,
                    printerName: cfg.printer || (await this.getReceiptPrinter()),
                },
            });
        },

        // Auto-update --------------------------------------------------
        async checkForUpdates() {
            // The updater plugin auto-installs when configured
            // (`tauri.conf.json -> plugins.updater.active = true`).
            // The JS shim is intentionally not bundled — for a manual
            // check we just invoke the plugin command directly.
            try {
                const meta = await tauriInvoke('plugin:updater|check');
                return meta || { available: false };
            } catch (e) {
                return { available: false, error: String(e && e.message ? e.message : e) };
            }
        },

        /**
         * Open an external URL (whatsapp://, sms:, https://...) in
         * the OS default handler. We use the shell plugin so URLs
         * with custom schemes (whatsapp, sms, mailto) reach the
         * native app instead of trying to navigate the webview to
         * an unknown route.
         *
         * Returns true on success, false otherwise — the caller can
         * fall back to window.open() in that case.
         */
        async openExternal(url) {
            if (!url) return false;
            try {
                await tauriInvoke('plugin:shell|open', { path: url });
                return true;
            } catch (e) {
                console.warn('[tauri-bridge] openExternal failed for', url, e);
                return false;
            }
        },
    };

    window.ZachiDesktop = ZachiDesktop;

    // Kick off bootstrap. Anything that needs the resolved URL can
    // `await window.__ZACHI_DESKTOP_READY`. api.js doesn't, but the
    // first auth call in app.js fires after a user interaction so
    // it's effectively always after the promise resolves.
    bootstrap().catch((e) => {
        console.error('[tauri-bridge] bootstrap failed', e);
        resolveReady({ error: e });
    });
})();
