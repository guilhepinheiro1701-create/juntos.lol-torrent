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

# Quando algo da errado, mostrar o que o servidor disse aqui mesmo. Mandar
# quem clicou num .bat abrir um Prompt de Comando e digitar outra coisa e
# deixar a pessoa sem saida.
function MostrarLog($servico) {
    Write-Host ''
    Nota "Ultimas linhas do ${servico}:"
    Write-Host ''
    $linhas = @(& docker compose --env-file .env.local logs --tail 40 $servico 2>&1)
    foreach ($linha in $linhas) { Write-Host "    $linha" -ForegroundColor DarkGray }
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
$versao = @(& docker version --format '{{.Server.Version}}' 2>&1)
if ($LASTEXITCODE -ne 0 -or $versao.Count -eq 0) {
    Erro 'O Docker Desktop nao esta rodando.'
    Nota 'Abra ele pelo menu Iniciar, espere o painel dizer "Engine running",'
    Nota 'e tente de novo.'
    Fim 1
}

# --build porque `up` sozinho reaproveita a imagem que ja existe. Depois de um
# `git pull` isso subia o programa velho com as configuracoes novas, e ele
# morria no boot reclamando de variaveis que nao existem mais. Com o cache do
# Docker, quando nada mudou isto leva segundos.
#
# --remove-orphans limpa o que uma versao anterior deixou de pe e esta pilha
# nao usa mais: o MinIO e o criador do bucket sairam quando os segmentos
# passaram a morar numa pasta do proprio servidor.
Passo 'Conferindo se algo mudou e subindo...'
Nota 'Se voce acabou de atualizar, ele recompila o que mudou. Pode demorar.'
Write-Host ''
& docker compose --env-file .env.local up -d --build --remove-orphans
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Erro 'Nao subiu. O motivo esta no texto acima.'
    Fim 1
}

# `up -d` devolve sucesso assim que manda subir, mesmo que o servidor morra um
# segundo depois. Entao "esta de pe" e "respondeu" sao duas perguntas, e esta
# espera faz as duas: quem so faz a segunda fica oitenta segundos olhando para
# uma caixa que ja morreu.
function AppCaiu {
    # `ps -q` devolve o id do container, ou nada se ele nem existe.
    $ids = @(& docker compose --env-file .env.local ps -q app 2>&1 |
        ForEach-Object { "$_" } | Where-Object { $_.Trim() -match '^[0-9a-f]{12,64}$' })
    if ($ids.Count -eq 0) { return $true }

    # O metodo tem de ser chamado numa linha propria: num argumento de comando,
    # o PowerShell passa `.Trim()` como texto em vez de executar.
    $alvo = $ids[0].Trim()
    $estado = @(& docker inspect --format '{{.State.Status}} {{.RestartCount}}' $alvo 2>&1 |
        ForEach-Object { "$_" } | Where-Object { $_.Trim() -ne '' })
    # Se a propria pergunta falhou, nao ha resposta: melhor seguir esperando do
    # que declarar morto um servidor que talvez esteja so devagar.
    if ($LASTEXITCODE -ne 0 -or $estado.Count -eq 0) { return $false }

    $partes = $estado[0].Trim() -split '\s+'
    if ($partes[0] -eq 'exited' -or $partes[0] -eq 'dead') { return $true }
    # Reiniciou pelo menos uma vez: esta em looping, e esperar mais nao muda.
    if ($partes.Count -gt 1 -and $partes[1] -match '^\d+$' -and [int]($partes[1]) -gt 0) {
        return $true
    }
    return $false
}

Write-Host ''
Passo 'Esperando o servidor responder...'
$pronto = $false
$caiu = $false
foreach ($tentativa in 1..40) {
    try {
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri 'http://localhost:8099/healthz' | Out-Null
        $pronto = $true
        break
    } catch {
        # As duas primeiras voltas nao acusam nada: o container acabou de ser
        # mandado subir e pode ainda nao aparecer.
        if ($tentativa -gt 2 -and (AppCaiu)) { $caiu = $true; break }
        Start-Sleep -Seconds 2
    }
}

if ($caiu) {
    Write-Host ''
    Erro 'O servidor subiu e morreu em seguida.'
    MostrarLog 'app'
    Write-Host ''
    Nota 'A ultima linha costuma dizer o que faltou. Se falar em variavel de'
    Nota 'ambiente, apague o .env.local e rode setup.bat de novo.'
    Fim 1
}

if (-not $pronto) {
    Write-Host ''
    Erro 'O servidor demorou demais para responder, mas continua de pe.'
    MostrarLog 'app'
    Fim 1
}

# Numa maquina sem navegador padrao definido isto falha, e a falha nao pode
# parecer um erro do site: ele esta de pe, so nao houve quem abrisse a pagina.
try {
    Start-Process 'http://localhost:8099' -ErrorAction Stop
    Write-Host ''
    Ok 'Aberto em http://localhost:8099'
} catch {
    Write-Host ''
    Ok 'O site esta de pe.'
    Nota 'Nao consegui abrir o navegador sozinho. Abra voce:'
    Nota '  http://localhost:8099'
}

# O endereco que serve nos OUTROS aparelhos da casa. Procurar isto a mao, no
# ipconfig, entre meia duzia de adaptadores virtuais que o proprio Docker cria,
# e o tipo de coisa que faz desistir.
#
# Pelo .NET, e nao por Get-NetIPAddress: aquele cmdlet nao existe em toda
# instalacao, e "comando nao encontrado" nao se cala com -ErrorAction. Um erro
# vermelho no fim de uma subida que deu certo assusta a toa.
function EnderecosDaRede {
    try {
        $nome = [System.Net.Dns]::GetHostName()
        return @([System.Net.Dns]::GetHostAddresses($nome) |
            Where-Object { $_.AddressFamily -eq 'InterNetwork' } |
            ForEach-Object { $_.IPAddressToString } |
            Where-Object { $_ -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' } |
            Select-Object -Unique)
    } catch {
        return @()
    }
}

$meu = EnderecosDaRede
if ($meu.Count -gt 0) {
    Write-Host ''
    Nota 'Na TV ou noutro computador da casa, abra:'
    foreach ($ip in $meu) { Write-Host "         http://${ip}:8099" -ForegroundColor White }
    Nota 'Funciona so dentro da sua rede. Nao abra essa porta no roteador.'
}

Write-Host ''
Nota 'Fechar esta janela NAO desliga nada: as caixas continuam rodando em'
Nota 'segundo plano, e o site segue disponivel. Para desligar, stop.bat.'
Write-Host ''
Start-Sleep -Seconds 6
