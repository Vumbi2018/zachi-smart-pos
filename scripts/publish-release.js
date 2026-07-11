#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const {
  sha256OfFile,
  writeJsonAtomic,
  copyFileSyncAtomic,
  applyArtifactToManifest,
} = require('./release-manifest-utils');

const PLATFORMS = {
  apk: {
    aliases: ['apk', 'android'],
    latestKey: 'android_apk',
    shaKey: 'apk_sha256',
    sizeKey: 'apk_size_bytes',
    filename: (version) => `zachi-pos-${version}.apk`,
    requiredExt: '.apk',
  },
  msi: {
    aliases: ['msi', 'windows'],
    latestKey: 'windows_msi',
    shaKey: 'msi_sha256',
    sizeKey: 'msi_size_bytes',
    filename: (version) => `zachi-pos-${version}.msi`,
    requiredExt: '.msi',
  },
};

function resolvePlatform(input) {
  const key = String(input || '').toLowerCase();
  for (const [name, def] of Object.entries(PLATFORMS)) {
    if (def.aliases.includes(key)) return { name, ...def };
  }
  return null;
}

function fail(msg) {
  process.stderr.write(`publish-release: ${msg}\n`);
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 3) {
    fail(
      'usage: publish-release.js <version> <platform> <file>\n' +
        '       platform = apk | msi (also accepts: android | windows)'
    );
  }

  const [version, platformArg, fileArg] = argv;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    fail(`invalid version "${version}" (expected semver like 1.0.5)`);
  }

  const platform = resolvePlatform(platformArg);
  if (!platform) {
    fail(
      `unknown platform "${platformArg}" (expected: ${Object.values(PLATFORMS)
        .flatMap((p) => p.aliases)
        .join(', ')})`
    );
  }

  const sourceFile = path.resolve(fileArg);
  if (!fs.existsSync(sourceFile)) fail(`file not found: ${sourceFile}`);
  if (!fs.statSync(sourceFile).isFile()) fail(`not a regular file: ${sourceFile}`);
  const ext = path.extname(sourceFile).toLowerCase();
  if (ext !== platform.requiredExt) {
    fail(
      `file extension "${ext}" does not match platform ${platform.name} ` +
        `(expected ${platform.requiredExt})`
    );
  }

  const releaseDir = path.resolve(__dirname, '..', 'public', 'release');
  if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
  }
  const manifestPath = path.join(releaseDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail(`manifest not found: ${manifestPath}`);

  const targetName = platform.filename(version);
  const targetPath = path.join(releaseDir, targetName);

  process.stdout.write(`→ Computing sha256 of ${sourceFile}\n`);
  const sha = await sha256OfFile(sourceFile);
  const size = fs.statSync(sourceFile).size;

  process.stdout.write(`→ Copying to ${path.relative(process.cwd(), targetPath)}\n`);
  copyFileSyncAtomic(sourceFile, targetPath);

  // Re-verify checksum of the destination to catch copy corruption.
  const shaAfter = await sha256OfFile(targetPath);
  if (shaAfter !== sha) {
    fail(`sha256 mismatch after copy (src=${sha} dst=${shaAfter}); aborting manifest update`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const result = applyArtifactToManifest(manifest, {
    version,
    artifact: {
      latestKey: platform.latestKey,
      shaKey: platform.shaKey,
      sizeKey: platform.sizeKey,
      filename: targetName,
      sha,
      size,
    },
  });

  if (result.action === 'promoted') {
    process.stdout.write(
      `→ Promoted latest to v${version} (was v${result.previousLatest}); ` +
        `remember to fill in latest.notes and re-publish other platform installers/tarballs.\n`
    );
  } else if (result.action === 'older_only') {
    process.stdout.write(
      `! v${version} is older than current latest v${manifest.latest.version}; ` +
        `updated releases[] entry only.\n`
    );
  }

  writeJsonAtomic(manifestPath, manifest);
  process.stdout.write(
    `✔ Published ${platform.name.toUpperCase()} v${version}\n` +
      `   file:   ${targetName}\n` +
      `   size:   ${size} bytes\n` +
      `   sha256: ${sha}\n`
  );
}

main().catch((err) => fail(err && err.stack ? err.stack : String(err)));
