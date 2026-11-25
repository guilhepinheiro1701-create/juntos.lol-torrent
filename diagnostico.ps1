# Junta o que e preciso para entender um problema num arquivo so, na Area de
# Trabalho, e abre no Bloco de Notas. Nao muda nada: so le.
#
# Segredos (o WORKER_ENROLLMENT_SECRET e qualquer token/chave nos logs) saem
# mascarados, entao o arquivo pode ser mandado para quem for ajudar.

$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot

$mesa = [Environment]::GetFolderPath('Desktop')
if (-not $mesa) { $mesa = $PSScriptRoot }
$saida = Join-Path $mesa 'diagnostico-juntos.txt'
$linhas = New-Object System.Collections.Generic.List[string]

function Secao($titulo) { $linhas.Add(''); $linhas.Add("===== $titulo ====="); Write-Host "  [..] $titulo" -ForegroundColor Gray }
function Mascarar($texto) {
    $t = "$texto"
    $t = $t -replace '(?i)((secret|token|password|senha|key|ticket|sig)[^=:\s]*\s*[=:]\s*)("?)[^\s",&]{6,}', '$1$3***'
    $t = $t -replace '(?i)(bearer\s+)[^\s"]+', '$1***'
    return $t
}
function Rodar($titulo, [scriptblock]$bloco) {
    Secao $titulo
    try {
        $r = @(& $bloco 2>&1 | ForEach-Object { Mascarar $_ })
        if ($r.Count -eq 0) { $linhas.Add('(nada)') } else { $linhas.AddRange([string[]]$r) }
    } catch {
        $linhas.Add("erro: $($_.Exception.Message)")
    }
}

Write-Host ''
Write-Host '  juntos.lol - diagnostico' -ForegroundColor White
Write-Host ''

$linhas.Add("diagnostico do juntos.lol - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
$versao = 'desconhecida'
if (Test-Path -LiteralPath '.git') { $v = @(& git rev-parse --short HEAD 2>$null); if ($v.Count) { $versao = "$($v[0])" } }
elseif (Test-Path -LiteralPath '.versao') { $versao = (Get-Content -LiteralPath '.versao' -TotalCount 1) }
$linhas.Add("versao: $versao")
$linhas.Add("windows: $([Environment]::OSVersion.VersionString)")

Rodar 'Docker' { docker version --format 'cliente {{.Client.Version}} / motor {{.Server.Version}}' }
Rodar 'Containers' { docker compose --env-file .env.local ps -a }
Rodar 'Configuracao (.env.local, sem segredos)' {
    if (Test-Path -LiteralPath '.env.local') {
        Get-Content -LiteralPath '.env.local' | Where-Object { $_ -match '^\s*[A-Z_]+=' } | ForEach-Object {
            if ($_ -match '(?i)secret|token|key|password') { ($_ -split '=', 2)[0] + '=***' } else { $_ }
        }
    } else { 'sem .env.local' }
}
Rodar 'Espaco em disco' { Get-PSDrive -PSProvider FileSystem | ForEach-Object { '{0}: livre {1:N1} GB de {2:N1} GB' -f $_.Name, ($_.Free / 1GB), (($_.Used + $_.Free) / 1GB) } }
Rodar 'DNS de dentro do worker (roteadores de DHT e trackers)' {
    foreach ($h in @('dht.transmissionbt.com', 'router.bittorrent.com', 'router.utorrent.com', 'dht.libtorrent.org', 'tracker.opentrackr.org', 'open.stealth.si')) {
        $r = @(docker compose --env-file .env.local exec -T worker getent hosts $h 2>&1)
        if ($LASTEXITCODE -eq 0 -and $r.Count -gt 0) { "ok     $h -> $(("$($r[0])" -split '\s+')[0])" } else { "FALHOU $h" }
    }
}
Rodar 'DNS configurado no worker' { docker compose --env-file .env.local exec -T worker cat /etc/resolv.conf }
Rodar 'Teste de rede BitTorrent (dentro da rede do worker)' {
    # Os torrents que o site tentou abrir aparecem no log do servidor
    # (infoHash=...); o teste pergunta ao tracker pelos peers deles.
    $hashes = @(docker compose --env-file .env.local logs --no-color --tail 400 app 2>$null |
        Select-String -Pattern 'infoHash=([0-9a-fA-F]{40})' -AllMatches |
        ForEach-Object { $_.Matches } | ForEach-Object { $_.Groups[1].Value.ToLower() } |
        Select-Object -Unique -Last 4)
    $id = @(docker compose --env-file .env.local ps -q worker 2>$null)
    if ($id.Count -eq 0) { 'worker nao esta rodando' }
    else {
        # Um container descartavel na MESMA rede do worker (--network container:):
        # o que ele alcanca e exatamente o que o worker alcanca.
        Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'nettest.py') |
            docker run -i --rm --network "container:$($id[0].Trim())" python:3.12-alpine python - @hashes
    }
}
Rodar 'Conferencia de seeds do site (por tracker)' {
    # O que o servidor conferiu nas ultimas vezes que um titulo foi aberto:
    # quais trackers responderam e quantos torrents tinham seed em cada um.
    $ultimas = @(docker compose --env-file .env.local logs --no-color --tail 2000 app 2>$null |
        Select-String -Pattern 'swarm health' | Select-Object -Last 4)
    if ($ultimas.Count -eq 0) { '(nenhuma conferencia nos logs ainda - abra um titulo antes)' }
    else { $ultimas | ForEach-Object { ("$_" -replace '^app-1\s+\|\s+', '') } }
    # E uma conferencia agora, com os torrents tentados, direto no servidor.
    $tentados = @(docker compose --env-file .env.local logs --no-color --tail 2000 app 2>$null |
        Select-String -Pattern 'infoHash=([0-9a-fA-F]{40})' -AllMatches |
        ForEach-Object { $_.Matches } | ForEach-Object { $_.Groups[1].Value.ToLower() } | Select-Object -Unique -Last 8)
    if ($tentados.Count -gt 0) {
        try {
            $corpo = @{ infoHashes = $tentados; trackers = @() } | ConvertTo-Json
            $r = Invoke-RestMethod -UseBasicParsing -Method Post -Uri 'http://localhost:8099/api/torrents/health' -ContentType 'application/json' -Body $corpo -TimeoutSec 20
            "agora: $($r.answered) de $($r.asked) trackers responderam"
            foreach ($t in @($r.trackers)) {
                if ($t.ok) { "  ok     $($t.tracker)  ($($t.seeded) com seed)" } else { "  FALHOU $($t.tracker)  ($($t.error))" }
            }
            foreach ($p in $r.swarms.PSObject.Properties) { "  $($p.Name.Substring(0, 10))  seeds=$($p.Value.seeders)" }
        } catch { "nao consegui perguntar ao servidor: $($_.Exception.Message)" }
    }
}
Rodar 'Conexoes TCP do worker agora' {
    # Quantas conexoes o worker tem abertas, por estado. Muitas em SYN_SENT
    # (tentando conectar e sem resposta) e poucas ESTABLISHED e o retrato de
    # algo segurando a saida: firewall/antivirus ou o proxy de rede do Docker.
    $estados = @{ '01' = 'ESTABLISHED (conectadas)'; '02' = 'SYN_SENT (tentando, sem resposta)'; '06' = 'TIME_WAIT'; '08' = 'CLOSE_WAIT'; '0A' = 'LISTEN' }
    $raw = @(docker compose --env-file .env.local exec -T worker cat /proc/net/tcp /proc/net/tcp6 2>$null)
    $raw | Where-Object { $_ -match '^\s*\d+:' } | ForEach-Object { ($_.Trim() -split '\s+')[3] } |
        Group-Object | Sort-Object Count -Descending | ForEach-Object {
            $nome = if ($estados.ContainsKey($_.Name)) { $estados[$_.Name] } else { "estado $($_.Name)" }
            '{0,5}  {1}' -f $_.Count, $nome
        }
}
Rodar 'Os mesmos peers, testados direto do Windows (fora do Docker)' {
    $lista = @($linhas | Where-Object { "$_" -like 'PEERLIST *' } | Select-Object -Last 1)
    if ($lista.Count -eq 0) { 'sem lista de peers do teste acima'; return }
    $peers = @(("$($lista[0])" -replace '^PEERLIST\s+', '') -split '\s+' | Where-Object { $_ } | Select-Object -First 16)
    $ok = 0
    foreach ($p in $peers) {
        $i = $p.LastIndexOf(':')
        $c = New-Object Net.Sockets.TcpClient
        try {
            $t = $c.ConnectAsync($p.Substring(0, $i), [int]$p.Substring($i + 1))
            if ($t.Wait(3000) -and $c.Connected) { $ok++ }
        } catch {} finally { $c.Close() }
    }
    $dentro = 0; $dentroDe = 0
    foreach ($l in $linhas) {
        if ("$l" -match 'conectaram por TCP=(\d+) de (\d+)') { $dentro += [int]$Matches[1]; $dentroDe += [int]$Matches[2] }
    }
    "direto do Windows: $ok de $($peers.Count) conectaram"
    "de dentro do Docker (teste acima): $dentro de $dentroDe"
    if ($ok -gt 0 -and $dentro -eq 0) {
        'CONCLUSAO: o Windows alcanca os peers e o Docker nao. O bloqueio esta no Docker Desktop (rede do WSL) ou no antivirus filtrando so o Docker.'
    } elseif ($ok -eq 0 -and $peers.Count -gt 0) {
        'CONCLUSAO: nem o Windows alcanca os peers. O bloqueio esta no Windows/antivirus (Norton: firewall ou Protecao contra Intrusao), no roteador ou no provedor.'
    } else {
        'CONCLUSAO: os dois lados conectam.'
    }
}
Rodar 'Logs do worker (baixador de torrents)' { docker compose --env-file .env.local logs --no-color --tail 300 worker }
Rodar 'Logs do servidor' { docker compose --env-file .env.local logs --no-color --tail 150 app }

try {
    Set-Content -LiteralPath $saida -Value $linhas -Encoding UTF8 -ErrorAction Stop
    Write-Host ''
    Write-Host "  [ok] Salvo em: $saida" -ForegroundColor Green
    Write-Host '       Mande este arquivo (ou cole o conteudo) para quem esta ajudando.' -ForegroundColor DarkGray
    Start-Process notepad.exe -ArgumentList "`"$saida`""
} catch {
    Write-Host "  [x]  Nao consegui salvar: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ''
Read-Host '  Pressione Enter para fechar' | Out-Null
