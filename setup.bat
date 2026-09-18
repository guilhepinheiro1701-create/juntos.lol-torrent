@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title juntos.lol - instalacao

echo.
echo   juntos.lol, na sua maquina
echo   ==========================
echo.

cd /d "%~dp0"

REM ---------------------------------------------------------------- Docker --
REM A pilha inteira roda em containers, entao Docker e a unica coisa que
REM precisa estar instalada. Nao baixamos nem rodamos o instalador por voce:
REM isso e software com privilegio de administrador, e quem decide instalar
REM e voce, na pagina oficial.
where docker >nul 2>&1
if errorlevel 1 (
  echo   [x] O Docker Desktop nao esta instalado.
  echo.
  echo       Baixe em https://www.docker.com/products/docker-desktop/
  echo       instale, abra uma vez, e rode este setup de novo.
  echo.
  start https://www.docker.com/products/docker-desktop/
  pause
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo   [x] O Docker esta instalado mas nao esta rodando.
  echo.
  echo       Abra o Docker Desktop, espere ficar verde, e rode de novo.
  echo.
  pause
  exit /b 1
)
echo   [ok] Docker encontrado e rodando.

REM ------------------------------------------------------------ segredos ---
REM Gerados aqui, uma vez, e guardados em .env.local. Nada de senha padrao
REM num arquivo versionado: o MinIO desta pilha guarda os seus filmes.
if exist ".env.local" (
  echo   [ok] .env.local ja existe, mantendo os segredos que estao nele.
) else (
  echo   [..] Gerando .env.local com segredos novos...
  for /f "usebackq delims=" %%s in (`powershell -NoProfile -Command "[Guid]::NewGuid().ToString('N')"`) do set "MINIO_PASS=%%s"
  for /f "usebackq delims=" %%s in (`powershell -NoProfile -Command "[Guid]::NewGuid().ToString('N')"`) do set "WORKER_SECRET=%%s"
  (
    echo # Escrito pelo setup.bat. Os segredos aqui sao desta instalacao.
    echo # Apagar este arquivo e rodar o setup de novo gera outros, e o MinIO
    echo # antigo deixa de abrir: guarde-o junto com o resto.
    echo MINIO_ROOT_USER=juntos
    echo MINIO_ROOT_PASSWORD=!MINIO_PASS!
    echo MINIO_BUCKET=juntos
    echo S3_HOST=juntos-minio
    echo WORKER_ENROLLMENT_SECRET=!WORKER_SECRET!
    echo.
    echo # Quanto disco o worker pode usar para os torrents, em GB.
    echo WORKER_DISK_QUOTA_GB=35
    echo.
    echo # Mais de um disco? Liste como rotulo=caminho, separados por virgula:
    echo #   WORKER_STORAGE_DIRS=SSD=/discos/ssd,HDD=/discos/hdd
    echo # Os caminhos sao de dentro do container, entao monte-os antes em
    echo # docker-compose.local.yml, no bloco `volumes` do servico `worker`.
    echo # Com dois ou mais, a aba Baixados mostra a escolha.
    echo WORKER_STORAGE_DIRS=
  ) > ".env.local"
  echo   [ok] .env.local criado.
)

REM ------------------------------------------------------------- hosts -----
REM O nome do MinIO precisa resolver igual dentro do container e no navegador,
REM porque a assinatura S3 inclui o Host. Dentro, o compose resolve sozinho;
REM aqui fora, o Windows precisa da linha no arquivo hosts.
findstr /c:"juntos-minio" "%SystemRoot%\System32\drivers\etc\hosts" >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [!] Falta uma linha no arquivo hosts do Windows.
  echo.
  echo       O navegador busca os segmentos de video em juntos-minio:9000, e
  echo       esse nome precisa apontar para esta maquina. Sem isso o video
  echo       nao toca.
  echo.
  echo       Abrindo um pedido de administrador para adicionar a linha...
  echo.
  REM Por arquivo, e nao por -Command inline: aspas aninhadas dentro de
  REM Start-Process dentro de um .bat quebram de formas dificeis de depurar,
  REM e este e justamente o script que nao pode exigir depuracao.
  > "%TEMP%\juntos-hosts.ps1" echo $f = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
  >>"%TEMP%\juntos-hosts.ps1" echo if (-not (Select-String -Path $f -Pattern 'juntos-minio' -Quiet)) {
  >>"%TEMP%\juntos-hosts.ps1" echo   Add-Content -Path $f -Value "`r`n127.0.0.1 juntos-minio"
  >>"%TEMP%\juntos-hosts.ps1" echo }
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%TEMP%\juntos-hosts.ps1'"
  del "%TEMP%\juntos-hosts.ps1" >nul 2>&1
  findstr /c:"juntos-minio" "%SystemRoot%\System32\drivers\etc\hosts" >nul 2>&1
  if errorlevel 1 (
    echo   [x] Nao deu. Adicione voce mesmo, com o Bloco de Notas como
    echo       administrador, em %SystemRoot%\System32\drivers\etc\hosts:
    echo.
    echo           127.0.0.1 juntos-minio
    echo.
    pause
    exit /b 1
  )
)
echo   [ok] juntos-minio aponta para esta maquina.

REM -------------------------------------------------------------- build ----
echo.
echo   [..] Montando as imagens. A primeira vez demora bastante: compila o
echo        servidor em Go, o worker em Rust e o site. Deixe rodando.
echo.
docker compose -f docker-compose.local.yml --env-file .env.local build
if errorlevel 1 (
  echo.
  echo   [x] A montagem falhou. O erro esta acima.
  pause
  exit /b 1
)

echo.
echo   ==========================================================
echo     Pronto. Daqui em diante e so clicar em start.bat.
echo   ==========================================================
echo.
pause
