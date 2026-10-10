@echo off
setlocal DisableDelayedExpansion
if not defined CUHK_LMS_HOME set "CUHK_LMS_HOME=%~dp0.cuhk-data"
set "LMS_HOME=%CUHK_LMS_HOME%"
set "LMS_UPDATE_CHECK=0"
set "ELECTRON_RUN_AS_NODE="
if not defined CUHK_NODE set "CUHK_NODE=node"
if not exist "%~dp0dist\src\cli.js" goto missing_build
if "%~1"=="" goto setup
"%CUHK_NODE%" "%~dp0bin\lms.js" %*
exit /b %errorlevel%
:setup
"%CUHK_NODE%" "%~dp0bin\lms.js" setup --preset cuhk --yes --no-codex
exit /b %errorlevel%
:missing_build
echo The project has not been built. Follow README-CUHK.md and run npm run build.
exit /b 1
