#!/usr/bin/env bash
# Dumps the database to a timestamped, gzip-compressed custom-format file.
# Requires DATABASE_URL WITHOUT a ?schema= parameter — pg_dump rejects it
# outright, so this is checked here as well as in migrate.sh and env.ts,
# because the backup is the one place you cannot afford to discover this
# during an actual incident (docs/MISTAKES.md item 11).
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set." >&2
  exit 1
fi
if [[ "$DATABASE_URL" == *"?schema="* || "$DATABASE_URL" == *"&schema="* ]]; then
  echo "DATABASE_URL must not contain a ?schema= parameter (pg_dump rejects it)." >&2
  exit 1
fi

OUT_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$OUT_DIR/groweazzy_${STAMP}.dump"

echo "==> Dumping to $OUT_FILE"
pg_dump "$DATABASE_URL" --format=custom --compress=9 --file="$OUT_FILE"

echo "==> Verifying dump is readable"
pg_restore --list "$OUT_FILE" > /dev/null

echo "==> Backup complete: $OUT_FILE"
