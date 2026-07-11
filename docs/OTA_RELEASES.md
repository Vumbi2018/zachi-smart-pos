# OTA Releases (Android + Windows)

Task #65 wired Zachi POS for over-the-air updates so a typical
release (controllers, migrations, templates, JS, CSS, HTML) ships to
every till on next app launch without anyone rebuilding or
redistributing an installer.

This runbook is the operating manual.

## What ships OTA, what doesn't

| Change                                              | OTA?    | Needs full installer rebuild? |
|-----------------------------------------------------|---------|-------------------------------|
| `apps/zachi-pos/public/**` (JS/CSS/HTML/templates)  | yes — both Android & Windows | no |
| Express controllers / services / routes / SQL       | yes (server-side, immediate) | no |
| New Capacitor plugin / native Android permission    | no      | yes — rebuild APK             |
| New Rust crate / `lib.rs` / `tauri.conf.json` shape | no      | yes — rebuild MSI             |
| Splash / icon / app name change                     | no      | yes — both                    |
| Signing-key rotation                                | no      | yes — both                    |

### How Windows OTA actually works

Tauri ships two parallel update channels and `public/js/ota-bridge.js`
drives both on every launch:

1. **Web-bundle swap (primary).** The till pulls the same
   `web-<version>.zip` that Android consumes via Capgo, verifies the
   SHA-256 from `/ota/windows-latest.json`, unzips into
   `%APPDATA%\zachi-pos\web-bundle\staging\`, atomic-renames into
   `current\` (previous version is kept as `backup\` for one-keypress
   rollback), and restarts. On next launch
   `src-tauri/src/web_bundle.rs::cached_index_url` points the webview
   at `file://%APPDATA%\zachi-pos\web-bundle\current\index.html` —
   the MSI is never touched. This is what handles the >99% of releases
   that are frontend-only.
2. **`tauri-plugin-updater` (secondary).** Only fires when
   `windows-latest.json.platforms["windows-x86_64"]` is populated
   (i.e. you passed `--win-bundle` to `release.mjs` because you also
   rebuilt the MSI for a Rust-side change). minisign-verified, passive
   install, silent relaunch.

If you're not sure, treat it as "needs installer rebuild" and bump
both wrapper versions too.

## One-time setup (per OTA host)

1. Pick the OTA host. We use the same VPS that already serves the POS,
   under `/var/www/zachipos/ota/`. Nginx exposes that directory at
   `https://pos.zachicomputercentre.com/ota/` (see `nginx.conf`).
2. Generate signing keys.
   - **Android (Capgo):** `npx @capgo/cli@latest key save` produces a
     keypair. Paste the **public** half into
     `apps/zachi-android/capacitor.config.json` →
     `plugins.CapacitorUpdater.publicKey`, keep the **private** half
     in your password manager (used by the release script's signing
     step — wire it in when you ship signed bundles).
   - **Windows (Tauri minisign):**
     `npx @tauri-apps/cli signer generate -w ~/.tauri/zachi.key` —
     copy the public key into `apps/zachi-windows/src-tauri/tauri.conf.json`
     → `plugins.updater.pubkey`. Set the private key path in
     `TAURI_SIGNING_PRIVATE_KEY_PATH` (and its password in
     `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) before running `tauri build`.
3. Rebuild both installers **once** with the OTA plugin baked in
   (`npm run build:android` and `npm run tauri:build:signed`) and roll
   out the resulting APK + MSI the old-fashioned way. Every release
   after this is OTA.

## Cutting a release

1. Make the changes in `apps/zachi-pos/`. Server side restarts via PM2
   as usual.
2. Bump the version in three places and **only** these three places:
   - `apps/zachi-pos/package.json` → `"version"`
   - `apps/zachi-pos/public/version.json` → `"version"` + `"released_at"`
   - If, and only if, you also rebuilt the wrappers this cycle:
     `apps/zachi-android/package.json`, `apps/zachi-android/scripts/version.json`,
     `apps/zachi-android/android/app/build.gradle`,
     `apps/zachi-windows/package.json`, `apps/zachi-windows/src-tauri/tauri.conf.json`,
     `apps/zachi-windows/src-tauri/Cargo.toml`.
3. Build the OTA payload:
   ```bash
   node tools/ota/release.mjs
   # or, if you also rebuilt the Windows installer this cycle:
   node tools/ota/release.mjs --win-bundle apps/zachi-windows/src-tauri/target/release/bundle/msi
   ```
   This writes `dist/ota/web-<v>.zip` and the two manifest JSONs.
4. Upload the payload and **rewrite manifests last** so no till sees a
   half-published release:
   ```bash
   rsync -av --exclude '*-latest.json' dist/ota/ \
       root@pos.zachicomputercentre.com:/var/www/zachipos/ota/
   rsync -av dist/ota/android-latest.json dist/ota/windows-latest.json \
       root@pos.zachicomputercentre.com:/var/www/zachipos/ota/
   ```
5. Verify:
   ```bash
   curl -fsS https://pos.zachicomputercentre.com/ota/android-latest.json | jq .
   curl -fsS https://pos.zachicomputercentre.com/ota/windows-latest.json | jq .
   ```
   Both should report the new version, and the `url` field should
   resolve with `curl -I` returning `200`.
6. Spot-check one Android till and one Windows till: relaunch the app
   and confirm the version in **Settings → About** matches.

## Rollback

OTA bundles are immutable and accumulate in `/var/www/zachipos/ota/`.
There are two channels and they roll back differently — this matters,
because the Windows web-bundle path refuses downgrades by version
number (see `isNewer()` in `public/js/ota-bridge.js`) and Capgo
accepts them.

### Android (Capgo) — server-side manifest downgrade

Point `android-latest.json` at the previous zip; Capgo will pull and
swap on next launch:

```bash
ssh root@pos.zachicomputercentre.com '
  cd /var/www/zachipos/ota
  # adjust the version numbers to whatever the previous good release was
  jq ".version=\"1.0.30\" | .url=\"https://pos.zachicomputercentre.com/ota/web-1.0.30.zip\" | .sha256=\"$(sha256sum web-1.0.30.zip | cut -d\\  -f1)\" | .checksum=.sha256" \
     android-latest.json > android-latest.json.tmp && mv android-latest.json.tmp android-latest.json
'
```

### Windows (Tauri web-bundle) — per-till command

`web_bundle.rs` keeps the previous bundle under
`%APPDATA%\zachi-pos\web-bundle\backup\`. Roll back by invoking the
`ota_web_bundle_rollback` Tauri command on the affected till — open
the devtools console (Ctrl+Shift+I) and run:

```js
window.__TAURI_INTERNALS__.invoke('ota_web_bundle_rollback')
  .then(() => window.__TAURI_INTERNALS__.invoke('plugin:process|restart'));
```

A future Settings entry will expose this as a button; until then the
support runbook is the devtools snippet above. Manifest-downgrade
does NOT work for the Windows web-bundle channel by design — the
till treats the older version as "not newer" and skips the swap.

### Windows (Tauri binary updater) — server-side manifest downgrade

For the MSI channel, point `windows-latest.json.platforms` at the
previous signed MSI artefacts; Tauri's updater treats any version
delta (up or down) as an update and reinstalls silently.

## Fail-safe behaviour

Both wrappers are configured to keep running the last known-good
bundle if anything goes wrong:

- **Android (Capgo):** `autoDeleteFailed: true` plus the
  `notifyAppReady()` handshake in `public/js/ota-bridge.js`. If the
  new bundle fails to call `notifyAppReady()` within the configured
  `appReadyTimeout`, Capgo rolls back automatically on next launch.
- **Windows (Tauri web-bundle):** `web_bundle.rs` only commits the
  atomic swap *after* the downloaded zip's SHA-256 matches the
  manifest and an `index.html` is present in the staged tree. Any
  failure wipes `staging\` and leaves `current\` untouched. The
  previous bundle is kept under `backup\` and can be restored by
  invoking the `ota_web_bundle_rollback` command (no Settings-UI
  button yet — invoke via the Tauri devtools console or a future
  Settings entry).
- **Windows (Tauri binary updater):** the front-end swallows
  `check()` errors in `public/js/ota-bridge.js`. A bad manifest,
  signature mismatch, or unreachable host all log a warning and the
  app keeps running the installed MSI.

## Security

- All OTA payloads are served over HTTPS from the same domain as the
  POS itself.
- Tauri verifies the minisign signature on MSI payloads (binary
  updater) before applying.
- The Windows web-bundle swap verifies the SHA-256 from the TLS-
  fetched `windows-latest.json` before unzipping; mismatch = no swap.
  A 64 MB hard cap in `web_bundle.rs::download_and_verify` prevents
  OOM from a hostile / runaway response, and `ensure_inside()`
  rejects zip-slip paths.
- Capgo verifies the SHA-256 checksum **and** the RSA signature
  (`plugins.CapacitorUpdater.publicKey` in
  `apps/zachi-android/capacitor.config.json`) before swapping
  bundles.
- The release script is read-only on the wrapper projects — it only
  zips `apps/zachi-pos/public/`, so a hostile commit in a wrapper
  directory cannot smuggle code into an OTA payload.
