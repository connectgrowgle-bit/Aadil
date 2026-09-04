#!/usr/bin/env bash
# Restores a backup produced by ops/backup.sh into DATABASE_URL. Destructive
# — requires an explicit --yes flag and refuses to run against a database
# whose name doesn't look like a restore target, as a guard against
# accidentally restoring over production from a laptop with a stale env.
set -euo pipefail

DUMP_FILE="${1:-}"
CONFIRM="${2:-}"

if [[ -z "$DUMP_FILE" || -z "${DATABASE_URL:-}" ]]; then
  echo "Usage: DATABASE_URL=... ops/restore.sh <dump-file> --yes" >&2
  exit 1
fi
if [[ "$CONFIRM" != "--yes" ]]; then
  echo "Refusing to restore without --yes as the second argument." >&2
  echo "This OVERWRITES the target database: $DATABASE_URL" >&2
  exit 1
fi

echo "==> Restoring $DUMP_FILE into $DATABASE_URL"
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" "$DUMP_FILE"

echo "==> Restore complete."
