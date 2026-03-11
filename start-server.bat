@echo off
title PetabyteAi Server
color 0A
echo.
echo  ==========================================
echo    PetabyteAi Server - Starting...
echo  ==========================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo  [ERROR] Node.js is not installed!
    echo.
    echo  Please download and install Node.js from:
    echo  https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo  Node.js found:
node --version

:: Go to server folder
cd /d "%~dp0server"

:: Install dependencies if node_modules missing
if not exist "node_modules" (
    echo.
    echo  Installing dependencies...
    call npm install
)

echo.
echo  ==========================================
echo    Server running at: http://localhost:3001
echo    Open your browser and go to that URL
echo  ==========================================
echo.

:: Start server
node server.js

pause
