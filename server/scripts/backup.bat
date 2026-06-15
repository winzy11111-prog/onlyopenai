@echo off
REM ============================================================
REM   PetabyteAi - DB backup (Windows)
REM ============================================================
REM   Reads DB_* from .env, dumps to .\backups\petabyte_ai-<stamp>.sql
REM   Requires pg_dump on PATH (installed with PostgreSQL).
REM
REM   Schedule with Task Scheduler:
REM     Action: Start a program
REM     Program: C:\path\to\server\scripts\backup.bat

setlocal EnableDelayedExpansion
cd /d "%~dp0.."

REM ── load .env ────────────────────────────────────────────────
if exist ".env" (
    for /f "usebackq tokens=1* delims==" %%a in (".env") do (
        set "line=%%a"
        if not "!line:~0,1!"=="#" if not "%%a"=="" set "%%a=%%b"
    )
)

if "%DB_HOST%"=="" set DB_HOST=localhost
if "%DB_PORT%"=="" set DB_PORT=5432
if "%DB_NAME%"=="" set DB_NAME=petabyte_ai
if "%DB_USER%"=="" set DB_USER=postgres
if "%BACKUP_DIR%"=="" set BACKUP_DIR=.\backups
if "%BACKUP_KEEP%"=="" set BACKUP_KEEP=14

where pg_dump >nul 2>nul || (
    echo [backup] X pg_dump not found - add PostgreSQL bin/ to PATH
    exit /b 1
)

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

for /f "tokens=*" %%s in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddTHHmmssZ"') do set STAMP=%%s
set OUT=%BACKUP_DIR%\petabyte_ai-%STAMP%.sql

echo [backup] Dumping %DB_USER%@%DB_HOST%:%DB_PORT%/%DB_NAME% -^> %OUT%
set PGPASSWORD=%DB_PASS%
pg_dump --host=%DB_HOST% --port=%DB_PORT% --username=%DB_USER% --dbname=%DB_NAME% --no-owner --no-privileges --format=plain --file="%OUT%"
if errorlevel 1 (
    echo [backup] X pg_dump failed
    exit /b 1
)

echo [backup] wrote %OUT%

REM retention: keep newest %BACKUP_KEEP%
powershell -NoProfile -Command ^
    "Get-ChildItem '%BACKUP_DIR%\petabyte_ai-*.sql' | Sort-Object LastWriteTime -Descending | Select-Object -Skip %BACKUP_KEEP% | Remove-Item -Force"

echo [backup] done
exit /b 0
