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
  echo Installing build dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :failed
)
echo Running verification...
call npm run verify
if errorlevel 1 goto :failed
echo Building Windows installer...
call npm run desktop:dist
if errorlevel 1 goto :failed
if exist "dist" explorer "dist"
echo.
echo Installer build completed.
pause
exit /b 0
:failed
echo.
echo Installer build failed. Check the error above.
pause
exit /b 1
