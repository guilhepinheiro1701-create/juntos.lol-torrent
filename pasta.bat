@echo off
REM Lancador. A logica esta em pasta.ps1: batch nao aguenta parenteses dentro
REM de blocos if(), e foi isso que quebrou a primeira versao destes arquivos.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pasta.ps1"
