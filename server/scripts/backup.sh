#!/usr/bin/env bash
# ╔═══════════════════════════════════════════════════════════╗
# ║ PetabyteAi — DB backup (Linux/macOS)                      ║
# ╚═══════════════════════════════════════════════════════════╝
# Produces a timestamped, gzipped pg_dump under ./backups/.
# Reads DB_* from .env.
#
#   ./scripts/backup.sh                # manual run
#   ./scripts/backup.sh --quiet        # no stdout (for cron)
#
# Retention: keeps last 14 files by default; override via BACKUP_KEEP.
# Schedule via cron (e.g. 0 3 * * *  /srv/petabyte/scripts/backup.sh --quiet).

set -euo pipefail

QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1
log() { [ "$QUIET" -eq 1 ] || printf '[backup] %s\n' "$*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

# load .env if present (won't override already-exported vars)
if [ -f .env ]; then
    set -a; . ./.env; set +a
fi

: "${DB_HOST:=localhost}"
: "${DB_PORT:=5432}"
: "${DB_NAME:=petabyte_ai}"
: "${DB_USER:=postgres}"
: "${DB_PASS:=}"
: "${BACKUP_DIR:=./backups}"
: "${BACKUP_KEEP:=14}"

command -v pg_dump >/dev/null || {
    echo "[backup] ✗ pg_dump not found — install postgresql-client" >&2
    exit 1
}

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/petabyte_ai-${STAMP}.sql.gz"

log "Dumping $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME → $OUT"
PGPASSWORD="$DB_PASS" pg_dump \
    --host="$DB_HOST" --port="$DB_PORT" \
    --username="$DB_USER" --dbname="$DB_NAME" \
    --no-owner --no-privileges --format=plain \
| gzip -9 > "$OUT"

SIZE="$(wc -c < "$OUT" | tr -d ' ')"
log "wrote $OUT (${SIZE} bytes)"

# retention
if [ "$BACKUP_KEEP" -gt 0 ]; then
    PRUNED=$(ls -1t "$BACKUP_DIR"/petabyte_ai-*.sql.gz 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) || true)
    if [ -n "$PRUNED" ]; then
        echo "$PRUNED" | xargs rm -f
        log "pruned $(echo "$PRUNED" | wc -l | tr -d ' ') old file(s)"
    fi
fi

log "done"
