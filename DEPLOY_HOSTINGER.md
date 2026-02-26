# Hostinger VPS Deployment Guide — Zachi Smart-POS

This guide explains how to publish Zachi Smart-POS on a Hostinger VPS (Ubuntu) so it's accessible from the internet.

---

## Before You Start

You will need:
- A Hostinger VPS (Ubuntu 22.04 recommended)
- A domain name (pos.zachicomputercentre.com) pointed to the VPS IP (72.60.233.213)
- Your app code on GitHub

---

## Step 1 — Connect to Your VPS

Open your terminal or Hostinger's web terminal:

```bash
ssh root@72.60.233.213
```

---

## Step 2 — Install Node.js, PM2, Nginx, PostgreSQL, and Puppeteer Dependencies

```bash
# Update packages
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install PM2 (process manager — keeps your app running)
npm install -g pm2

# Install Nginx (web server / reverse proxy)
apt install -y nginx

# Install PostgreSQL
apt install -y postgresql postgresql-contrib

# Install Puppeteer / Chromium system dependencies (required for PDF generation)
apt install -y libnss3 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2
```

---

## Step 3 — Set Up PostgreSQL Database

```bash
# Switch to postgres user
su - postgres

# Open PostgreSQL shell
psql

# Create database and user
CREATE DATABASE zachi_pos;
CREATE USER zachiuser WITH ENCRYPTED PASSWORD 'your_strong_password';
GRANT ALL PRIVILEGES ON DATABASE zachi_pos TO zachiuser;
\q

# Exit postgres user
exit
```

---

## Step 4 — Upload Your App

**Option A — GitHub (recommended):**
```bash
cd /var/www
git clone git@github.com:Vumbi2018/zachi-pos.git zachipos
cd zachipos
```

**Option B — SFTP (FileZilla) or Hostinger File Manager:**
- Upload the entire project folder to `/var/www/zachipos`
- Skip `node_modules/` folder (don't upload it)

---

## Step 5 — Install Dependencies

```bash
cd /var/www/zachipos
npm install --omit=dev
```

---

## Step 6 — Configure Environment Variables

```bash
# Copy the example env file
cp .env.example .env
nano .env
```

Fill in your values:
```
PORT=5000
NODE_ENV=production
DATABASE_URL=postgresql://zachiuser:your_strong_password@localhost:5432/zachi_pos
JWT_SECRET=zachi-smart-pos-jwt-secret-change-in-production
EMAIL_USER=zachicomputercentre120@gmail.com
EMAIL_PASS="svyz vmwk qrjd nljq"
CORS_ORIGIN=https://pos.zachicomputercentre.com
```

Save: `Ctrl+X`, then `Y`, then `Enter`.

---

## Step 7 — Run Database Migrations

```bash
cd /var/www/zachipos
node db/create_db.js
node db/migrate.js
```

> This creates the database and all necessary tables.

---

## Step 8 — Start the App with PM2

```bash
cd /var/www/zachipos
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup   # Follow the printed command to auto-start on reboot
```

Verify it's running:
```bash
pm2 status
pm2 logs zachi-pos --lines 20
```

---

## Step 9 — Configure Nginx

```bash
# Copy the nginx config from the project
cp /var/www/zachipos/nginx.conf /etc/nginx/sites-available/zachipos

# Edit to replace 'yourdomain.com' with 'pos.zachicomputercentre.com'
nano /etc/nginx/sites-available/zachipos

# Enable the site
ln -s /etc/nginx/sites-available/zachipos /etc/nginx/sites-enabled/

# Remove default Nginx page
rm -f /etc/nginx/sites-enabled/default

# Test and reload
nginx -t && systemctl reload nginx
```

---

## Step 10 — Set Up Free SSL (HTTPS)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d pos.zachicomputercentre.com
```

Then uncomment the HTTPS block in your `nginx.conf`.

---

## Step 11 — Test Your App

Open your browser:
- `https://pos.zachicomputercentre.com` → should load the login screen
- `https://pos.zachicomputercentre.com/api/health` → should return `{"status":"ok",...}`

---

## After Deploying — Updating the App

When you make code changes:

```bash
cd /var/www/zachipos
git pull             # Pull latest code
npm install          # In case new packages were added
pm2 restart zachi-pos
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| App not loading | Check `pm2 logs zachi-pos` for errors |
| 502 Bad Gateway | PM2 app might have crashed — run `pm2 restart zachi-pos` |
| DB connection error | Check `.env` DATABASE_URL, and that PostgreSQL is running (`systemctl status postgresql`) |
| CSS/JS not loading | Check Nginx config paths match your actual folder |
| CORS error in browser | Set `CORS_ORIGIN=https://pos.zachicomputercentre.com` in `.env` and restart PM2 |
