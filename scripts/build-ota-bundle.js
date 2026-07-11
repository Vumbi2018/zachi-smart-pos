'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const OTA_DIR = path.join(PUBLIC_DIR, 'ota');

const PUBLIC_HOST =
    process.env.OTA_PUBLIC_HOST ||
    process.env.PUBLIC_HOST ||
    'https://pos.zachicomputercentre.com';

const EXCLUDE_TOP_LEVEL = new Set(['ota', 'release', 'uploads', 'backups']);

function walk(dir, base, out) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
        if (base === '' && EXCLUDE_TOP_LEVEL.has(e.name)) continue;
        if (e.name.startsWith('.')) continue;
        const abs = path.join(dir, e.name);
        const rel = base ? `${base}/${e.name}` : e.name;
        if (e.isDirectory()) {
            walk(abs, rel, out);
        } else if (e.isFile()) {
            out.push({ abs, rel });
        }
    }
}

function contentHash(files) {
    const h = crypto.createHash('sha256');
    for (const f of files) {
        h.update(f.rel);
        h.update('\0');
        h.update(fs.readFileSync(f.abs));
        h.update('\0');
    }
    return h.digest('hex');
}

function sha256Hex(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256OfFile(p) {
    return sha256Hex(fs.readFileSync(p));
}

function normalizePem(raw) {
    if (!raw) return raw;
    let s = raw.replace(/\\n/g, '\n').trim();
    if (s.includes('\n')) return s;
    const m = s.match(/-----BEGIN ([A-Z ]+?)-----([\s\S]+?)-----END \1-----/);
    if (!m) return s;
    const label = m[1];
    const body = m[2].replace(/\s+/g, '');
    const lines = body.match(/.{1,64}/g) || [body];
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

function loadPrivateKey() {
    const env = process.env.CAPGO_PRIVATE_KEY;
    if (env && env.includes('BEGIN') && env.includes('PRIVATE KEY')) {
        return normalizePem(env);
    }
    const localPath = path.resolve(ROOT, '..', '..', '.local', 'capgo-private-key.pem');
    if (fs.existsSync(localPath)) {
        return fs.readFileSync(localPath, 'utf8');
    }
    return null;
}

function signAndEncryptForCapgo(plainZipPath, privateKeyPem) {
    const plain = fs.readFileSync(plainZipPath);

    // Capgo's CryptoCipher.decryptChecksum expects the raw 32-byte
    // SHA-256 digest (Buffer), NOT the 64-char hex string of it. The
    // plugin RSA-decrypts the checksum field, checks
    // decryptedChecksum.length == 32, then hex-encodes the result and
    // compares it against calcChecksum(file) which is the file's
    // sha256 in hex. If we encrypt the hex string instead, Capgo gets
    // back 64 bytes, logs "unknown algorithm (64 bytes)", and silently
    // rejects every bundle.
    const checksumBytes = crypto.createHash('sha256').update(plain).digest();

    const aesKey = crypto.randomBytes(16);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-128-cbc', aesKey, iv);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);

    const encZipPath = plainZipPath + '.enc';
    fs.writeFileSync(encZipPath, encrypted);

    const keyObj = crypto.createPrivateKey({ key: privateKeyPem, format: 'pem' });
    const encAesKey = crypto.privateEncrypt(
        { key: keyObj, padding: crypto.constants.RSA_PKCS1_PADDING },
        aesKey
    );
    const encChecksum = crypto.privateEncrypt(
        { key: keyObj, padding: crypto.constants.RSA_PKCS1_PADDING },
        checksumBytes
    );

    const sessionKey = `${iv.toString('base64')}:${encAesKey.toString('base64')}`;
    const checksum = encChecksum.toString('base64');

    return {
        encZipPath,
        encSize: encrypted.length,
        sessionKey,
        checksum,
    };
}

function buildBundle({ version, quiet = false } = {}) {
    const pkgVersion = version || require(path.join(ROOT, 'package.json')).version;
    if (!fs.existsSync(OTA_DIR)) fs.mkdirSync(OTA_DIR, { recursive: true });

    const files = [];
    walk(PUBLIC_DIR, '', files);
    files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

    const fingerprint = contentHash(files).slice(0, 12);
    const zipName = `web-bundle-${pkgVersion}-${fingerprint}.zip`;
    const zipPath = path.join(OTA_DIR, zipName);

    if (!fs.existsSync(zipPath)) {
        const zip = new AdmZip();
        for (const f of files) {
            zip.addFile(f.rel, fs.readFileSync(f.abs), '', 0o644);
        }
        zip.writeZip(zipPath);
    }

    const plainSha = sha256OfFile(zipPath);
    const plainSize = fs.statSync(zipPath).size;
    const plainUrl = `${PUBLIC_HOST.replace(/\/+$/, '')}/ota/${zipName}`;

    const windowsManifest = {
        version: pkgVersion,
        released_at: new Date().toISOString(),
        web_bundle: { url: plainUrl, sha256: plainSha, size_bytes: plainSize },
    };
    fs.writeFileSync(
        path.join(OTA_DIR, 'windows-latest.json'),
        JSON.stringify(windowsManifest, null, 2) + '\n'
    );

    const privateKey = loadPrivateKey();
    let androidManifest;
    let encName = null;
    if (privateKey) {
        encName = `${zipName}.enc`;
        const encPath = path.join(OTA_DIR, encName);
        if (!fs.existsSync(encPath)) {
            const enc = signAndEncryptForCapgo(zipPath, privateKey);
            androidManifest = {
                version: pkgVersion,
                url: `${PUBLIC_HOST.replace(/\/+$/, '')}/ota/${encName}`,
                sessionKey: enc.sessionKey,
                checksum: enc.checksum,
                size_bytes: enc.encSize,
                released_at: windowsManifest.released_at,
            };
            fs.writeFileSync(
                path.join(OTA_DIR, `${encName}.manifest.json`),
                JSON.stringify(androidManifest, null, 2) + '\n'
            );
        } else {
            const cached = JSON.parse(
                fs.readFileSync(path.join(OTA_DIR, `${encName}.manifest.json`), 'utf8')
            );
            androidManifest = cached;
            androidManifest.released_at = windowsManifest.released_at;
        }
    } else {
        androidManifest = {
            version: pkgVersion,
            url: plainUrl,
            checksum: plainSha,
            size_bytes: plainSize,
            released_at: windowsManifest.released_at,
            _note: 'Unsigned bundle. Capgo plugin will reject this when publicKey is set in capacitor.config.json. Set CAPGO_PRIVATE_KEY secret to enable signing.',
        };
    }
    fs.writeFileSync(
        path.join(OTA_DIR, 'android-latest.json'),
        JSON.stringify(androidManifest, null, 2) + '\n'
    );

    for (const old of fs.readdirSync(OTA_DIR)) {
        if (!old.startsWith('web-bundle-')) continue;
        if (old === zipName) continue;
        if (encName && (old === encName || old === `${encName}.manifest.json`)) continue;
        if (/\.zip(\.enc)?(\.manifest\.json)?$/.test(old)) {
            try { fs.unlinkSync(path.join(OTA_DIR, old)); } catch (_) {}
        }
    }

    if (!quiet) {
        process.stdout.write(
            `  📦 OTA bundle ready: ${zipName} (${(plainSize / 1024).toFixed(1)} KB, sha256 ${plainSha.slice(0, 12)}…)` +
            `${privateKey ? ' [Android: signed+encrypted]' : ' [Android: UNSIGNED — set CAPGO_PRIVATE_KEY]'}\n`
        );
    }

    return { version: pkgVersion, zipName, zipPath, sha256: plainSha, size: plainSize, url: plainUrl };
}

module.exports = { buildBundle };

if (require.main === module) {
    try {
        buildBundle();
    } catch (err) {
        process.stderr.write(`build-ota-bundle: ${err.stack || err.message}\n`);
        process.exit(1);
    }
}
