#!/usr/bin/env bash
# ╔═══════════════════════════════════════════════════════════╗
# ║ PetabyteAi — DB restore (Linux/macOS)                     ║
# ╚═══════════════════════════════════════════════════════════╝
# Restores a pg_dump .sql or .sql.gz produced by backup.sh.
#
#   ./scripts/restore.sh backups/petabyte_ai-20260420T030000Z.sql.gz
#
# DESTRUCTIVE: drops the target DB and re-creates it from the dump.
# Requires --yes to actually run; otherwise does a dry sanity check.

set -euo pipefail

FILE="${1:-}"
YES="${2:-}"

if [ -z "$FILE" ]; then
    cat >&2 <<EOF
usage: $0 <dump-file> [--yes]

DESTRUCTIVE — drops and re-creates \$DB_NAME from the dump.
Without --yes, we only probe + print the target DB.
EOF
    exit 1
fi
[ -f "$FILE" ] || { echo "[restore] ✗ file not found: $FILE" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"
[ -f .env ] && { set -a; . ./.env; set +a; }

: "${DB_HOST:=localhost}"
: "${DB_PORT:=5432}"
: "${DB_NAME:=petabyte_ai}"
: "${DB_USER:=postgres}"
: "${DB_PASS:=}"

command -v psql    >/dev/null || { echo "[restore] ✗ psql not found" >&2;    exit 1; }
command -v dropdb  >/dev/null || { echo "[restore] ✗ dropdb not found" >&2;  exit 1; }
command -v createdb>/dev/null || { echo "[restore] ✗ createdb not found" >&2;exit 1; }

say() { printf '[restore] %s\n' "$*"; }

say "source  : $FILE ($(wc -c < "$FILE" | tr -d ' ') bytes)"
say "target  : $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"

if [ "$YES" != "--yes" ]; then
    say "dry run — pass --yes as the 2nd argument to actually restore"
    exit 0
fi

export PGPASSWORD="$DB_PASS"

say "dropping existing $DB_NAME (if any)"
dropdb   --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" --if-exists "$DB_NAME"
say "creating fresh $DB_NAME"
createdb --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" "$DB_NAME"

say "loading dump"
if [[ "$FILE" == *.gz ]]; then
    gunzip -c "$FILE" | psql --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" --dbname="$DB_NAME" --quiet
else
    psql --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" --dbname="$DB_NAME" --quiet --file="$FILE"
fi

say "done — verify with: npm run migrate:status"
