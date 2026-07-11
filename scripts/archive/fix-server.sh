#!/bin/bash
echo "Cleaning up processes..."
pm2 delete zachi-pos || true
kill -9 $(lsof -t -i:5055) || true
kill -9 $(lsof -t -i:5001) || true

echo "Starting Zachi POS on PM2..."
cd /var/www/zachipos
pm2 start ecosystem.config.js --env production
pm2 save -f

echo "Checking PM2 startup logs:"
pm2 logs zachi-pos --lines 20 --nostream
