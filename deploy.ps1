#!/usr/bin/env pwsh
# deploy.ps1 — Deploy updated files to Hostinger VPS
# Usage: .\deploy.ps1 -User root
# (Hostinger VPS default SSH user is usually 'root' or 'u12345')

param(
    [string]$User = "root",
    [string]$Server = "pos.zachicomputercentre.com",
    [string]$RemotePath = "/var/www/zachipos"
)

Write-Host "=== Zachi Smart-POS Deploy ===" -ForegroundColor Cyan
Write-Host "Target: $User@$Server`:$RemotePath" -ForegroundColor Yellow

# ── 1. Copy changed JS files ──────────────────────────────────────────────────
Write-Host "`n[1/3] Uploading updated JS files..." -ForegroundColor Green
scp `
    public\js\api.js `
    public\js\app.js `
    public\js\utils.js `
    public\js\inventory.js `
    "${User}@${Server}:${RemotePath}/public/js/"

if ($LASTEXITCODE -ne 0) { Write-Error "SCP failed. Check SSH access."; exit 1 }

# ── 2. Copy new migration file ────────────────────────────────────────────────
Write-Host "`n[2/3] Uploading migration 007..." -ForegroundColor Green
scp `
    db\migrations\007_idle_timeout_and_ai_defaults.sql `
    "${User}@${Server}:${RemotePath}/db/migrations/"

if ($LASTEXITCODE -ne 0) { Write-Error "SCP failed."; exit 1 }

# ── 3. Run migrate + restart on server ───────────────────────────────────────
Write-Host "`n[3/3] Running migration and restarting PM2..." -ForegroundColor Green
ssh "${User}@${Server}" @"
  set -e
  cd $RemotePath
  echo '--- Running npm run migrate ---'
  npm run migrate
  echo '--- Restarting PM2 ---'
  pm2 restart zachi-pos
  pm2 logs zachi-pos --lines 15 --nostream
  echo '--- Done ---'
"@

Write-Host "`n=== Deploy complete! ===" -ForegroundColor Cyan
Write-Host "Visit: https://pos.zachicomputercentre.com" -ForegroundColor Green
