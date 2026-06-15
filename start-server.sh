#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  PetabyteAi launcher — Unix wrapper (macOS / Linux)
#  All real work happens in start.js (cross-platform).
#
#  Usage:
#    ./start-server.sh              # production
#    ./start-server.sh --dev        # hot-reload backend
#    ./start-server.sh --no-browser # skip auto-open
# ─────────────────────────────────────────────────────────────────

set -e

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
    printf '\n  \033[31m[ERROR]\033[0m Node.js is not installed.\n'
    printf '  Install from: https://nodejs.org/\n\n'
    exit 1
fi

exec node start.js "$@"
