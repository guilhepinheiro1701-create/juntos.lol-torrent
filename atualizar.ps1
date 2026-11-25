# Atualiza o juntos.lol: baixa a versao nova do GitHub e reinicia.
#
# Nada do que e seu e tocado: o .env.local (segredo e configuracoes), o
# docker-compose.override.yml (a pasta dos filmes, do pasta.bat) e os filmes
# baixados ficam como estao. So o codigo do programa muda.

$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot
$Repo = 'guilhepinheiro1701-create/juntos.lol-torrent'
$Ramo = 'local'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

function Titulo($t) { Write-Host "`n  $t" -ForegroundColor Cyan }
function Ok($t)     { Write-Host "  [ok] $t" -ForegroundColor Green }
function Passo($t)  { Write-Host "  [..] $t" -ForegroundColor Gray }
function Aviso($t)  { Write-Host "  [!]  $t" -ForegroundColor Yellow }
function Erro($t)   { Write-Host "  [x]  $t" -ForegroundColor Red }
function Nota($t)   { Write-Host "       $t" -ForegroundColor DarkGray }
function Fim($codigo) {
    Write-Host ''
    Read-Host '  Pressione Enter para fechar' | Out-Null
    exit $codigo
}

Write-Host ''
Write-Host '  juntos.lol - atualizar' -ForegroundColor White
Write-Host '  ======================' -ForegroundColor DarkGray

# O commit de um .zip do GitHub: ele vem como comentario, nos ultimos 40
# bytes do arquivo. Vazio se nao estiver la.
function ShaDoZip($caminho) {
    try {
        $fs = [IO.File]::OpenRead($caminho)
        try {
            $n = [Math]::Min(64, $fs.Length)
            $null = $fs.Seek(-$n, 'End')
            $buf = New-Object byte[] $n
            $null = $fs.Read($buf, 0, $n)
        } finally { $fs.Close() }
        $fim = [Text.Encoding]::ASCII.GetString($buf)
        if ($fim -match '([0-9a-f]{40})$') { return $Matches[1] }
    } catch {}
    return ''
}

$temGit = (Test-Path -LiteralPath '.git') -and (Get-Command git -ErrorAction SilentlyContinue)

function VersaoAtual {
    if ($temGit) {
        $sha = @(& git rev-parse HEAD 2>$null)
        if ($LASTEXITCODE -eq 0 -and $sha.Count -gt 0) { return "$($sha[0])".Trim() }
    }
    if (Test-Path -LiteralPath '.versao') { return (Get-Content -LiteralPath '.versao' -TotalCount 1).Trim() }
    return ''
}

# ------------------------------------------------------- tem algo novo? ---
Titulo '1 de 3  Procurando versao nova'
$atual = VersaoAtual
$nova = ''
try {
    $nova = (Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repo/commits/$Ramo" -ErrorAction Stop).sha
} catch {
    Aviso 'Nao consegui perguntar ao GitHub qual e a versao nova. Vou tentar baixar mesmo assim.'
}
if ($nova -and $atual -and $nova -eq $atual) {
    Ok "Voce ja esta na versao mais nova ($($atual.Substring(0, 7)))."
    Fim 0
}
if ($nova -and $atual) {
    # A lista do que mudou, pelas mensagens dos commits: o que a pessoa ganha
    # ao atualizar, em vez de um "atualizado" mudo.
    try {
        $cmp = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repo/compare/$atual...$nova" -ErrorAction Stop
        if ($cmp.commits) {
            Write-Host ''
            Write-Host '  O que mudou:' -ForegroundColor White
            foreach ($c in $cmp.commits) {
                $linha = ("$($c.commit.message)" -split "`n")[0]
                Write-Host "   - $linha" -ForegroundColor Gray
            }
        }
    } catch {}
}

# ----------------------------------------------------------------- baixar --
Titulo '2 de 3  Baixando'
if ($temGit) {
    # Sem --depth: numa copia rasa (o instalador clona com --depth 1), o git
    # busca o que falta ate ligar a versao nova a que esta aqui, por mais
    # atras que ela esteja.
    & git fetch origin $Ramo
    if ($LASTEXITCODE -ne 0) { Erro 'O git nao conseguiu baixar. Confira a internet.'; Fim 1 }
    & git merge --ff-only FETCH_HEAD
    if ($LASTEXITCODE -ne 0) {
        Erro 'Arquivos do programa foram mudados nesta pasta, e a versao nova mexe neles.'
        Nota 'Estes sao os arquivos mudados:'
        & git status --short
        Nota 'Se nao foi voce que mudou de proposito, descarte e tente de novo:'
        Nota '  git checkout -- .'
        Nota '(o .env.local e a pasta dos filmes nao entram nisso.)'
        Fim 1
    }
} else {
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("juntos-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
        Passo 'Baixando o .zip da versao nova...'
        $zip = Join-Path $tmp 'juntos.zip'
        Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$Repo/archive/refs/heads/$Ramo.zip" -OutFile $zip -ErrorAction Stop
        Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force -ErrorAction Stop
        $dentro = Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1
        # O .zip nunca traz .env.local nem o override (estao no .gitignore),
        # entao copiar por cima nao tem como apaga-los.
        Copy-Item -Path (Join-Path $dentro.FullName '*') -Destination $PSScriptRoot -Recurse -Force -ErrorAction Stop
        # O .zip do GitHub traz o commit no comentario do fim do arquivo: vale
        # quando a API do GitHub limitou a consulta (60 por hora sem login).
        if (-not $nova) { $nova = ShaDoZip $zip }
        if ($nova) { Set-Content -LiteralPath '.versao' -Value $nova -Encoding ASCII }
    } catch {
        Erro "Nao consegui baixar: $($_.Exception.Message)"
        Fim 1
    } finally {
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Ok 'Codigo atualizado.'

# ---------------------------------------------------------------- reiniciar --
Titulo '3 de 3  Reconstruindo e ligando'
Nota 'O start recompila so o que mudou e abre o site. Pode levar uns minutos.'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start.ps1')
