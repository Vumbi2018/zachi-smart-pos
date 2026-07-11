#!/usr/bin/env pwsh
# deploy_all.ps1 — Deploy all updated backend and frontend files to Hostinger VPS

param(
    [string]$User = "root",
    [string]$Server = "pos.zachicomputercentre.com",
    [string]$RemotePath = "/var/www/zachipos"
)

Write-Host "=== Zachi Smart-POS Full Deploy ===" -ForegroundColor Cyan
Write-Host "Target: $User@$Server`:$RemotePath" -ForegroundColor Yellow

# 1. Frontend JS and HTML
Write-Host "`n[1/4] Uploading frontend files..." -ForegroundColor Green
scp -r public/js/* "${User}@${Server}:${RemotePath}/public/js/"
scp public/index.html "${User}@${Server}:${RemotePath}/public/"

if ($LASTEXITCODE -ne 0) { Write-Error "SCP failed for frontend. Check SSH access."; exit 1 }

# 2. Controllers and Routes
Write-Host "`n[2/4] Uploading controllers and routes..." -ForegroundColor Green
scp -r controllers/* "${User}@${Server}:${RemotePath}/controllers/"
scp -r routes/* "${User}@${Server}:${RemotePath}/routes/"

if ($LASTEXITCODE -ne 0) { Write-Error "SCP failed for backend."; exit 1 }

# 3. Database Migrations
Write-Host "`n[3/4] Uploading all database migrations..." -ForegroundColor Green
scp -r db/migrations/* "${User}@${Server}:${RemotePath}/db/migrations/"

if ($LASTEXITCODE -ne 0) { Write-Error "SCP failed for migrations."; exit 1 }

# 4. Migrate and Restart Server
Write-Host "`n[4/4] Running database migrations and restarting PM2 on live server..." -ForegroundColor Green
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

Write-Host "`n=== Full Deploy complete! ===" -ForegroundColor Cyan
Write-Host "Refresh your browser at: https://pos.zachicomputercentre.com" -ForegroundColor Green
