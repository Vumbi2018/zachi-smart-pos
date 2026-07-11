#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  sha256OfFile,
  writeJsonAtomic,
  applyArtifactToManifest,
} = require('./release-manifest-utils');

// Repo root is four levels up: apps/zachi-pos/scripts/<this>.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const RELEASE_DIR = path.resolve(__dirname, '..', 'public', 'release');
const MANIFEST_PATH = path.join(RELEASE_DIR, 'manifest.json');

// Canonical exclude list. Single source of truth for both tarballs.
// Patterns are passed to GNU tar's --exclude (glob, matched against the
// path inside the archive). Keep this list in sync with .gitignore intent.
const EXCLUDES = [
  // Build/CI scratch
  'node_modules',
  '.git',
  '.DS_Store',
  '*.log',
  // Per-app build output
  'apps/zachi-android/android/build',
  'apps/zachi-android/android/app/build',
  'apps/zachi-android/android/.gradle',
  'apps/zachi-android/android/app/release',
  'apps/zachi-windows/src-tauri/target',
  // POS scratch dirs
  'apps/zachi-pos/backups',
  'apps/zachi-pos/public/release',
  // Defence-in-depth: if `public/` ever gets cp -a'd into the Android wrapper
  // trees, any nested `release/` folder there must NOT be re-tarballed (we hit
  // a 145 MB tarball-of-tarballs once).
  'apps/zachi-android/web/release',
  'apps/zachi-android/android/app/src/main/assets/public/release',
  // Secrets — must never be shipped
  '.env',
  '*.jks',
  '*.keystore',
  'keystore.properties',
  'apps/zachi-android/android/local.properties',
];

const SOURCES_BY_TARBALL = {
  android: ['apps/zachi-pos', 'apps/zachi-android'],
  windows: ['apps/zachi-pos', 'apps/zachi-android', 'apps/zachi-windows'],
};

function fail(msg) {
  process.stderr.write(`build-source-tarballs: ${msg}\n`);
  process.exit(1);
}

function readVersionJson() {
  const p = path.join(REPO_ROOT, 'apps/zachi-android/scripts/version.json');
  if (!fs.existsSync(p)) fail(`missing ${p}`);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!j.versionName) fail(`${p} is missing versionName`);
  if (j.versionCode == null) fail(`${p} is missing versionCode`);
  return { path: p, versionName: String(j.versionName), versionCode: Number(j.versionCode) };
}

function readGradleVersion() {
  const p = path.join(REPO_ROOT, 'apps/zachi-android/android/app/build.gradle');
  if (!fs.existsSync(p)) fail(`missing ${p}`);
  const txt = fs.readFileSync(p, 'utf8');
  const nameMatch = txt.match(/versionName\s+["']([^"']+)["']/);
  const codeMatch = txt.match(/versionCode\s+(\d+)/);
  if (!nameMatch) fail(`could not find versionName in ${p}`);
  if (!codeMatch) fail(`could not find versionCode in ${p}`);
  return {
    path: p,
    versionName: nameMatch[1],
    versionCode: parseInt(codeMatch[1], 10),
  };
}

function ensureVersionsAgree() {
  const v = readVersionJson();
  const g = readGradleVersion();
  if (v.versionName !== g.versionName) {
    fail(
      `versionName mismatch:\n` +
        `  ${path.relative(REPO_ROOT, v.path)} versionName = ${v.versionName}\n` +
        `  ${path.relative(REPO_ROOT, g.path)} versionName = ${g.versionName}\n` +
        `Update both pins to the same value before building tarballs.`
    );
  }
  if (v.versionCode !== g.versionCode) {
    fail(
      `versionCode mismatch:\n` +
        `  ${path.relative(REPO_ROOT, v.path)} versionCode = ${v.versionCode}\n` +
        `  ${path.relative(REPO_ROOT, g.path)} versionCode = ${g.versionCode}\n` +
        `Update both pins to the same value before building tarballs.`
    );
  }
  return v.versionName;
}

function buildTarball({ outFile, sources }) {
  // Build tar args: change to repo root, exclude pattern list, add sources.
  const args = ['-czf', outFile, '-C', REPO_ROOT];
  for (const ex of EXCLUDES) {
    args.push(`--exclude=${ex}`);
  }
  for (const s of sources) args.push(s);

  process.stdout.write(`→ tar ${path.basename(outFile)} (${sources.join(', ')})\n`);
  const res = spawnSync('tar', args, { stdio: 'inherit' });
  if (res.status !== 0) fail(`tar exited with status ${res.status} for ${outFile}`);
  const size = fs.statSync(outFile).size;
  process.stdout.write(`   ${size} bytes → ${path.relative(process.cwd(), outFile)}\n`);
}

async function updateManifestForTarball({ version, artifact }) {
  if (!fs.existsSync(MANIFEST_PATH)) {
    fail(`manifest not found: ${MANIFEST_PATH}`);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const result = applyArtifactToManifest(manifest, { version, artifact });

  if (result.action === 'promoted') {
    process.stdout.write(
      `   → Promoted latest to v${version} (was v${result.previousLatest}); ` +
        `latest.notes reset — fill it in before publishing.\n`
    );
  } else if (result.action === 'older_only') {
    process.stdout.write(
      `   ! v${version} is older than current latest v${manifest.latest.version}; ` +
        `updated releases[] entry only.\n`
    );
  } else {
    process.stdout.write(`   → Updated latest.${artifact.latestKey} for v${version}.\n`);
  }

  writeJsonAtomic(MANIFEST_PATH, manifest);
}

async function main() {
  const version = ensureVersionsAgree();
  process.stdout.write(`✔ Android version pins agree: v${version}\n`);

  if (!fs.existsSync(RELEASE_DIR)) {
    fs.mkdirSync(RELEASE_DIR, { recursive: true });
  }

  const tarballs = [
    {
      outFile: path.join(RELEASE_DIR, `zachi-source-${version}.tar.gz`),
      sources: SOURCES_BY_TARBALL.android,
      latestKey: 'source_tarball',
      shaKey: 'source_sha256',
    },
    {
      outFile: path.join(RELEASE_DIR, `zachi-windows-source-${version}.tar.gz`),
      sources: SOURCES_BY_TARBALL.windows,
      latestKey: 'windows_tarball',
      shaKey: 'windows_sha256',
    },
  ];

  for (const t of tarballs) {
    // Atomic-ish: write to .tmp then rename.
    const tmp = `${t.outFile}.tmp-${process.pid}-${Date.now()}`;
    buildTarball({ outFile: tmp, sources: t.sources });
    fs.renameSync(tmp, t.outFile);

    const sha = await sha256OfFile(t.outFile);
    const size = fs.statSync(t.outFile).size;
    const filename = path.basename(t.outFile);
    process.stdout.write(`   sha256 ${sha}\n`);

    await updateManifestForTarball({
      version,
      artifact: {
        latestKey: t.latestKey,
        shaKey: t.shaKey,
        // Tarball releases[] entries historically carry only sha256, no size.
        // Omitting sizeKey preserves that shape.
        filename,
        sha,
        size,
      },
    });
  }

  process.stdout.write(
    `\nNext step: upload these tarballs to release storage and run\n` +
      `  node apps/zachi-pos/scripts/publish-release.js ${version} apk <path-to-apk>\n` +
      `  node apps/zachi-pos/scripts/publish-release.js ${version} msi <path-to-msi>\n` +
      `to register the platform installers in manifest.json.\n` +
      `Then edit apps/zachi-pos/public/release/manifest.json and fill in latest.notes.\n`
  );
}

main().catch((err) => fail(err && err.stack ? err.stack : String(err)));
