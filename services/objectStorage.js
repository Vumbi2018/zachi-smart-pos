'use strict';

/**
 * Thin wrapper around @replit/object-storage so the rest of the
 * app can store / fetch binary blobs without caring about bucket
 * IDs, presigned URLs or GCS credentials.
 *
 * Used today by the Job Card "Upload Proof" flow (v1.0.22). The
 * server reads the file into a Buffer via multer.memoryStorage(),
 * we hand the Buffer to `putBuffer()`, and we hand the resulting
 * `objectPath` back to the client through the existing
 * `job_proofs.file_url` column. The client opens that URL and the
 * server streams the bytes back via `streamObject()`.
 *
 * Why no presigned URLs / direct-to-bucket: this app is a vanilla
 * Express CommonJS app, not the React+Vite stack the Object
 * Storage skill targets. The simpler "buffer → bucket" path is
 * fine for the < 10 MB proof files we expect and avoids a 200-line
 * client-side Uppy integration.
 */

const path = require('path');
const crypto = require('crypto');

let _client = null;
function _getClient() {
    if (_client) return _client;
    const bucket = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucket) {
        throw new Error(
            'object_storage_not_provisioned: DEFAULT_OBJECT_STORAGE_BUCKET_ID is missing. ' +
            'Run setupObjectStorage() in the Replit shell to create the bucket.'
        );
    }
    // Lazy require so the SDK is not loaded on installs that have
    // not provisioned a bucket (older Android wrappers, dev machines
    // booting against a stale tarball, etc.).
    const { Client } = require('@replit/object-storage');
    _client = new Client({ bucketId: bucket });
    return _client;
}

/** True only if a bucket id is present in the environment. */
function isConfigured() {
    return !!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
}

/**
 * Generate a stable, collision-resistant key for a new upload.
 * Pattern: <prefix>/<yyyy>/<mm>/<dd>/<random>-<safeName>.
 */
function makeObjectKey(prefix, originalName) {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const rand = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(originalName || '').toLowerCase().slice(0, 10);
    const base = path.basename(originalName || 'upload', ext)
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .slice(0, 60);
    return `${prefix}/${yyyy}/${mm}/${dd}/${rand}-${base}${ext}`;
}

/**
 * Upload a Buffer (e.g. multer's `req.file.buffer`) to the bucket.
 * Returns { objectPath, size } — the path is a bucket-relative key
 * suitable for storing in a database column.
 */
async function putBuffer({ buffer, key, mimeType }) {
    if (!Buffer.isBuffer(buffer)) {
        throw new Error('putBuffer: buffer must be a Buffer');
    }
    const client = _getClient();
    const opts = { compress: false };
    if (mimeType) opts.contentType = mimeType;
    const { ok, error } = await client.uploadFromBytes(key, buffer, opts);
    if (!ok) {
        throw new Error(`object_storage_upload_failed: ${error && error.message ? error.message : error}`);
    }
    return { objectPath: key, size: buffer.length };
}

/**
 * Stream a stored object out to an Express response. Used by the
 * `/api/jobs/:id/proofs/:proofId/file` endpoint so the browser can
 * download / preview a proof without exposing bucket internals.
 */
async function streamObject({ key, mimeType, downloadName, res }) {
    const client = _getClient();
    const { ok, value, error } = await client.downloadAsBytes(key);
    if (!ok) {
        throw new Error(`object_storage_download_failed: ${error && error.message ? error.message : error}`);
    }
    // SDK returns either a Buffer or [Buffer]; normalise.
    const buf = Array.isArray(value) ? value[0] : value;
    if (mimeType) res.setHeader('Content-Type', mimeType);
    if (downloadName) {
        // inline so browsers preview PDFs / images directly; client
        // can still right-click → save as.
        const safe = downloadName.replace(/[^a-zA-Z0-9._-]+/g, '_');
        res.setHeader('Content-Disposition', `inline; filename="${safe}"`);
    }
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.end(buf);
}

module.exports = {
    isConfigured,
    makeObjectKey,
    putBuffer,
    streamObject,
};
