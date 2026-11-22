@echo off
REM Lancador. A logica esta em diagnostico.ps1 (so le, nao muda nada).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnostico.ps1"
