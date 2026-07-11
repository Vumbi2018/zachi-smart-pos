#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Deployment failed at line $LINENO while running: $BASH_COMMAND" >&2' ERR
APP_DIR="${APP_DIR:-/var/www/zachipos}"
REPO_URL="${REPO_URL:-https://github.com/Vumbi2018/zachi-smart-pos.git}"
BRANCH="${BRANCH:-main}"
PM2_APP="${PM2_APP:-zachi-pos}"
DB_DUMP="${1:-}"
BACKUP_DIR="${BACKUP_DIR:-/root/zachi-deploy-backups/$(date +%Y%m%d-%H%M%S)}"

if [[ $EUID -ne 0 ]]; then
  echo "Run this script as root on the Hostinger VPS."
  exit 1
fi

echo "==> Zachi Smart POS Hostinger deployment"
echo "    app dir:    $APP_DIR"
echo "    repo:       $REPO_URL"
echo "    branch:     $BRANCH"
echo "    pm2 app:    $PM2_APP"
echo "    backup dir: $BACKUP_DIR"

mkdir -p "$BACKUP_DIR"

if [[ -d "$APP_DIR" ]]; then
  echo "==> Backing up current source"
  tar --exclude=node_modules --exclude=logs --exclude=.git \
    -czf "$BACKUP_DIR/current-source.tar.gz" -C "$(dirname "$APP_DIR")" "$(basename "$APP_DIR")"
fi

if [[ -f "$APP_DIR/.env" ]]; then
  echo "==> Preserving current .env"
  cp "$APP_DIR/.env" "$BACKUP_DIR/env.backup"
fi

DATABASE_URL_VALUE=""
if [[ -f "$APP_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$APP_DIR/.env"
  set +a
  DATABASE_URL_VALUE="${DATABASE_URL:-}"
fi

if [[ -n "$DATABASE_URL_VALUE" ]]; then
  echo "==> Backing up current database"
  pg_dump "$DATABASE_URL_VALUE" --clean --if-exists --no-owner --no-privileges \
    -f "$BACKUP_DIR/current-db.sql"
else
  echo "!! No DATABASE_URL found in $APP_DIR/.env; skipping current DB backup"
fi

echo "==> Updating source from GitHub"
if [[ -d "$APP_DIR/.git" ]]; then
  git config --global --add safe.directory "$APP_DIR" || true
fi
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  TMP_DIR="$(mktemp -d)"
  git clone --branch "$BRANCH" "$REPO_URL" "$TMP_DIR/app"
  mkdir -p "$APP_DIR"
  rsync -a --delete \
    --exclude .git \
    --exclude .env \
    --exclude node_modules \
    --exclude logs \
    "$TMP_DIR/app/" "$APP_DIR/"
  rm -rf "$TMP_DIR"
fi

if [[ -f "$BACKUP_DIR/env.backup" && ! -f "$APP_DIR/.env" ]]; then
  cp "$BACKUP_DIR/env.backup" "$APP_DIR/.env"
fi

cd "$APP_DIR"
mkdir -p logs

if [[ -f "$APP_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$APP_DIR/.env"
  set +a
fi

if [[ "${NODE_ENV:-production}" == "production" ]]; then
  MISSING_ENV=()
  for key in DATABASE_URL JWT_SECRET CORS_ORIGIN APP_BASE_URL; do
    if [[ -z "${!key:-}" ]]; then
      MISSING_ENV+=("$key")
    fi
  done
  if (( ${#MISSING_ENV[@]} > 0 )); then
    echo "Missing required production values in $APP_DIR/.env: ${MISSING_ENV[*]}"
    echo "Add them, then rerun this script."
    exit 1
  fi
fi

echo "==> Installing production dependencies"
npm ci --omit=dev --omit=optional

if [[ -n "$DB_DUMP" ]]; then
  if [[ ! -f "$DB_DUMP" ]]; then
    echo "DB dump not found: $DB_DUMP"
    exit 1
  fi
  if [[ -z "${DATABASE_URL:-}" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$APP_DIR/.env"
    set +a
  fi
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL is required in $APP_DIR/.env before restoring data."
    exit 1
  fi
  echo "==> Stopping PM2 before database restore"
  pm2 stop "$PM2_APP" || true
  SANITIZED_DUMP="$BACKUP_DIR/restore-dump.sanitized.sql"
  perl -ne 'print unless /^\s*(SET transaction_timeout|COMMENT ON SCHEMA public|COMMENT ON EXTENSION|ALTER SCHEMA public OWNER TO|DROP EXTENSION)/' \
    "$DB_DUMP" > "$SANITIZED_DUMP"
  echo "==> Restoring database dump: $DB_DUMP"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SANITIZED_DUMP"
else
  echo "==> No DB dump argument provided; keeping existing database"
fi

echo "==> Running migrations"
npm run migrate

check_port_available() {
  local port="${1:-5000}"
  local listeners=""
  listeners="$(ss -ltnp "sport = :$port" 2>/dev/null || true)"
  if echo "$listeners" | grep -q LISTEN; then
    echo "Port $port is already in use after stopping $PM2_APP:"
    echo "$listeners"
    echo "Stop the conflicting service, or set another PORT in $APP_DIR/.env and update nginx proxy_pass."
    exit 1
  fi
}

echo "==> Restarting PM2"
APP_PORT="${PORT:-5000}"
if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  pm2 stop "$PM2_APP" || true
fi
sleep 1
check_port_available "$APP_PORT"
if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  pm2 delete "$PM2_APP" || true
fi
pm2 start ecosystem.config.js --env production
pm2 save

echo "==> Health check"
sleep 3
curl -fsS "http://127.0.0.1:${PORT:-5000}/api/health" || true
echo
echo "Deployment complete. Backups saved in $BACKUP_DIR"
