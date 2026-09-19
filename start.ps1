# Sobe o juntos.lol e abre no navegador.

# Nao 'Stop': o docker escreve em stderr o tempo todo, inclusive quando da
# certo. Os erros sao conferidos por $LASTEXITCODE, um a um.
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot

function Ok($texto)    { Write-Host "  [ok] $texto" -ForegroundColor Green }
function Passo($texto) { Write-Host "  [..] $texto" -ForegroundColor Gray }
function Erro($texto)  { Write-Host "  [x]  $texto" -ForegroundColor Red }
function Nota($texto)  { Write-Host "       $texto" -ForegroundColor DarkGray }
function Fim($codigo) {
    Write-Host ''
    Read-Host '  Pressione Enter para fechar' | Out-Null
    exit $codigo
}

Write-Host ''
Write-Host '  juntos.lol' -ForegroundColor White
Write-Host ''

if (-not (Test-Path -LiteralPath '.env.local')) {
    Erro 'Falta o .env.local.'
    Nota 'Rode setup.bat primeiro; ele so precisa rodar uma vez.'
    Fim 1
}

# Sem `| Select-Object` no meio de um comando externo: esse cmdlet encerra o
# cano cedo e mata o docker.exe, fazendo o codigo de saida mentir.
$saida = @(& docker version --format '{{.Server.Version}}' 2>&1)
if ($LASTEXITCODE -ne 0) {
    Erro 'O Docker Desktop nao esta rodando.'
    Nota 'Abra ele pelo menu Iniciar, espere o painel dizer "Engine running",'
    Nota 'e tente de novo.'
    Fim 1
}

Passo 'Subindo...'
# --remove-orphans limpa o que uma versao anterior deixou de pe e esta
# pilha nao usa mais: o MinIO e o criador do bucket sairam quando os
# segmentos passaram a morar numa pasta do proprio servidor.
& docker compose --env-file .env.local up -d --remove-orphans
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Erro 'Nao subiu. O motivo esta no texto acima.'
    Nota 'Para ver o que cada parte diz:'
    Nota '  docker compose logs -f app'
    Fim 1
}

# Abrir o navegador antes de o servidor responder mostra uma pagina de erro
# que assusta sem motivo. Entao esperamos ele dizer que esta vivo.
Passo 'Esperando o servidor responder...'
$pronto = $false
foreach ($tentativa in 1..40) {
    try {
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri 'http://localhost:8099/healthz' | Out-Null
        $pronto = $true
        break
    } catch {
        Start-Sleep -Seconds 2
    }
}

if (-not $pronto) {
    Write-Host ''
    Erro 'O servidor ainda nao respondeu depois de 80 segundos.'
    Nota 'As caixas estao de pe, entao costuma ser so demora na primeira vez.'
    Nota 'Veja o que ele esta fazendo com:'
    Nota '  docker compose logs -f app'
    Fim 1
}

Start-Process 'http://localhost:8099'
Write-Host ''
Ok 'Aberto em http://localhost:8099'
Write-Host ''
Nota 'Fechar esta janela NAO desliga nada: as caixas continuam rodando em'
Nota 'segundo plano, e o site segue disponivel. Para desligar, stop.bat.'
Write-Host ''
Start-Sleep -Seconds 6
