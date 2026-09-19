@echo off
REM Lancador. A logica esta em setup.ps1: batch nao aguenta parenteses dentro de
REM blocos if(), e foi isso que quebrou a versao anterior deste arquivo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
