# Escolhe em que pasta do SEU computador os filmes ficam.
#
# Por que isto e um script e nao um botao no site: o baixador roda dentro de um
# container, e um container so enxerga as pastas que foram montadas nele. Abrir
# uma pasta nova exige recriar o container - coisa que a pagina nao pode fazer,
# e nao deveria: dar ao site o poder de montar pastas suas seria dar a ele a
# maquina inteira. Entao a escolha e feita aqui, uma vez, e a partir dai o site
# mostra a pasta e deixa escolher entre as que existem.
#
# O que este script escreve fica em docker-compose.override.yml, que o docker
# le sozinho junto com o docker-compose.yml. O arquivo principal nao e tocado.

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

# O caminho de DENTRO do container. O de fora e escolhido abaixo; este e fixo,
# e e o que vai no WORKER_STORAGE_DIRS.
$DENTRO = '/discos/filmes'
$ROTULO = 'Meus filmes'

Write-Host ''
Write-Host '  Onde guardar os filmes' -ForegroundColor White
Write-Host '  ======================' -ForegroundColor DarkGray
Write-Host ''

$atual = ''
if (Test-Path -LiteralPath 'docker-compose.override.yml') {
    $linha = Select-String -LiteralPath 'docker-compose.override.yml' -Pattern '^\s*-\s*"(.+?):/discos/filmes"' -ErrorAction SilentlyContinue
    if ($linha) { $atual = $linha.Matches[0].Groups[1].Value.Replace('/', '\') }
}
if ($atual) {
    Nota "Hoje os filmes vao para:  $atual"
    Write-Host ''
}

$padrao = Join-Path ([Environment]::GetFolderPath('MyVideos')) 'juntos.lol'
if (-not $padrao -or $padrao -eq 'juntos.lol') { $padrao = Join-Path $env:USERPROFILE 'Videos\juntos.lol' }

Nota 'Digite o caminho de uma pasta sua. Por exemplo:'
Nota '  E:\Filmes'
if (-not $atual) { Nota "  $padrao" }
Write-Host ''
# Enter numa segunda passada nao pode mudar nada: quem so quis conferir onde
# esta gravando ficaria com os filmes noutro lugar sem ter pedido.
if ($atual) {
    Nota 'Enter sem digitar nada mantem a pasta de hoje.'
} else {
    Nota 'Enter sem digitar nada usa a sugestao acima.'
}
Write-Host ''
$escolha = (Read-Host '  Pasta').Trim().Trim('"')
if ($escolha -eq '') { $escolha = if ($atual) { $atual } else { $padrao } }

# Um caminho do Windows, absoluto. Nada de caminho de rede: o Docker Desktop
# nao monta \\servidor\pasta sem configuracao a parte, e falharia so na hora
# de subir, longe daqui.
if ($escolha.StartsWith('\\')) {
    Erro 'Pastas de rede (\\servidor\pasta) nao funcionam aqui.'
    Nota 'Mapeie a pasta para uma letra de unidade antes, e use a letra.'
    Fim 1
}
if ($escolha -notmatch '^[A-Za-z]:\\') {
    Erro 'Preciso do caminho completo, comecando pela letra da unidade.'
    Nota 'Exemplo: E:\Filmes'
    Fim 1
}

if (-not (Test-Path -LiteralPath $escolha)) {
    Passo "A pasta nao existe. Criando $escolha ..."
    try {
        New-Item -ItemType Directory -Path $escolha -Force -ErrorAction Stop | Out-Null
    } catch {
        Erro "Nao consegui criar a pasta: $($_.Exception.Message)"
        Fim 1
    }
}

# Escrever um arquivo de teste agora, e nao descobrir na primeira gravacao que
# a pasta e somente-leitura.
try {
    $teste = Join-Path $escolha '.juntos-teste'
    Set-Content -LiteralPath $teste -Value 'ok' -ErrorAction Stop
    Remove-Item -LiteralPath $teste -ErrorAction SilentlyContinue
} catch {
    Erro "A pasta existe, mas nao consigo escrever nela: $($_.Exception.Message)"
    Fim 1
}

# O docker aceita o caminho do Windows com barras normais, e as aspas cuidam
# dos espacos. Sem elas, "C:\Meus Filmes" viraria dois campos no YAML.
$montagem = $escolha.Replace('\', '/')
$override = @(
    '# Escrito por pasta.bat. Nao edite a mao: rode pasta.bat de novo.'
    '#'
    '# O docker le este arquivo junto com o docker-compose.yml, sozinho. Ele'
    '# so acrescenta a pasta escolhida ao baixador; o resto vem do outro.'
    'services:'
    '  worker:'
    '    volumes:'
    '      - juntos-worker:/var/lib/ss-worker'
    "      - `"$montagem`:$DENTRO`""
)
try {
    Set-Content -LiteralPath 'docker-compose.override.yml' -Value $override -Encoding ASCII -ErrorAction Stop
} catch {
    Erro "Nao consegui escrever o docker-compose.override.yml: $($_.Exception.Message)"
    Fim 1
}

# E a linha que diz ao baixador como chamar esse lugar.
if (Test-Path -LiteralPath '.env.local') {
    $env_linhas = @(Get-Content -LiteralPath '.env.local')
    $novo = @()
    $achou = $false
    foreach ($linha in $env_linhas) {
        if ($linha -match '^WORKER_STORAGE_DIRS=') {
            $novo += "WORKER_STORAGE_DIRS=$ROTULO=$DENTRO"
            $achou = $true
        } else {
            $novo += $linha
        }
    }
    if (-not $achou) { $novo += "WORKER_STORAGE_DIRS=$ROTULO=$DENTRO" }
    try {
        Set-Content -LiteralPath '.env.local' -Value $novo -Encoding ASCII -ErrorAction Stop
    } catch {
        Erro "Nao consegui atualizar o .env.local: $($_.Exception.Message)"
        Fim 1
    }
} else {
    Erro 'Falta o .env.local. Rode setup.bat primeiro.'
    Fim 1
}

Write-Host ''
Ok "Os filmes vao para $escolha"
Write-Host ''
Nota 'Vale a partir da proxima vez que o site subir. Se ele ja estiver de pe,'
Nota 'rode stop.bat e depois start.bat.'
Write-Host ''
Nota 'O que ja foi baixado antes fica onde estava; nada e movido.'
Fim 0
