#!/bin/bash

# Zachi Smart-POS Deployment Script for Ubuntu VPS
# This script automates part of the setup on the server.

echo "🚀 Starting Zachi Smart-POS Deployment Setup..."

# 1. Update system
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js (v18)
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt install -y nodejs
fi

# 3. Install PostgreSQL
if ! command -v psql &> /dev/null; then
    echo "🐘 Installing PostgreSQL..."
    sudo apt install -y postgresql postgresql-contrib
    sudo -u postgres psql -c "CREATE DATABASE png_ccets;"
    sudo -u postgres psql -c "CREATE USER zachi_user WITH PASSWORD 'change_this_password';"
    sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE png_ccets TO zachi_user;"
fi

# 4. Install PM2 & Certbot
sudo npm install -g pm2
sudo apt install -y nginx certbot python3-certbot-nginx

# 5. Setup Project Directory (If first time)
TARGET_DIR="/var/www/zachi"
if [ ! -d "$TARGET_DIR" ]; then
    sudo mkdir -p "$TARGET_DIR"
    sudo chown $USER:$USER "$TARGET_DIR"
fi

echo "✅ Environment essentials ready."
echo "👉 Next steps: Upload your code to $TARGET_DIR, configure .env, and run 'pm2 start server.js'"
