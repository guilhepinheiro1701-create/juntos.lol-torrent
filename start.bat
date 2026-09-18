@echo off
setlocal
chcp 65001 >nul 2>&1
title juntos.lol

cd /d "%~dp0"

if not exist ".env.local" (
  echo.
  echo   [x] Falta o .env.local. Rode setup.bat primeiro.
  echo.
  pause
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [x] O Docker Desktop nao esta rodando. Abra ele e tente de novo.
  echo.
  pause
  exit /b 1
)

echo.
echo   Subindo o juntos.lol...
echo.
docker compose -f docker-compose.local.yml --env-file .env.local up -d
if errorlevel 1 (
  echo.
  echo   [x] Nao subiu. O erro esta acima.
  pause
  exit /b 1
)

REM O servidor leva alguns segundos para responder; abrir o navegador antes
REM disso mostra uma pagina de erro que assusta sem motivo.
echo   Esperando o servidor responder...
set /a tries=0
:wait
set /a tries+=1
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing http://localhost:8099/healthz -TimeoutSec 2) | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto ready
if %tries% geq 30 (
  echo.
  echo   [!] O servidor ainda nao respondeu. Os containers estao de pe, entao
  echo       provavelmente e so demora. Veja com:
  echo           docker compose -f docker-compose.local.yml logs -f app
  echo.
  pause
  exit /b 1
)
timeout /t 2 /nobreak >nul
goto wait

:ready
start http://localhost:8099
echo.
echo   Aberto em http://localhost:8099
echo.
echo   Para desligar, rode stop.bat. Fechar esta janela nao desliga nada:
echo   os containers ficam rodando em segundo plano.
echo.
timeout /t 8 /nobreak >nul
