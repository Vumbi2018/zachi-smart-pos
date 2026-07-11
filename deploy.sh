#!/usr/bin/env bash
# ============================================================
# Zachi Smart-POS — Deploy to Production VPS
# Usage: bash deploy.sh [user@host]
# Default host: root@pos.zachicomputercentre.com
# ============================================================
set -euo pipefail

HOST="${1:-root@pos.zachicomputercentre.com}"
REMOTE_DIR="/var/www/zachipos"
NGINX_CONF="/etc/nginx/sites-available/zachipos"

echo "🚀 Deploying to $HOST ..."

# --- 1. Sync changed files to server ---
echo "📦 Uploading files..."
rsync -avz --checksum \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude '.env' \
    --exclude '*.log' \
    --exclude 'uploads' \
    ./ "$HOST:$REMOTE_DIR/"

# --- 2. Install pinned dependencies (reproducible, no devDeps, no Chromium) ---
echo "📦 Installing dependencies (npm ci)..."
ssh "$HOST" "
    set -euo pipefail
    cd $REMOTE_DIR
    PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev --omit=optional --no-audit --no-fund
"

# --- 3. Apply database migrations (idempotent) ---
echo "🗄️  Applying migrations..."
ssh "$HOST" "cd $REMOTE_DIR && npm run migrate"

# --- 4. Update Nginx config if a template ships with the deploy ---
if [ -f nginx.conf ]; then
    echo "🔧 Updating Nginx config..."
    scp nginx.conf "$HOST:/tmp/zachipos.conf"
    ssh "$HOST" "
        set -euo pipefail
        sudo cp /tmp/zachipos.conf $NGINX_CONF
        sudo nginx -t && sudo systemctl reload nginx
        echo '✅ Nginx reloaded'
    "
fi

# --- 5. Zero-downtime reload via PM2 ---
echo "♻️  Reloading PM2 (zero-downtime)..."
ssh "$HOST" "
    set -euo pipefail
    cd $REMOTE_DIR
    if pm2 describe zachi-pos >/dev/null 2>&1; then
        pm2 reload zachi-pos --update-env
    else
        pm2 start ecosystem.config.js --env production
    fi
    pm2 save -f
"

# --- 6. Smoke check ---
echo ""
echo "🩺 Health check..."
ssh "$HOST" "curl -fsS http://127.0.0.1:5000/api/health" || {
    echo "❌ Health check failed — see PM2 logs:"
    ssh "$HOST" "pm2 logs zachi-pos --lines 50 --nostream"
    exit 1
}

echo ""
echo "✅ Deploy complete! App is live at https://pos.zachicomputercentre.com"
