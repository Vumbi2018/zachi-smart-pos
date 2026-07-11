# Zachi Smart-POS — Deployment Guide

This guide covers deploying Zachi Smart-POS to a Hostinger VPS (or any
Linux host running Node 20+ and PostgreSQL 14+).

> **Security:** never commit a real `.env` to source control. The repo only
> contains `.env.example`. Always generate fresh secrets when standing up
> a new environment — see step 0 below.

## 0. Rotate-First Checklist (do this BEFORE the first prod boot)

The earlier `apps/zachi-pos/` zip bundled a real `.env` with live
credentials. Even though that file was scrubbed from this repo, anyone
who saw the zip has the secrets — treat them as compromised. Before the
first production start (and again any time you suspect a leak), rotate
every secret:

| # | Secret | Rotation step |
|---|--------|---------------|
| 1 | `POSTGRES_PASSWORD` (used inside `DATABASE_URL`) | `bash scripts/rotate-secrets.sh pg` — prints a strong password. Apply it with `sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD '<NEW>';"` then update `DATABASE_URL` in `.env`. |
| 2 | `JWT_SECRET` | `bash scripts/rotate-secrets.sh jwt` — prints a 96-hex-char value. Paste into `.env`. Logs every user out, which is intentional. |
| 3 | `EMAIL_PASS` (Gmail app password) | `bash scripts/rotate-secrets.sh email` — prints instructions. Generate a new 16-char app password at <https://myaccount.google.com/apppasswords>, paste into `.env`, then **revoke the old one on that same page**. |
| 4 | Apply changes | `pm2 reload zachi-pos --update-env` |
| 5 | Verify | `curl -fsS https://pos.zachicomputercentre.com/api/health` should return `{"status":"ok",...}`. Send a test password-reset email to confirm SMTP works. |

`bash scripts/rotate-secrets.sh` (no argument) prints all three at once.

## 1. Prerequisites

- Ubuntu 22.04+ (or any modern Linux)
- Node.js 20.x
- PostgreSQL 14+
- Nginx (HTTPS termination)
- PM2 (`npm i -g pm2`) — process supervision

## 2. First-time setup

```bash
# Clone or upload the app
cd /var/www
git clone <your-repo> zachipos
cd zachipos

# Install pinned production deps (skip Chromium — only PDF receipts need it)
PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev --omit=optional --no-audit --no-fund

# To enable PDF email receipts later, install with optional deps:
#   npm ci --omit=dev   # downloads Chromium for puppeteer
```

## 3. Configure environment

```bash
cp .env.example .env
nano .env    # fill in DATABASE_URL, JWT_SECRET, EMAIL_*, CORS_ORIGIN, APP_BASE_URL
```

Required in **production**:

- `DATABASE_URL` — full Postgres connection string (use the rotated
  password from step 0).
- `JWT_SECRET` — at least 32 chars; the boot check rejects weak/default
  values. Generate with `bash scripts/rotate-secrets.sh jwt`.
- `CORS_ORIGIN` — comma-separated list of allowed origins (e.g.
  `https://pos.zachicomputercentre.com`). The server refuses to start
  in production without it. Localhost is **not** auto-allowed in prod.
- `APP_BASE_URL` — canonical public URL used to build password-reset
  links. Required in production to prevent Host-header poisoning of
  emailed reset links.

## 4. Database

```bash
# Create the database (one-time)
sudo -u postgres createdb zachi_pos

# Apply migrations (idempotent — safe to re-run on every deploy)
npm run migrate

# Seed reference data (optional, only on first install)
npm run seed
```

### Migration filename change (one-time, safe)

Versions before April 2026 had two pairs of colliding migration files
(`004_*` and `005_*`). They were renamed to `004a_*`, `004b_*`,
`005a_*`, `005b_*`. The migrator includes a one-time shim that updates
the `migrations` table on existing databases so nothing is re-applied,
and now also stores a SHA-256 checksum of every applied file so silent
edits to historical migrations are detected on the next deploy.

## 5. Run with PM2

```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup        # follow the printed command to enable on-boot
pm2 logs zachi-pos
```

## 6. Nginx reverse proxy (HTTPS)

Use the included `nginx.conf` as a template. Minimum viable proxy:

```nginx
server {
    listen 443 ssl http2;
    server_name pos.zachicomputercentre.com;

    ssl_certificate     /etc/letsencrypt/live/pos.zachicomputercentre.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pos.zachicomputercentre.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

The app uses `app.set('trust proxy', 1)` so `express-rate-limit` keys on
the real client IP from `X-Forwarded-For` when exactly one trusted proxy
is in front (Nginx).

## 7. Updating an existing deployment

```bash
cd /var/www/zachipos
git pull                                                     # or upload the new source
PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev --omit=optional --no-audit --no-fund
npm run migrate                                              # safely no-ops if up to date
pm2 reload zachi-pos --update-env                            # zero-downtime reload
```

`bash deploy.sh root@pos.zachicomputercentre.com` automates the full
flow above (rsync → `npm ci` → migrate → Nginx reload → `pm2 reload` →
health check).

## 8. Logs & troubleshooting

- `pm2 logs zachi-pos` — application stdout/stderr
- `sudo journalctl -u nginx` — Nginx access/error
- `sudo -u postgres psql zachi_pos` — direct DB inspection
- "Missing required environment variables" → `.env` is missing one of
  `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `APP_BASE_URL`.
- Login returns 429 ("Too many login attempts") → the rate limiter
  tripped. Wait 15 minutes or `pm2 reload zachi-pos`.
- "Migration checksum mismatch" → an applied migration file was edited
  in place. Restore the original file or write a follow-on migration
  instead.

## 9. Backups

`scripts/backup-zachipos.sh` (run as a daily cron) dumps the database
to `/var/backups/zachi-pos/`. Adjust paths for your VPS.

```cron
15 2 * * * /var/www/zachipos/scripts/backup-zachipos.sh
```

## 10. Post-deploy verification

After every deploy, confirm:

- `curl -fsS https://pos.zachicomputercentre.com/api/health` returns
  `{"status":"ok",...}`.
- Login as a real user — sessions remain valid (no JWT secret rotation
  surprise).
- `pm2 logs zachi-pos --lines 100 --nostream` is free of `ERROR` lines.
