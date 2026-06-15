#!/usr/bin/env bash
# ╔═══════════════════════════════════════════════════════════╗
# ║ PetabyteAi — bare-metal install (Linux/macOS)             ║
# ╚═══════════════════════════════════════════════════════════╝
# Walks a new operator through:
#   1. Node version check
#   2. npm install
#   3. .env setup (copies template, generates SESSION_SECRET)
#   4. DB connectivity check
#   5. Migrations
# Does NOT start the server — use `npm start` or a process manager.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

say()  { printf '\n\033[1;36m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[install] ⚠ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[install] ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 1. node ──────────────────────────────────────────────────
say "Checking Node.js"
command -v node >/dev/null || die "node not found — install Node 18+ (https://nodejs.org)"
NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 18 ]; then
    die "Node ${NODE_MAJOR} is too old — need >=18"
fi
say "Node $(node -v) ✓"

# ── 2. deps ──────────────────────────────────────────────────
say "Installing npm deps"
npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# ── 3. .env ──────────────────────────────────────────────────
if [ ! -f .env ]; then
    say "Creating .env from template"
    cp .env.example .env
    # fill in a fresh SESSION_SECRET
    SECRET="$(node -e 'console.log(require("crypto").randomBytes(48).toString("hex"))')"
    # portable in-place edit
    if sed --version >/dev/null 2>&1; then
        sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=${SECRET}|" .env
    else
        sed -i '' "s|^SESSION_SECRET=.*|SESSION_SECRET=${SECRET}|" .env
    fi
    warn "Edit .env — set DB_PASS and OPENAI_API_KEY before continuing."
    exit 0
else
    say ".env already exists — leaving it alone"
fi

# ── 4. DB probe ──────────────────────────────────────────────
say "Probing database"
if ! node -e "
    require('dotenv').config();
    const {Pool}=require('pg');
    const p=new Pool({host:process.env.DB_HOST,port:+process.env.DB_PORT||5432,
        database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASS});
    p.query('SELECT 1').then(()=>{console.log('  ✓ connected to',process.env.DB_HOST,'/',process.env.DB_NAME); p.end();})
     .catch(e=>{console.error('  ✗',e.message); process.exit(1);});
"; then
    die "DB connection failed — check .env (DB_HOST/PORT/USER/PASS) and that Postgres is running"
fi

# ── 5. migrations ────────────────────────────────────────────
say "Running migrations"
npm run migrate

say "Done. Start the server with:"
printf '    npm start\n\n'
