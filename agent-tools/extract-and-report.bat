@echo off
setlocal
cd /d "%~dp0.."
node "%~dp0extract-logs.mjs"
if errorlevel 1 (
  echo Extraction failed.
  exit /b 1
)
echo.
echo Done. Open agent-tools\logs-79951333428\REPORT.txt
pause