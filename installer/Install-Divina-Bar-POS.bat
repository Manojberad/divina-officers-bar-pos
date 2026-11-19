@echo off
setlocal
title Divina Officers' Bar POS - Offline Installer

set "BAT_PATH=%~f0"
set "SCRIPT_DIR=%~dp0"

:: Request Administrator privileges (UAC) if not already elevated
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo  Divina Officers' Bar POS - Standalone Offline Installer
  echo  Requesting Administrator permission to install...
  echo  (Click "Yes" on the Windows permission prompt)
  echo.
  powershell -NoProfile -Command "Start-Process -FilePath $env:BAT_PATH -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install.ps1"
set "RC=%errorlevel%"
echo.
if %RC% neq 0 (
  echo  Installation stopped with an error (code %RC%). Please review the message above.
)
pause
exit /b %RC%
