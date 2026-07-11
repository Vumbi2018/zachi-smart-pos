# Hostinger VPS Deployment Runbook

This deployment uses the recovered v1.0.51 source code and the all-sources database dump prepared during recovery.

## Files

Upload this database dump to the VPS before restoring data:

```text
outputs/zachi_pos_rebuild_all_sources_2026-07-11.sql
```

Recommended VPS location:

```text
/root/zachi_pos_rebuild_all_sources_2026-07-11.sql
```

## One-Time VPS Preparation

Confirm `/var/www/zachipos/.env` contains the production `DATABASE_URL`, `CORS_ORIGIN=https://pos.zachicomputercentre.com`, and `APP_BASE_URL`.

## Deploy

From the VPS:

```bash
cd /var/www/zachipos
bash scripts/deploy-hostinger-vps.sh /root/zachi_pos_rebuild_all_sources_2026-07-11.sql
```

The script backs up the current source and database before changing anything.

## Android / Offline-First Notes

The recovered source includes the server-side offline-first sync API, idempotency middleware, PWA service worker, OTA metadata, and native bridge JavaScript used by Android/Capacitor clients.

After the VPS is live, verify the Android APK points to:

```text
https://pos.zachicomputercentre.com
```

If the installed APK is version 1.0.42 or later, it should receive web bundle updates through the OTA metadata in `public/ota`. If the APK is older, install a new Android build once, then future web updates can flow OTA.
