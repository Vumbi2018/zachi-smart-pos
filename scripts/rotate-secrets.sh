#!/usr/bin/env bash
# ============================================================
# Zachi Smart-POS — Secret Rotation Helper
# Prints fresh values for every secret the app needs. Pipe the
# output into your environment-variable manager — never paste
# secrets into chat or commit them to git.
#
# Usage:
#   bash scripts/rotate-secrets.sh           # print all rotations
#   bash scripts/rotate-secrets.sh jwt       # only rotate JWT_SECRET
#   bash scripts/rotate-secrets.sh pg        # only Postgres password
#   bash scripts/rotate-secrets.sh email     # only Gmail app password
# ============================================================
set -euo pipefail

cmd="${1:-all}"

print_jwt() {
    echo ""
    echo "# === JWT_SECRET ==="
    echo "# Used to sign all session JWTs. Rotating it logs every user out."
    echo "# Update apps/zachi-pos/.env on the VPS, then run:"
    echo "#   pm2 reload zachi-pos --update-env"
    echo ""
    JWT="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
    echo "JWT_SECRET=$JWT"
}

print_pg() {
    echo ""
    echo "# === PostgreSQL password ==="
    echo "# 1. Generate the new password value below."
    echo "# 2. On the VPS, change it in Postgres:"
    echo "#      sudo -u postgres psql -c \"ALTER USER postgres WITH PASSWORD '<NEW>';\""
    echo "# 3. Update DATABASE_URL in apps/zachi-pos/.env with the new password."
    echo "# 4. Reload the app:"
    echo "#      pm2 reload zachi-pos --update-env"
    echo "# 5. Update any backup-script credentials (e.g. ~/.pgpass)."
    echo ""
    PG="$(node -e "console.log(require('crypto').randomBytes(24).toString('base64').replace(/[+\/=]/g, '').slice(0, 28))")"
    echo "POSTGRES_PASSWORD=$PG"
    echo "# Resulting DATABASE_URL: postgres://postgres:$PG@127.0.0.1:5432/zachi_pos"
}

print_email() {
    echo ""
    echo "# === Gmail app password ==="
    echo "# This script cannot generate a Google app password — you must create"
    echo "# one in your Google Account:"
    echo "#   https://myaccount.google.com/apppasswords"
    echo "# Steps:"
    echo "#   1. Sign in as the EMAIL_USER mailbox."
    echo "#   2. Generate a new 16-character app password labelled 'Zachi POS'."
    echo "#   3. REVOKE the old app password on the same page."
    echo "#   4. Update EMAIL_PASS in apps/zachi-pos/.env."
    echo "#   5. Reload the app:"
    echo "#        pm2 reload zachi-pos --update-env"
    echo "#   6. Send a test password-reset email to confirm SMTP works."
    echo ""
    echo "EMAIL_PASS=<paste 16-char Google app password here>"
}

case "$cmd" in
    jwt)   print_jwt   ;;
    pg)    print_pg    ;;
    email) print_email ;;
    all)
        echo "# ============================================================"
        echo "# Zachi Smart-POS — full secret rotation checklist"
        echo "# ============================================================"
        echo "# Run on the VPS as the deploy user. Pipe lines into .env one"
        echo "# at a time; do not commit any of these values."
        print_jwt
        print_pg
        print_email
        echo ""
        echo "# --- Final step (run after every secret you actually changed) ---"
        echo "# pm2 reload zachi-pos --update-env"
        ;;
    *)
        echo "Unknown command: $cmd" >&2
        echo "Usage: $0 [all|jwt|pg|email]" >&2
        exit 1
        ;;
esac
