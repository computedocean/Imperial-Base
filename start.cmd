@echo off
REM Imperial Base - one-click start (Windows). Builds on first run, then serves http://127.0.0.1:8742
setlocal
cd /d "%~dp0"
if not exist backend\.venv\Scripts\python.exe (
  echo [Imperial Base] Creating Python virtual environment...
  python -m venv backend\.venv || goto :fail
  backend\.venv\Scripts\python -m pip install -q -r backend\requirements.txt || goto :fail
)
if not exist frontend\node_modules (
  echo [Imperial Base] Installing frontend dependencies...
  pushd frontend && call npm install --no-fund --no-audit && popd || goto :fail
)
REM Rebuild when the build is missing or older than the sources, so the app never lags behind the code.
backend\.venv\Scripts\python scripts\frontend_stale.py >nul
if errorlevel 1 (
  echo [Imperial Base] Building frontend...
  pushd frontend && call npx vite build && popd || goto :fail
)
echo [Imperial Base] Starting command server on http://127.0.0.1:8742
start "" http://127.0.0.1:8742/
cd backend
.venv\Scripts\python -m uvicorn --factory app.main:create_app --host 127.0.0.1 --port 8742 --log-level warning
goto :eof
:fail
echo [Imperial Base] Startup failed - see messages above.
exit /b 1
