@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
if not defined CUHK_LMS_HOME set "CUHK_LMS_HOME=%~dp0.cuhk-data"
set "LMS_HOME=%CUHK_LMS_HOME%"
set "LMS_UPDATE_CHECK=0"
set "ELECTRON_RUN_AS_NODE="
if not exist "%~dp0node_modules\electron\dist\electron.exe" goto missing_electron
if not exist "%~dp0dist\src\dashboard\app.js" goto missing_build
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0." --dashboard
set "cuhk_result=%errorlevel%"
if "%cuhk_result%"=="0" exit /b 0
echo.
echo Dashboard could not start. Keep the error above for troubleshooting.
pause
exit /b %cuhk_result%
:missing_electron
echo Electron is missing. Follow the Windows setup in README-CUHK.md.
echo Run: npm ci
echo Then: node node_modules/electron/install.js
pause
exit /b 1
:missing_build
echo The Dashboard has not been built. Run: npm run build
pause
exit /b 1
