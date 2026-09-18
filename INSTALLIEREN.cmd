@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Turbo Designs - Merge Update
node APPLY_MERGED_UPDATE.js
if errorlevel 1 (
  echo.
  echo FEHLER: Merge konnte nicht vollstaendig angewendet werden.
  pause
  exit /b 1
)
echo.
echo Fertig. Jetzt die aktualisierten Dateien committen/pushen und Railway deployen lassen.
pause
