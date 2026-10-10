@echo off
setlocal DisableDelayedExpansion
echo Checking CUHK Blackboard identity and courses...
call "%~dp0cuhk.cmd" --profile cuhk check
set "cuhk_result=%errorlevel%"
echo.
if "%cuhk_result%"=="0" (echo Connection check passed.) else (echo Check failed. Keep the error above for troubleshooting.)
pause
exit /b %cuhk_result%
