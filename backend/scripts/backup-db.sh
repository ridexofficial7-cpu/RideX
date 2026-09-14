#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
OUT_DIR="${RIDEX_BACKUP_DIR:-./backups}"
mkdir -p "$OUT_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
pg_dump --format=custom --no-owner --file="$OUT_DIR/ridex_$STAMP.dump" "$DATABASE_URL"
find "$OUT_DIR" -type f -name 'ridex_*.dump' -mtime +14 -delete
echo "Backup created: $OUT_DIR/ridex_$STAMP.dump"
