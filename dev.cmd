@echo off
REM Imperial Base - development mode: backend on :8742 + Vite hot reload on :5273
cd /d "%~dp0"
start "Imperial Base backend" cmd /k "cd backend && .venv\Scripts\python -m uvicorn --factory app.main:create_app --host 127.0.0.1 --port 8742 --reload --no-proxy-headers --ws-max-size 65536"
cd frontend && npx vite --port 5273
