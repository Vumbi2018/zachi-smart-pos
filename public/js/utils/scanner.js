/**
 * Zachi Smart-POS — Barcode Scanner Wrapper
 *
 * Thin wrapper around the browser's native BarcodeDetector API with a
 * graceful fallback message when unsupported (older Safari, Firefox).
 * Exposes a global `Scanner` object so legacy modules (inventory.js, pos.js)
 * can call Scanner.init(...) / Scanner.stop() unchanged.
 *
 * Public API (kept compatible with the html5-qrcode-style flow that
 * pos.js / inventory.js were written against):
 *   Scanner.init(containerId, onDetect, onError)
 *     — Saves the container/callbacks AND immediately begins capture
 *       with the default rear-camera constraint. Existing callers
 *       (inventory.js) rely on this single-call shape.
 *   Scanner.getCameras() -> Promise<[{ id, label }]>
 *     — Lists available video input devices.
 *   Scanner.start(cameraIdOrConstraints) -> Promise<void>
 *     — Restarts capture against a specific camera id or MediaTrack
 *       constraints object. If init() already opened a stream, the
 *       existing one is stopped first.
 *   Scanner.stop()
 *     — Tears down the current capture session.
 */
(function () {
    'use strict';

    const SUPPORTED_FORMATS = [
        'aztec',
        'code_128',
        'code_39',
        'code_93',
        'data_matrix',
        'ean_13',
        'ean_8',
        'itf',
        'pdf417',
        'qr_code',
        'upc_a',
        'upc_e',
    ];

    const Scanner = {
        _stream: null,
        _video: null,
        _detector: null,
        _rafId: null,
        _running: false,
        _container: null,
        _onDetect: null,
        _onError: null,

        isSupported() {
            return typeof window !== 'undefined' && 'BarcodeDetector' in window;
        },

        async init(containerId, onDetect, onError) {
            const container = document.getElementById(containerId);
            if (!container) {
                const msg = `Scanner: container "#${containerId}" not found`;
                console.error(msg);
                if (onError) onError(new Error(msg));
                return;
            }

            this._container = container;
            this._onDetect = onDetect || null;
            this._onError = onError || null;

            if (!this.isSupported()) {
                container.innerHTML =
                    '<div data-style="color:#fff;padding:20px;text-align:center;">' +
                    'Camera barcode scanning is not supported in this browser. ' +
                    'Please type the code manually or use a USB barcode scanner.' +
                    '</div>';
                if (onError) onError(new Error('BarcodeDetector unsupported'));
                return;
            }

            // Auto-start with the rear-facing camera so single-call
            // callers (inventory.js) keep working unchanged.
            return this.start({ facingMode: 'environment' });
        },

        async getCameras() {
            try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
                    return [];
                }
                // Some browsers only expose device labels after a getUserMedia
                // grant, so seed permission cheaply if we don't yet have a stream.
                if (!this._stream) {
                    try {
                        const seed = await navigator.mediaDevices.getUserMedia({
                            video: true,
                            audio: false,
                        });
                        seed.getTracks().forEach((t) => t.stop());
                    } catch (_) {
                        // Permission denied — return whatever the browser gives us.
                    }
                }
                const devices = await navigator.mediaDevices.enumerateDevices();
                return devices
                    .filter((d) => d.kind === 'videoinput')
                    .map((d, i) => ({
                        id: d.deviceId,
                        label: d.label || `Camera ${i + 1}`,
                    }));
            } catch (err) {
                console.warn('Scanner.getCameras error:', err);
                return [];
            }
        },

        async start(cameraIdOrConstraints) {
            if (!this._container) {
                const msg = 'Scanner.start called before Scanner.init';
                console.error(msg);
                if (this._onError) this._onError(new Error(msg));
                return;
            }
            if (!this.isSupported()) {
                if (this._onError) this._onError(new Error('BarcodeDetector unsupported'));
                return;
            }

            // Tear down any existing capture so we can swap cameras safely.
            if (this._stream || this._video || this._rafId) {
                this.stop();
            }

            // Build a getUserMedia constraint object. Accepts:
            //   - a deviceId string (from getCameras())
            //   - a constraints object like { facingMode: 'environment' }
            //   - undefined → default rear camera
            let videoConstraints;
            if (typeof cameraIdOrConstraints === 'string' && cameraIdOrConstraints) {
                videoConstraints = { deviceId: { exact: cameraIdOrConstraints } };
            } else if (cameraIdOrConstraints && typeof cameraIdOrConstraints === 'object') {
                videoConstraints = cameraIdOrConstraints;
            } else {
                videoConstraints = { facingMode: 'environment' };
            }

            try {
                this._detector = new window.BarcodeDetector({ formats: SUPPORTED_FORMATS });
                this._stream = await navigator.mediaDevices.getUserMedia({
                    video: videoConstraints,
                    audio: false,
                });

                this._container.innerHTML = '';
                const video = document.createElement('video');
                video.setAttribute('playsinline', 'true');
                video.muted = true;
                video.setAttribute('data-style', 'width:100%;height:100%;object-fit:cover;');
                video.srcObject = this._stream;
                this._container.appendChild(video);
                await video.play();
                this._video = video;
                this._running = true;

                const seen = new Map();
                const COOLDOWN_MS = 1500;
                const onDetect = this._onDetect;

                const tick = async () => {
                    if (!this._running || !this._video) return;
                    try {
                        const codes = await this._detector.detect(this._video);
                        const now = Date.now();
                        for (const c of codes) {
                            const last = seen.get(c.rawValue) || 0;
                            if (now - last > COOLDOWN_MS) {
                                seen.set(c.rawValue, now);
                                try {
                                    onDetect && onDetect(c.rawValue, c.format);
                                } catch (cbErr) {
                                    console.error('Scanner onDetect handler error:', cbErr);
                                }
                            }
                        }
                    } catch (detectErr) {
                        // Transient detection errors are common; log and continue
                        console.debug('Scanner detect tick error:', detectErr.message);
                    }
                    if (this._running) {
                        this._rafId = requestAnimationFrame(tick);
                    }
                };
                this._rafId = requestAnimationFrame(tick);
            } catch (err) {
                console.error('Scanner start error:', err);
                if (this._container) {
                    this._container.innerHTML =
                        '<div data-style="color:#fff;padding:20px;text-align:center;">' +
                        'Could not access camera. Please grant permission or use a USB scanner.' +
                        '</div>';
                }
                if (this._onError) this._onError(err);
                throw err;
            }
        },

        stop() {
            this._running = false;
            if (this._rafId) {
                cancelAnimationFrame(this._rafId);
                this._rafId = null;
            }
            if (this._stream) {
                this._stream.getTracks().forEach((t) => t.stop());
                this._stream = null;
            }
            if (this._video) {
                try {
                    this._video.pause();
                    this._video.srcObject = null;
                } catch (_) {
                    /* noop */
                }
                this._video = null;
            }
            this._detector = null;
        },
    };

    if (typeof window !== 'undefined') {
        window.Scanner = Scanner;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = Scanner;
    }
})();
