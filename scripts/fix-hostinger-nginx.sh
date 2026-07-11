#!/usr/bin/env bash
set -Eeuo pipefail

APP_PORT="${APP_PORT:-5000}"
DOMAIN="${DOMAIN:-pos.zachicomputercentre.com}"
SITE_NAME="${SITE_NAME:-zachipos}"
SITES_AVAILABLE="/etc/nginx/sites-available/$SITE_NAME"
SITES_ENABLED="/etc/nginx/sites-enabled/$SITE_NAME"
BACKUP_DIR="${BACKUP_DIR:-/root/zachi-nginx-backups/$(date +%Y%m%d-%H%M%S)}"

if [[ $EUID -ne 0 ]]; then
  echo "Run this script as root on the Hostinger VPS."
  exit 1
fi

echo "==> Fixing Nginx reverse proxy for $DOMAIN"
echo "    app port:   $APP_PORT"
echo "    site name:  $SITE_NAME"
echo "    backup dir: $BACKUP_DIR"

mkdir -p "$BACKUP_DIR"

for conf in "$SITES_AVAILABLE" "$SITES_ENABLED"; do
  if [[ -f "$conf" ]]; then
    cp "$conf" "$BACKUP_DIR/$(basename "$conf").conf"
  fi
done

TARGET_CONF=""
if [[ -f "$SITES_AVAILABLE" ]]; then
  TARGET_CONF="$SITES_AVAILABLE"
elif [[ -f "$SITES_ENABLED" ]]; then
  TARGET_CONF="$SITES_ENABLED"
else
  echo "Could not find $SITES_AVAILABLE or $SITES_ENABLED"
  exit 1
fi

perl -0pi -e "s#proxy_pass\\s+http://127\\.0\\.0\\.1:\\d+;#proxy_pass http://127.0.0.1:$APP_PORT;#g" "$TARGET_CONF"

if [[ "$TARGET_CONF" == "$SITES_AVAILABLE" ]]; then
  ln -sfn "$SITES_AVAILABLE" "$SITES_ENABLED"
fi

echo "==> Testing Nginx configuration"
nginx -t

echo "==> Reloading Nginx"
systemctl reload nginx

echo "==> Local HTTPS health check through Nginx"
curl -kfsS --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health"
echo

echo "==> Public DNS records"
if command -v dig >/dev/null 2>&1; then
  echo "A records:"
  dig +short "$DOMAIN" A || true
  echo "AAAA records:"
  dig +short "$DOMAIN" AAAA || true
else
  getent ahosts "$DOMAIN" || true
fi

echo "==> Public HTTPS header"
curl -I "https://$DOMAIN" || true

cat <<EOF

Nginx is now configured to proxy $DOMAIN to 127.0.0.1:$APP_PORT.
If the local --resolve health check passed but the public HTTPS header still
shows "via: 1.1 google" or HTTP 404, update DNS/proxy settings so $DOMAIN
points directly to this VPS:

  A    $DOMAIN -> 72.60.233.213
  AAAA $DOMAIN -> 2a02:4780:5e:c31d::1

EOF
