const Scanner = {
    scanner: null,
    isScanning: false,

    init(elementId, onSuccess, onError) {
        if (this.scanner) {
            // Already initialized, maybe restart? 
            // For now, if we call init again, we assume we want a fresh start, so stop first.
            this.stop().then(() => {
                this._initInternal(elementId, onSuccess, onError);
            });
        } else {
            this._initInternal(elementId, onSuccess, onError);
        }
    },

    _initInternal(elementId, onSuccess, onError) {
        // Enable standard 1D barcodes + QR
        const formatsToSupport = [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.CODABAR
        ];

        // Use verbose=false for production, experimentalFeatures for native support
        this.scanner = new Html5Qrcode(elementId, {
            formatsToSupport: formatsToSupport,
            verbose: false,
            experimentalFeatures: {
                useBarCodeDetectorIfSupported: true
            }
        });

        this.onSuccess = onSuccess;
        this.onError = onError;
    },

    async getCameras() {
        try {
            return await Html5Qrcode.getCameras();
        } catch (err) {
            console.error("Error getting cameras", err);
            return [];
        }
    },

    async start(cameraIdOrConfig) {
        if (!this.scanner) {
            console.error("Scanner not initialized. Call init() first.");
            return;
        }

        const config = {
            fps: 15,
            qrbox: { width: 300, height: 150 },
            aspectRatio: 1.0,
            disableFlip: false
        };

        try {
            await this.scanner.start(
                cameraIdOrConfig,
                config,
                (decodedText, decodedResult) => {
                    console.log(`Code matched = ${decodedText}`, decodedResult);
                    this.stop().then(() => {
                        if (this.onSuccess) this.onSuccess(decodedText);
                    });
                },
                (errorMessage) => {
                    // if (this.onError) this.onError(errorMessage);
                }
            );
            this.isScanning = true;
        } catch (err) {
            console.error("Error starting scanner", err);
            if (this.onError) this.onError(err);
            throw err;
        }
    },

    stop() {
        if (this.scanner && this.isScanning) {
            return this.scanner.stop().then(() => {
                this.scanner.clear();
                this.isScanning = false;
                // We don't nullify scanner here so we can restart it
            }).catch(err => {
                console.error("Failed to stop scanner", err);
            });
        }
        return Promise.resolve();
    }
};

window.Scanner = Scanner;
