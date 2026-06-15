@echo off
REM ============================================================
REM   PetabyteAi - bare-metal install (Windows)
REM ============================================================
REM   1) node version check
REM   2) npm install
REM   3) .env setup (copies template + generates SESSION_SECRET)
REM   4) DB connectivity check
REM   5) migrations

setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo [install] Checking Node.js
where node >nul 2>nul || goto :no_node
for /f "tokens=*" %%v in ('node -e "console.log(process.versions.node.split('.')[0])"') do set NODE_MAJOR=%%v
if !NODE_MAJOR! LSS 18 (
    echo [install] X Node !NODE_MAJOR! is too old - need ^>=18
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo [install] Node %%v OK

echo.
echo [install] Installing npm deps
call npm ci --no-audit --no-fund
if errorlevel 1 (
    echo [install] npm ci failed - falling back to npm install
    call npm install --no-audit --no-fund
)

echo.
if not exist ".env" (
    echo [install] Creating .env from template
    copy /y .env.example .env >nul
    for /f "tokens=*" %%s in ('node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"') do set SECRET=%%s
    node -e "const fs=require('fs'); let t=fs.readFileSync('.env','utf8'); t=t.replace(/^SESSION_SECRET=.*/m,'SESSION_SECRET='+process.argv[1]); fs.writeFileSync('.env',t);" "!SECRET!"
    echo [install] !  Edit .env - set DB_PASS and OPENAI_API_KEY before re-running install.bat
    exit /b 0
) else (
    echo [install] .env already exists - leaving it alone
)

echo.
echo [install] Probing database
node -e "require('dotenv').config();const {Pool}=require('pg');const p=new Pool({host:process.env.DB_HOST,port:+process.env.DB_PORT||5432,database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASS});p.query('SELECT 1').then(()=>{console.log('  OK connected to',process.env.DB_HOST,'/',process.env.DB_NAME);p.end();}).catch(e=>{console.error('  X',e.message);process.exit(1);});"
if errorlevel 1 (
    echo [install] X DB connection failed - check .env and that PostgreSQL is running
    exit /b 1
)

echo.
echo [install] Running migrations
call npm run migrate
if errorlevel 1 exit /b 1

echo.
echo [install] Done. Start the server with:
echo         npm start
echo.
exit /b 0

:no_node
echo [install] X node not found - install Node 18+ from https://nodejs.org
exit /b 1
