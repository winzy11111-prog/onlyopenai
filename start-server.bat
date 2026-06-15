@echo off
REM ─────────────────────────────────────────────────────────────────
REM  PetabyteAi launcher — Windows wrapper
REM  All real work happens in start.js (cross-platform).
REM
REM  Usage:
REM    start-server.bat              -> production
REM    start-server.bat --dev        -> hot-reload backend
REM    start-server.bat --no-browser -> skip auto-open
REM ─────────────────────────────────────────────────────────────────

setlocal
title PetabyteAi Server
chcp 65001 >nul 2>&1
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Node.js is not installed.
    echo  Download it from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

node start.js %*
set EXITCODE=%errorlevel%

if %EXITCODE% neq 0 (
    echo.
    echo  Launcher exited with code %EXITCODE%
    pause
)

endlocal & exit /b %EXITCODE%
