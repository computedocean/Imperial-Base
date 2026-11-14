@echo off
REM Imperial Base - stop the servers started by start.cmd or dev.cmd (ports 8742 and 5273).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1" %*
