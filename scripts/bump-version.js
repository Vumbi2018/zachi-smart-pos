#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const VERSION_JSON = path.join(REPO_ROOT, 'apps/zachi-android/scripts/version.json');
const BUILD_GRADLE = path.join(REPO_ROOT, 'apps/zachi-android/android/app/build.gradle');
const TAURI_CONF = path.join(REPO_ROOT, 'apps/zachi-windows/src-tauri/tauri.conf.json');
const CARGO_TOML = path.join(REPO_ROOT, 'apps/zachi-windows/src-tauri/Cargo.toml');
const WIN_PACKAGE = path.join(REPO_ROOT, 'apps/zachi-windows/package.json');

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const GRADLE_NAME_RE = /(versionName\s+["'])([^"']+)(["'])/;
const GRADLE_CODE_RE = /(versionCode\s+)(\d+)/;
const CARGO_VERSION_RE = /(^version\s*=\s*")([^"]+)(")/m;

function fail(msg) {
  process.stderr.write(`bump-version: ${msg}\n`);
  process.exit(1);
}

function rel(p) {
  return path.relative(REPO_ROOT, p);
}

function parseArgs(argv) {
  const args = { newVersion: null, newCode: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--code') {
      const v = argv[++i];
      if (!v || !/^\d+$/.test(v)) fail(`--code requires a positive integer (got ${JSON.stringify(v)})`);
      args.newCode = parseInt(v, 10);
    } else if (a === '-h' || a === '--help') {
      process.stdout.write(usage());
      process.exit(0);
    } else if (a.startsWith('-')) {
      fail(`unknown flag: ${a}`);
    } else if (args.newVersion == null) {
      args.newVersion = a;
    } else {
      fail(`unexpected positional argument: ${a}`);
    }
  }
  if (!args.newVersion) fail(`missing <new-version>\n\n${usage()}`);
  if (!SEMVER_RE.test(args.newVersion)) {
    fail(`<new-version> must look like MAJOR.MINOR.PATCH (got ${JSON.stringify(args.newVersion)})`);
  }
  return args;
}

function usage() {
  return (
    'Usage: node apps/zachi-pos/scripts/bump-version.js <new-version> [--code <n>]\n' +
    '\n' +
    'Updates the app version pin in all five files at once:\n' +
    '  - apps/zachi-android/scripts/version.json (versionName + versionCode)\n' +
    '  - apps/zachi-android/android/app/build.gradle (versionName + versionCode)\n' +
    '  - apps/zachi-windows/src-tauri/tauri.conf.json (version)\n' +
    '  - apps/zachi-windows/src-tauri/Cargo.toml (version)\n' +
    '  - apps/zachi-windows/package.json (version)\n' +
    '\n' +
    'versionCode auto-increments by 1 unless --code <n> is passed.\n' +
    'Refuses to run if the existing pins disagree (fix the drift first).\n'
  );
}

function readFileOrFail(p) {
  if (!fs.existsSync(p)) fail(`missing file: ${rel(p)}`);
  return fs.readFileSync(p, 'utf8');
}

function readVersionJson() {
  const text = readFileOrFail(VERSION_JSON);
  let j;
  try {
    j = JSON.parse(text);
  } catch (e) {
    fail(`could not parse JSON in ${rel(VERSION_JSON)}: ${e.message}`);
  }
  if (!j.versionName) fail(`${rel(VERSION_JSON)} is missing versionName`);
  if (j.versionCode == null) fail(`${rel(VERSION_JSON)} is missing versionCode`);
  return {
    text,
    obj: j,
    versionName: String(j.versionName),
    versionCode: Number(j.versionCode),
  };
}

function readBuildGradle() {
  const text = readFileOrFail(BUILD_GRADLE);
  const nameMatch = text.match(GRADLE_NAME_RE);
  const codeMatch = text.match(GRADLE_CODE_RE);
  if (!nameMatch) fail(`could not find versionName in ${rel(BUILD_GRADLE)}`);
  if (!codeMatch) fail(`could not find versionCode in ${rel(BUILD_GRADLE)}`);
  return {
    text,
    versionName: nameMatch[2],
    versionCode: parseInt(codeMatch[2], 10),
  };
}

function readTauriConf() {
  const text = readFileOrFail(TAURI_CONF);
  let j;
  try {
    j = JSON.parse(text);
  } catch (e) {
    fail(`could not parse JSON in ${rel(TAURI_CONF)}: ${e.message}`);
  }
  if (!j.version) fail(`${rel(TAURI_CONF)} is missing version`);
  return { text, obj: j, version: String(j.version) };
}

function readCargoToml() {
  const text = readFileOrFail(CARGO_TOML);
  const m = text.match(CARGO_VERSION_RE);
  if (!m) fail(`could not find top-level version = "..." in ${rel(CARGO_TOML)}`);
  return { text, version: m[2] };
}

function readWinPackage() {
  const text = readFileOrFail(WIN_PACKAGE);
  let j;
  try {
    j = JSON.parse(text);
  } catch (e) {
    fail(`could not parse JSON in ${rel(WIN_PACKAGE)}: ${e.message}`);
  }
  if (!j.version) fail(`${rel(WIN_PACKAGE)} is missing version`);
  return { text, obj: j, version: String(j.version) };
}

function ensurePinsAgree(state) {
  const names = [
    [VERSION_JSON, state.versionJson.versionName],
    [BUILD_GRADLE, state.buildGradle.versionName],
    [TAURI_CONF, state.tauriConf.version],
    [CARGO_TOML, state.cargoToml.version],
    [WIN_PACKAGE, state.winPackage.version],
  ];
  const codes = [
    [VERSION_JSON, state.versionJson.versionCode],
    [BUILD_GRADLE, state.buildGradle.versionCode],
  ];

  const uniqueNames = new Set(names.map(([, v]) => v));
  if (uniqueNames.size > 1) {
    const lines = names.map(([p, v]) => `  ${rel(p)}: ${v}`).join('\n');
    fail(
      `version drift detected — the five files disagree on the current version:\n` +
        `${lines}\n` +
        `Pick the correct value, hand-edit the outliers to match, then re-run bump-version.`
    );
  }

  const uniqueCodes = new Set(codes.map(([, v]) => v));
  if (uniqueCodes.size > 1) {
    const lines = codes.map(([p, v]) => `  ${rel(p)}: versionCode = ${v}`).join('\n');
    fail(
      `versionCode drift detected — the two Android pins disagree:\n` +
        `${lines}\n` +
        `Pick the correct value, hand-edit the outlier to match, then re-run bump-version.`
    );
  }

  return {
    versionName: names[0][1],
    versionCode: codes[0][1],
  };
}

function writeAtomic(filePath, contents) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, filePath);
}

function buildNewContents(state, newVersion, newCode) {
  const out = [];

  // version.json — preserve key order by mutating the parsed object.
  const versionJsonObj = { ...state.versionJson.obj, versionName: newVersion, versionCode: newCode };
  out.push({ path: VERSION_JSON, contents: JSON.stringify(versionJsonObj, null, 2) + '\n' });

  // build.gradle — regex replace, preserve everything else byte-for-byte.
  let gradleText = state.buildGradle.text
    .replace(GRADLE_NAME_RE, `$1${newVersion}$3`)
    .replace(GRADLE_CODE_RE, `$1${newCode}`);
  out.push({ path: BUILD_GRADLE, contents: gradleText });

  // tauri.conf.json — top-level "version" only.
  const tauriObj = { ...state.tauriConf.obj, version: newVersion };
  out.push({ path: TAURI_CONF, contents: JSON.stringify(tauriObj, null, 2) + '\n' });

  // Cargo.toml — top-level version = "..." only. Anchored to start of line
  // so dependency version pins like `tauri = { version = "2", ... }` are
  // left alone.
  const cargoText = state.cargoToml.text.replace(CARGO_VERSION_RE, `$1${newVersion}$3`);
  out.push({ path: CARGO_TOML, contents: cargoText });

  // package.json — "version" field only.
  const winPkgObj = { ...state.winPackage.obj, version: newVersion };
  out.push({ path: WIN_PACKAGE, contents: JSON.stringify(winPkgObj, null, 2) + '\n' });

  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const state = {
    versionJson: readVersionJson(),
    buildGradle: readBuildGradle(),
    tauriConf: readTauriConf(),
    cargoToml: readCargoToml(),
    winPackage: readWinPackage(),
  };

  const current = ensurePinsAgree(state);
  const newCode = args.newCode != null ? args.newCode : current.versionCode + 1;

  if (args.newCode == null && args.newVersion === current.versionName) {
    fail(
      `current version pin is already ${current.versionName}; ` +
        `pass --code <n> if you really want to bump just the versionCode.`
    );
  }

  process.stdout.write(
    `Current pins: versionName=${current.versionName}, versionCode=${current.versionCode}\n` +
      `New pins:     versionName=${args.newVersion}, versionCode=${newCode}\n` +
      `Updating ${5} files...\n`
  );

  const writes = buildNewContents(state, args.newVersion, newCode);

  // Two-phase write: stage every file as a sibling .tmp first, then rename
  // them all. If any rename fails the partial state will at least be caught
  // by build-source-tarballs.js's pin-drift check on the next release.
  const staged = writes.map((w) => {
    const tmp = `${w.path}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, w.contents, 'utf8');
    return { tmp, finalPath: w.path };
  });

  for (const s of staged) {
    fs.renameSync(s.tmp, s.finalPath);
    process.stdout.write(`  ✔ ${rel(s.finalPath)}\n`);
  }

  process.stdout.write(
    `\nDone. Next steps:\n` +
      `  1. git diff to verify the bump.\n` +
      `  2. node apps/zachi-pos/scripts/build-source-tarballs.js\n` +
      `  3. Build the .apk / .msi on the Windows laptop, then\n` +
      `     node apps/zachi-pos/scripts/publish-release.js ${args.newVersion} apk <path>\n` +
      `     node apps/zachi-pos/scripts/publish-release.js ${args.newVersion} msi <path>\n`
  );
}

main();
