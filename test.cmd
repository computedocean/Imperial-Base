@echo off
REM Runs every automated test suite.
cd /d "%~dp0"
echo === backend (pytest) ===
backend\.venv\Scripts\python -m pytest -q backend\tests || exit /b 1
echo === frontend (vitest) ===
cd frontend && call npx vitest run || exit /b 1
echo === typecheck ===
call npx tsc --noEmit -p . || exit /b 1
echo ALL TESTS PASSED
