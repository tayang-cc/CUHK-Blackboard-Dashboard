@echo off
setlocal DisableDelayedExpansion
call "%~dp0cuhk.cmd" setup --preset cuhk --yes --no-codex
set "cuhk_result=%errorlevel%"
echo.
pause
exit /b %cuhk_result%
