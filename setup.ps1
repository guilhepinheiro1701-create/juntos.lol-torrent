# Instalacao do juntos.lol na sua maquina.
#
# A logica vive aqui, em PowerShell, e nao no setup.bat. O motivo e concreto:
# em .bat, um parentese dentro de um bloco `if (...)` fecha o bloco antes da
# hora, e este script precisa escrever codigo PowerShell cheio de parenteses.
# A versao anterior quebrava exatamente ali. O .bat agora so chama este arquivo.

# Deliberadamente NAO 'Stop': com ele, cada linha que o docker escreve em
# stderr (e ele escreve muitas, mesmo quando da tudo certo) vira um erro que
# aborta o script. Os erros aqui sao tratados um a um, por $LASTEXITCODE e
# try/catch, que e o que funciona com programas externos.
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot

function Titulo($texto) { Write-Host "`n  $texto" -ForegroundColor Cyan }
function Ok($texto)     { Write-Host "  [ok] $texto" -ForegroundColor Green }
function Passo($texto)  { Write-Host "  [..] $texto" -ForegroundColor Gray }
function Aviso($texto)  { Write-Host "  [!]  $texto" -ForegroundColor Yellow }
function Erro($texto)   { Write-Host "  [x]  $texto" -ForegroundColor Red }
function Nota($texto)   { Write-Host "       $texto" -ForegroundColor DarkGray }
function Fim($codigo) {
    Write-Host ''
    Read-Host '  Pressione Enter para fechar' | Out-Null
    exit $codigo
}

Write-Host ''
Write-Host '  juntos.lol, na sua maquina' -ForegroundColor White
Write-Host '  ==========================' -ForegroundColor DarkGray
Write-Host ''
Nota 'Este assistente roda uma vez. Ele confere o Docker, gera as senhas'
Nota 'desta instalacao e monta os programas. Depois e so o start.'

# ----------------------------------------------------------------- Docker --
# Tudo roda em containers: caixas isoladas com o programa e tudo de que ele
# precisa ja dentro. E por isso que a unica coisa a instalar e o Docker, em vez
# de Go, Rust, Node, FFmpeg e um banco de dados, um por um.
Titulo '1 de 4  Docker'

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    Erro 'O Docker nao esta instalado.'
    Write-Host ''
    Nota 'O Docker e o que roda o juntos.lol. Ele empacota o site, o servidor e'
    Nota 'o baixador de torrents em caixas prontas, entao voce nao precisa'
    Nota 'instalar mais nada alem dele.'
    Write-Host ''
    Nota 'Vou abrir a pagina oficial. Baixe o "Docker Desktop for Windows".'
    Nota 'Durante a instalacao ele pode pedir o WSL 2: aceite, e um componente'
    Nota 'do proprio Windows que o Docker usa. No fim ele pede para reiniciar.'
    Write-Host ''
    Nota 'Depois de instalar: abra o Docker Desktop uma vez, espere o icone da'
    Nota 'baleia no canto da tela parar de se mexer, e rode este setup de novo.'
    Write-Host ''
    Nota 'Nao instalo por voce de proposito: um instalador pede permissao de'
    Nota 'administrador, e quem decide dar isso e voce, na pagina do fabricante.'
    Start-Process 'https://www.docker.com/products/docker-desktop/'
    Fim 1
}

Passo 'Perguntando ao Docker se ele esta de pe (pode levar ate um minuto)...'
$servidor = (& docker version --format '{{.Server.Version}}' 2>$null | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or -not $servidor) {
    Erro 'O Docker esta instalado, mas nao esta respondendo.'
    Write-Host ''
    Nota 'Quase sempre e so ele ainda nao ter terminado de subir.'
    Write-Host ''
    Nota '1. Abra o Docker Desktop pelo menu Iniciar.'
    Nota '2. Espere o painel dizer "Engine running" (a baleia para de animar).'
    Nota '3. Rode este setup de novo.'
    Write-Host ''
    Nota 'Se ele reclamar do WSL 2, aceite instalar o que ele pedir e reinicie.'
    Write-Host ''
    Nota 'Se continuar, veja o que ele responde rodando: docker version'
    Fim 1
}
Ok "Docker de pe (motor $servidor)."

# O compose v2 e um subcomando; instalacoes antigas tem o docker-compose
# separado, que nao serve aqui.
& docker compose version 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Erro 'Este Docker nao tem o "compose" embutido.'
    Nota 'Atualize o Docker Desktop para uma versao recente e rode de novo.'
    Fim 1
}

# ---------------------------------------------------------------- senhas ---
# Geradas aqui, uma vez. O MinIO desta pilha guarda os seus filmes, e uma
# senha fixa num arquivo publicado no GitHub nao e senha.
Titulo '2 de 4  Senhas desta instalacao'

function NovoSegredo {
    $bytes = New-Object byte[] 24
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

if (Test-Path -LiteralPath '.env.local') {
    Ok '.env.local ja existe; mantendo as senhas que estao nele.'
} else {
    Passo 'Gerando .env.local...'
    $linhas = @(
        '# Escrito pelo setup. As senhas aqui sao SO desta instalacao.'
        '#'
        '# Se voce apagar este arquivo e rodar o setup de novo, elas mudam, e o'
        '# MinIO antigo (onde ficam os videos ja preparados) deixa de abrir.'
        '# Guarde-o junto com o resto, e nao publique em lugar nenhum.'
        ''
        'MINIO_ROOT_USER=juntos'
        "MINIO_ROOT_PASSWORD=$(NovoSegredo)"
        'MINIO_BUCKET=juntos'
        'S3_HOST=juntos-minio'
        "WORKER_ENROLLMENT_SECRET=$(NovoSegredo)"
        ''
        '# Quanto disco o baixador pode usar para os torrents, em GB.'
        'WORKER_DISK_QUOTA_GB=35'
        ''
        '# Mais de um disco? Liste como rotulo=caminho, separados por virgula:'
        '#   WORKER_STORAGE_DIRS=SSD=/discos/ssd,HDD=/discos/hdd'
        '# Os caminhos sao de DENTRO do container, entao monte-os antes em'
        '# docker-compose.local.yml, no bloco volumes do servico worker.'
        '# Com dois ou mais, a aba Baixados passa a mostrar a escolha.'
        'WORKER_STORAGE_DIRS='
    )
    # ASCII de proposito: um arquivo .env com marca de ordem de bytes (BOM) faz
    # o docker compose ler a primeira variavel com lixo invisivel na frente.
    try {
        Set-Content -LiteralPath '.env.local' -Value $linhas -Encoding ASCII -ErrorAction Stop
    } catch {
        Erro "Nao consegui escrever o .env.local: $($_.Exception.Message)"
        Nota 'A pasta esta somente-leitura, ou dentro de OneDrive sincronizando?'
        Fim 1
    }
    Ok '.env.local criado.'
}

# ----------------------------------------------------------------- hosts ---
# O navegador busca os pedacos do video em juntos-minio:9000. Esse nome precisa
# significar a mesma coisa dentro do container e aqui fora, porque a assinatura
# do S3 inclui o endereco: se nao bater, o envio e recusado e o video nao toca.
Titulo '3 de 4  Nome juntos-minio'

$hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$temHosts = $false
try {
    $temHosts = Select-String -LiteralPath $hostsPath -Pattern 'juntos-minio' -Quiet -ErrorAction Stop
} catch {
    Aviso "Nao consegui ler $hostsPath ($($_.Exception.Message))."
}

if ($temHosts) {
    Ok 'juntos-minio ja aponta para esta maquina.'
} else {
    Aviso 'Falta uma linha no arquivo hosts do Windows.'
    Write-Host ''
    Nota 'O navegador busca os pedacos do video no endereco juntos-minio, e'
    Nota 'esse nome precisa apontar para o seu proprio computador. Sem isso o'
    Nota 'video nao toca.'
    Write-Host ''
    Nota 'Vou pedir permissao de administrador para acrescentar uma linha em:'
    Nota "  $hostsPath"
    Nota 'A linha e exatamente esta, e nada mais:'
    Nota '  127.0.0.1 juntos-minio'
    Write-Host ''

    # O script vai para um arquivo e o arquivo e que sobe elevado. Passar este
    # codigo por -Command exigiria aspas dentro de aspas dentro de aspas.
    $auxiliar = Join-Path $env:TEMP 'juntos-hosts.ps1'
    $corpo = @'
$f = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
if (-not (Select-String -LiteralPath $f -Pattern 'juntos-minio' -Quiet)) {
    Add-Content -LiteralPath $f -Value "`r`n127.0.0.1 juntos-minio"
}
'@
    Set-Content -LiteralPath $auxiliar -Value $corpo -Encoding UTF8
    try {
        $p = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $auxiliar
        )
        if ($p.ExitCode -ne 0) { Aviso 'O pedido de administrador terminou com erro.' }
    } catch {
        Aviso 'O pedido de administrador foi recusado ou cancelado.'
    } finally {
        Remove-Item -LiteralPath $auxiliar -ErrorAction SilentlyContinue
    }

    $agora = $false
    try { $agora = Select-String -LiteralPath $hostsPath -Pattern 'juntos-minio' -Quiet -ErrorAction Stop } catch { }
    if (-not $agora) {
        Erro 'A linha continua faltando.'
        Write-Host ''
        Nota 'Faca a mao, uma vez so:'
        Nota '  1. Menu Iniciar, digite Bloco de Notas.'
        Nota '  2. Clique com o botao direito, "Executar como administrador".'
        Nota '  3. Arquivo, Abrir, e cole este caminho:'
        Nota "     $hostsPath"
        Nota '     (troque o filtro para "Todos os arquivos" para ve-lo)'
        Nota '  4. Acrescente esta linha no fim e salve:'
        Nota '     127.0.0.1 juntos-minio'
        Nota '  5. Rode este setup de novo.'
        Fim 1
    }
    Ok 'juntos-minio agora aponta para esta maquina.'
}

# --------------------------------------------------------------- montagem --
Titulo '4 de 4  Montando os programas'
Write-Host ''
Nota 'Agora o Docker compila o servidor (Go), o baixador de torrents (Rust) e'
Nota 'o site. Na primeira vez isso leva de 15 a 40 minutos, dependendo da'
Nota 'maquina e da internet. Nas proximas e quase instantaneo, porque fica'
Nota 'guardado.'
Write-Host ''
Nota 'Vai aparecer muito texto. Isso e normal. Deixe a janela aberta.'
Write-Host ''

& docker compose -f docker-compose.local.yml --env-file .env.local build
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Erro 'A montagem falhou. O motivo esta no texto acima.'
    Write-Host ''
    Nota 'As causas comuns:'
    Nota '  - Internet caiu no meio: rode o setup de novo, ele continua de onde'
    Nota '    parou.'
    Nota '  - Falta espaco em disco: o build precisa de uns 10 GB livres.'
    Nota '  - O Docker Desktop foi fechado no meio.'
    Fim 1
}

Write-Host ''
Write-Host '  ==========================================================' -ForegroundColor Green
Write-Host '    Pronto. Daqui em diante, clique em start.bat.' -ForegroundColor Green
Write-Host '  ==========================================================' -ForegroundColor Green
Write-Host ''
Nota 'O start abre o site sozinho no navegador, em http://localhost:8099'
Nota 'Para desligar, stop.bat. Fechar a janela nao desliga.'
Fim 0
