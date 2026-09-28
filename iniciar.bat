@echo off
cd /d "%~dp0"
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
timeout /t 2 >nul
start "" "http://localhost:5175/index.html"
