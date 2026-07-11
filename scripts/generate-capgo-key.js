'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ANDROID_CONFIG = path.resolve(
    __dirname, '..', '..', 'zachi-android', 'capacitor.config.json'
);
const PRIVATE_KEY_OUT = path.resolve(
    __dirname, '..', '..', '..', '.local', 'capgo-private-key.pem'
);

function main() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });

    const cfg = JSON.parse(fs.readFileSync(ANDROID_CONFIG, 'utf8'));
    cfg.plugins = cfg.plugins || {};
    cfg.plugins.CapacitorUpdater = cfg.plugins.CapacitorUpdater || {};
    cfg.plugins.CapacitorUpdater.publicKey = publicKey;
    fs.writeFileSync(ANDROID_CONFIG, JSON.stringify(cfg, null, 2) + '\n');

    fs.mkdirSync(path.dirname(PRIVATE_KEY_OUT), { recursive: true });
    fs.writeFileSync(PRIVATE_KEY_OUT, privateKey, { mode: 0o600 });

    process.stdout.write(`✅ New Capgo keypair generated.\n`);
    process.stdout.write(`   Public key written to: ${path.relative(process.cwd(), ANDROID_CONFIG)}\n`);
    process.stdout.write(`   Private key written to: ${path.relative(process.cwd(), PRIVATE_KEY_OUT)}\n`);
}

if (require.main === module) main();
