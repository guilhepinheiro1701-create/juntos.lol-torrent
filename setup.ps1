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
Titulo '1 de 3  Docker'

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

# A pergunta e feita com o resultado ja em memoria, e nunca com
# `| Select-Object -First 1` no meio de um comando externo: esse cmdlet encerra
# o cano assim que tem o que queria, o que mata o docker.exe antes da hora e
# faz o codigo de saida parecer erro com o Docker perfeitamente de pe. Foi
# exatamente isso que quebrou a versao anterior deste script.
function VersaoDoMotor {
    $saida = @(& docker version --format '{{.Server.Version}}' 2>&1)
    $codigo = $LASTEXITCODE
    $texto = @($saida | ForEach-Object { "$_" } | Where-Object { $_.Trim() -ne '' })
    if ($codigo -eq 0 -and $texto.Count -gt 0) { return $texto[0].Trim() }
    return $null
}

# O Docker Desktop costuma levar um tempo depois de aberto. Em vez de desistir
# na primeira tentativa, esperamos um pouco, que e o que a pessoa faria.
$servidor = $null
foreach ($tentativa in 1..6) {
    Passo "Perguntando ao Docker se ele esta de pe (tentativa $tentativa de 6)..."
    $servidor = VersaoDoMotor
    if ($servidor) { break }
    if ($tentativa -lt 6) { Start-Sleep -Seconds 5 }
}

if (-not $servidor) {
    Erro 'O Docker esta instalado, mas o motor dele nao respondeu.'
    Write-Host ''
    Nota 'Quase sempre e so ele ainda nao ter terminado de subir.'
    Write-Host ''
    Nota '1. Abra o Docker Desktop pelo menu Iniciar.'
    Nota '2. Espere o painel dizer "Engine running" (a baleia para de animar).'
    Nota '3. Rode este setup de novo.'
    Write-Host ''
    Nota 'Se ele reclamar do WSL 2, aceite instalar o que pedir e reinicie.'
    Write-Host ''
    Nota 'Para ver o que ele responde, abra o Prompt de Comando e rode:'
    Nota '  docker version'
    Fim 1
}
Ok "Docker de pe (motor $servidor)."

# O compose v2 e um subcomando. Instalacoes antigas tem um docker-compose
# separado, com hifen, que nao serve aqui.
& docker compose version 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Erro 'Este Docker nao tem o "compose" embutido.'
    Nota 'Atualize o Docker Desktop para uma versao recente e rode de novo.'
    Fim 1
}

# Uma tentativa anterior pode ter subido os containers com o arquivo de nuvem,
# que nao funciona aqui: ele pede credenciais da Cloudflare. Eles ficam
# reiniciando em looping e confundem quem olha o Docker Desktop.
# O docker deriva o nome do projeto da pasta: minusculas, e fora tudo que nao
# for letra, numero, hifen ou sublinhado. "juntos.lol-torrent" vira
# "juntoslol-torrent": o ponto cai, o hifen fica.
$pasta = Split-Path -Leaf $PSScriptRoot
$projetoErrado = ($pasta.ToLower() -replace '[^a-z0-9_-]', '')
$projetos = @(& docker compose ls --all --format json 2>&1 | ForEach-Object { "$_" })
if ($projetos -join '' -match [regex]::Escape($projetoErrado)) {
    Write-Host ''
    Aviso 'Achei containers de uma tentativa anterior, com o arquivo errado.'
    Nota 'Eles ficam reiniciando e reclamando de R2_ACCESS_KEY_ID e de'
    Nota 'SS_WORKER_TLS. Sao da versao de nuvem, que precisa de credenciais da'
    Nota 'Cloudflare e nao roda aqui.'
    Write-Host ''
    Nota 'Remova-os antes de continuar, no Prompt de Comando, nesta pasta:'
    Nota "  docker compose -p $projetoErrado down"
    Write-Host ''
    Nota 'Isso apaga so os containers; nada que voce tenha baixado se perde.'
    Nota 'Depois rode este setup de novo.'
    Fim 1
}

# ---------------------------------------------------------------- senhas ---
# Gerado aqui, uma vez. O baixador so entra na frota com este segredo, e um
# segredo fixo num arquivo publicado no GitHub nao e segredo.
Titulo '2 de 3  Segredo desta instalacao'

function NovoSegredo {
    $bytes = New-Object byte[] 24
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

if (Test-Path -LiteralPath '.env.local') {
    Ok '.env.local ja existe; mantendo o que esta nele.'
} else {
    Passo 'Gerando .env.local...'
    $linhas = @(
        '# Escrito pelo setup. O segredo aqui e SO desta instalacao.'
        '#'
        '# Ele e o que deixa o baixador entrar na frota do servidor. Se voce'
        '# apagar este arquivo e rodar o setup de novo, ele muda, e e so isso:'
        '# nada do que ja foi baixado se perde. Nao publique em lugar nenhum.'
        ''
        "WORKER_ENROLLMENT_SECRET=$(NovoSegredo)"
        ''
        '# Quanto disco o baixador pode usar para os torrents, em GB.'
        'WORKER_DISK_QUOTA_GB=35'
        ''
        '# Mais de um disco? Liste como rotulo=caminho, separados por virgula:'
        '#   WORKER_STORAGE_DIRS=SSD=/discos/ssd,HDD=/discos/hdd'
        '# Os caminhos sao de DENTRO do container, entao monte-os antes em'
        '# docker-compose.yml, no bloco volumes do servico worker.'
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

# --------------------------------------------------------------- montagem --
Titulo '3 de 3  Montando os programas'
Write-Host ''
Nota 'Agora o Docker compila o servidor (Go), o baixador de torrents (Rust) e'
Nota 'o site. Na primeira vez isso leva de 15 a 40 minutos, dependendo da'
Nota 'maquina e da internet. Nas proximas e quase instantaneo, porque fica'
Nota 'guardado.'
Write-Host ''
Nota 'Vai aparecer muito texto. Isso e normal. Deixe a janela aberta.'
Write-Host ''

& docker compose --env-file .env.local build
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
