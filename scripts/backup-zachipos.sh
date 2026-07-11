#!/bin/bash
# Zachi POS — daily database backup script
# Installed at: /usr/local/bin/backup-zachipos.sh
DATE=$(date +%F)
BACKUP_FILE="/backups/zachipos_${DATE}.sql"

sudo -u postgres pg_dump zachi_pos > "${BACKUP_FILE}"

# Keep only the last 14 days of backups
find /backups -name "zachipos_*.sql" -mtime +14 -delete

SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
echo "[$(date)] Backup done: ${BACKUP_FILE} (${SIZE})"
