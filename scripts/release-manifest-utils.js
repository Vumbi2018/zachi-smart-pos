'use strict';

const fs = require('fs');
const crypto = require('crypto');

function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function writeJsonAtomic(filePath, obj) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath);
}

function copyFileSyncAtomic(src, dst) {
  const tmp = `${dst}.tmp-${process.pid}-${Date.now()}`;
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dst);
}

function compareSemver(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * Apply a single artifact (installer or source tarball) to a manifest object.
 *
 * Mutates `manifest` in place and returns metadata describing what changed:
 *   { action: 'promoted' | 'updated_latest' | 'older_only', previousLatest }
 *
 * Behaviour mirrors the original publish-release.js logic so that APK / MSI
 * installers and source / windows-source tarballs all flow through the same
 * code path:
 *   1. The matching `releases[]` entry is updated (or created if missing).
 *      Its `shaKey` is always set; its `sizeKey` is set when provided.
 *   2. If `version` is newer than `latest.version`, `latest` is promoted to
 *      the new version (notes reset to "") and the artifact is attached
 *      under `latestKey`.
 *   3. If `version` equals `latest.version`, the artifact is attached under
 *      `latestKey` without disturbing the rest of `latest` (notes preserved).
 *   4. If `version` is older than `latest.version`, only the `releases[]`
 *      entry is touched.
 *
 * @param {object} manifest    Parsed manifest.json contents (mutated).
 * @param {object} opts
 * @param {string} opts.version    Semver version string (e.g. "1.0.5").
 * @param {object} opts.artifact
 * @param {string} opts.artifact.latestKey  Key under `manifest.latest`
 *     (e.g. 'android_apk', 'windows_msi', 'source_tarball', 'windows_tarball').
 * @param {string} opts.artifact.shaKey     Key on the `releases[]` entry
 *     (e.g. 'apk_sha256', 'source_sha256').
 * @param {string} [opts.artifact.sizeKey]  Optional byte-size key on the
 *     `releases[]` entry (e.g. 'apk_size_bytes'). Tarballs omit this to
 *     match the historical manifest shape.
 * @param {string} opts.artifact.filename   Canonical filename inside /release/.
 * @param {string} opts.artifact.sha        Hex sha256 of the artifact.
 * @param {number} opts.artifact.size       Byte size of the artifact.
 */
function applyArtifactToManifest(manifest, { version, artifact }) {
  manifest.releases = Array.isArray(manifest.releases) ? manifest.releases : [];
  manifest.latest = manifest.latest || { version, channel: 'stable' };

  const latestEntry = {
    filename: artifact.filename,
    url: `/release/${artifact.filename}`,
    size_bytes: artifact.size,
    sha256: artifact.sha,
  };

  let releaseEntry = manifest.releases.find((r) => r && r.version === version);
  if (!releaseEntry) {
    releaseEntry = {
      version,
      released_at: new Date().toISOString(),
      channel: manifest.latest.channel || 'stable',
    };
    manifest.releases.unshift(releaseEntry);
  }
  releaseEntry[artifact.shaKey] = artifact.sha;
  if (artifact.sizeKey) {
    releaseEntry[artifact.sizeKey] = artifact.size;
  }

  const previousLatest = manifest.latest.version || 'none';
  const cmp = compareSemver(version, manifest.latest.version || '0.0.0');
  if (cmp > 0) {
    manifest.latest = {
      version,
      released_at: releaseEntry.released_at,
      channel: releaseEntry.channel || 'stable',
      notes: '',
    };
    manifest.latest[artifact.latestKey] = latestEntry;
    return { action: 'promoted', previousLatest };
  }
  if (cmp === 0) {
    manifest.latest[artifact.latestKey] = latestEntry;
    return { action: 'updated_latest', previousLatest };
  }
  return { action: 'older_only', previousLatest };
}

module.exports = {
  sha256OfFile,
  writeJsonAtomic,
  copyFileSyncAtomic,
  compareSemver,
  applyArtifactToManifest,
};
