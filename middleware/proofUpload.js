'use strict';

/**
 * Multer middleware for the Job Card "Upload Proof" flow (v1.0.22).
 *
 * - In-memory buffer (we hand it straight to Object Storage).
 * - 10 MB hard cap — proofs are mockups, not raw print files.
 * - Whitelists common image / PDF mime types. Anything else is
 *   rejected with a clear error message that the frontend surfaces
 *   in a toast.
 * - The field name is `file` to match the FormData on the client.
 *
 * NOTE: kept in its own file (not folded into middleware/upload.js)
 * because that file is hard-coded to .csv only and is shared by the
 * inventory bulk-import. We do not want to widen its accept list.
 */

const multer = require('multer');

const ALLOWED_MIME = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'application/pdf',
]);

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const proofUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1 },
    fileFilter(req, file, cb) {
        const mt = String(file.mimetype || '').toLowerCase();
        if (!ALLOWED_MIME.has(mt)) {
            return cb(new Error(
                `Unsupported file type: ${mt || 'unknown'}. ` +
                `Allowed: PNG, JPG, WEBP, GIF, PDF.`
            ), false);
        }
        cb(null, true);
    },
}).single('file');

module.exports = proofUpload;
