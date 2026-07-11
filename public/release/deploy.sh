#!/usr/bin/env bash
set -u
URL="https://e6e15dba-dd71-4723-9351-3efbdca9627e-00-1wbryprw3qwrg.picard.replit.dev/release/zachi-pos-1.0.1.tgz"
DEFAULT_APP=/var/www/zachipos
WORK=/tmp/zachi-update-$$
trap 'rm -rf "$WORK"' EXIT

c_red='\033[0;31m'; c_grn='\033[0;32m'; c_ylw='\033[1;33m'; c_off='\033[0m'
say()  { printf "${c_grn}▶ %s${c_off}\n" "$*"; }
warn() { printf "${c_ylw}⚠ %s${c_off}\n" "$*"; }
die()  { printf "${c_red}✖ %s${c_off}\n" "$*\n" >&2; exit 1; }

APP="${APP:-$DEFAULT_APP}"
say "Target install path: $APP"

# Safety gate: if the target already has a package.json that is NOT zachi-smart-pos, refuse.
if [ -f "$APP/package.json" ]; then
  PKGNAME=$(node -e 'try{console.log(require(process.argv[1]).name||"")}catch(e){}' "$APP/package.json" 2>/dev/null || echo "")
  if [ -n "$PKGNAME" ] && [ "$PKGNAME" != "zachi-smart-pos" ]; then
    die "Refusing to deploy: $APP already contains a different app ('$PKGNAME').
Set APP=/desired/path and re-run, e.g.:
  APP=/var/www/zachipos curl -fsSL <url>/release/deploy.sh | sudo -E bash"
  fi
fi

# If the dir doesn't exist, create it. Never auto-pick another app's path.
mkdir -p "$APP" || die "cannot create $APP"

say "Downloading v1.0.1 tarball"
mkdir -p "$WORK" && cd "$WORK"
curl -fSLo update.tgz "$URL" || die "download failed"
tar tzf update.tgz >/dev/null || die "bad tarball"

# Verify the tarball really is Zachi POS (defence in depth)
mkdir -p verify && tar xzf update.tgz -C verify ./package.json 2>/dev/null
VPKG=$(node -e 'try{console.log(require(process.argv[1]).name||"")}catch(e){}' "$WORK/verify/package.json" 2>/dev/null || echo "")
[ "$VPKG" = "zachi-smart-pos" ] || die "tarball is not zachi-smart-pos (got '$VPKG')"

ENV_BAK=""
if [ -f "$APP/.env" ]; then
  ENV_BAK="$WORK/.env.bak"
  cp "$APP/.env" "$ENV_BAK"
  say "Backed up existing .env"
fi

say "Extracting new release into $APP"
tar xzf update.tgz -C "$APP"

if [ -n "$ENV_BAK" ]; then
  cp "$ENV_BAK" "$APP/.env"
  say "Restored .env"
elif [ ! -f "$APP/.env" ]; then
  warn "No .env found — wrote a template at $APP/.env"
  cat > "$APP/.env" <<'EOF'
NODE_ENV=production
PORT=5000
DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:5432/zachipos
JWT_SECRET=CHANGE-ME-LONG-RANDOM-STRING
EMAIL_USER=zachicomputercentre120@gmail.com
EMAIL_PASS=svyzvmwkqrjdnljq
WHATSAPP_DIRECTOR_PHONE=+260974210067
EOF
  warn "Edit DATABASE_URL + JWT_SECRET in $APP/.env, then re-run this script."
  exit 0
fi

say "Installing production deps (1-2 min)"
cd "$APP"
PUPPETEER_SKIP_DOWNLOAD=true npm install --omit=dev --omit=optional --no-audit --no-fund \
  || die "npm install failed"

say "Running database migrations"
npm run migrate || warn "migrate exited non-zero (may be expected on first run)"

say "Reloading PM2"
if ! command -v pm2 >/dev/null 2>&1; then
  warn "pm2 not installed — installing globally"
  npm i -g pm2 || die "pm2 install failed"
fi
pm2 reload zachi-pos --update-env 2>/dev/null \
  || pm2 start server.js --name zachi-pos --cwd "$APP" --update-env
pm2 save >/dev/null 2>&1 || true
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

say "Health check"
sleep 2
PORT_VAL=$(grep -E '^PORT=' "$APP/.env" | cut -d= -f2 | tr -d '"' | tr -d "'")
PORT_VAL=${PORT_VAL:-5000}
HEALTH=$(curl -fsS "http://127.0.0.1:${PORT_VAL}/api/health" 2>/dev/null || echo "")
if echo "$HEALTH" | grep -q '"ok"\|"healthy"\|"status"'; then
  printf "${c_grn}✅  Deployed v1.0.1 — %s${c_off}\n" "$HEALTH"
else
  warn "Health endpoint did not return OK on port $PORT_VAL. Last 20 PM2 log lines:"
  pm2 logs zachi-pos --nostream --lines 20 2>/dev/null || true
  die "deploy finished but health check failed"
fi
