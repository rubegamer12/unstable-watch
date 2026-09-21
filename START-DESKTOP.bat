@echo off
setlocal
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js / npm was not found. Install Node.js 24.17 or newer first.
  pause
  exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing app dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :failed
)
call npm run verify
if errorlevel 1 goto :failed
call npm run desktop
exit /b %errorlevel%
:failed
echo.
echo Unstable Watch could not start. Check the error above.
pause
exit /b 1
