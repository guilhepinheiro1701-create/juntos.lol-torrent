@echo off
setlocal
chcp 65001 >nul 2>&1
title juntos.lol - desligar

cd /d "%~dp0"

echo.
echo   Desligando o juntos.lol...
echo.
docker compose -f docker-compose.local.yml --env-file .env.local stop

echo.
echo   Desligado. Nada foi apagado: os filmes baixados, o banco e o bucket
echo   continuam onde estavam, e start.bat volta com tudo.
echo.
timeout /t 5 /nobreak >nul
