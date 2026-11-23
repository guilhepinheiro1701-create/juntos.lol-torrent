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
