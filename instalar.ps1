# Instalador de uma linha do juntos.lol.
#
# Uso (no PowerShell, nao precisa ser administrador):
#
#   irm https://raw.githubusercontent.com/guilhepinheiro1701-create/juntos.lol-torrent/local/instalar.ps1 | iex
#
# O que ele faz, nesta ordem, e nada alem disso:
#   1. baixa o projeto para %USERPROFILE%\juntos.lol (com git, se houver; senao
#      o .zip do GitHub);
#   2. roda o setup.ps1 de sempre (confere o Docker, gera o segredo, monta);
#   3. cria tres atalhos na Area de Trabalho: abrir, atualizar e desligar.
#
# Ja instalado? Rodar de novo so atualiza (chama o atualizar.ps1 da pasta).
# Outra pasta: defina $env:JUNTOS_PASTA antes de rodar.
#
# Sem bloco param() de proposito: o script chega por `irm | iex`, e o iex
# executa o texto como comandos soltos.

$ErrorActionPreference = 'Continue'
$Repo  = 'guilhepinheiro1701-create/juntos.lol-torrent'
$Ramo  = 'local'
$Pasta = if ($env:JUNTOS_PASTA) { $env:JUNTOS_PASTA } else { Join-Path $env:USERPROFILE 'juntos.lol' }

# O Windows PowerShell 5.1 ainda nasce oferecendo TLS 1.0; o GitHub exige 1.2.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

function Titulo($t) { Write-Host "`n  $t" -ForegroundColor Cyan }
function Ok($t)     { Write-Host "  [ok] $t" -ForegroundColor Green }
function Passo($t)  { Write-Host "  [..] $t" -ForegroundColor Gray }
function Erro($t)   { Write-Host "  [x]  $t" -ForegroundColor Red }
function Nota($t)   { Write-Host "       $t" -ForegroundColor DarkGray }

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

Write-Host ''
Write-Host '  juntos.lol - instalacao' -ForegroundColor White
Write-Host '  =======================' -ForegroundColor DarkGray
Nota "Pasta: $Pasta"

if (Test-Path -LiteralPath (Join-Path $Pasta 'setup.ps1')) {
    # Chamado por powershell -File, nunca por `&`: o `irm | iex` passa por
    # cima da politica de execucao so para este texto, nao para os .ps1 da
    # pasta, e num Windows com a politica padrao o `&` seria recusado.
    if (Test-Path -LiteralPath (Join-Path $Pasta '.env.local')) {
        Ok 'Ja esta instalado aqui. Vou so atualizar.'
        & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Pasta 'atualizar.ps1')
    } else {
        # Baixou numa vez anterior, mas o setup nao terminou (o caso comum:
        # o Docker ainda nao estava instalado). Continua dali.
        Ok 'Ja foi baixado, mas o setup nao terminou. Continuando por ele.'
        & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Pasta 'setup.ps1')
    }
    return
}

# ------------------------------------------------------------------ baixar --
Titulo '1 de 3  Baixando o juntos.lol'
$git = Get-Command git -ErrorAction SilentlyContinue
$baixou = $false
if ($git) {
    Passo 'Usando o git (assim o atualizar baixa so o que mudou)...'
    & git clone --depth 1 --branch $Ramo "https://github.com/$Repo.git" $Pasta
    $baixou = ($LASTEXITCODE -eq 0)
    if (-not $baixou) { Nota 'O git falhou; tentando pelo .zip.' }
}
if (-not $baixou) {
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("juntos-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
        Passo 'Baixando o .zip do GitHub...'
        $zip = Join-Path $tmp 'juntos.zip'
        Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$Repo/archive/refs/heads/$Ramo.zip" -OutFile $zip -ErrorAction Stop
        Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force -ErrorAction Stop
        $dentro = Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1
        New-Item -ItemType Directory -Path $Pasta -Force | Out-Null
        Copy-Item -Path (Join-Path $dentro.FullName '*') -Destination $Pasta -Recurse -Force -ErrorAction Stop
        # Sem git nao ha como perguntar a versao a pasta; ela fica anotada aqui.
        $sha = ShaDoZip $zip
        if (-not $sha) {
            try { $sha = (Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repo/commits/$Ramo" -ErrorAction Stop).sha } catch {}
        }
        if ($sha) { Set-Content -LiteralPath (Join-Path $Pasta '.versao') -Value $sha -Encoding ASCII }
        $baixou = $true
    } catch {
        Erro "Nao consegui baixar: $($_.Exception.Message)"
        Nota 'Confira a internet e rode o comando de novo.'
    } finally {
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}
if (-not $baixou) { return }
Ok 'Baixado.'

# ----------------------------------------------------------------- atalhos --
Titulo '2 de 3  Atalhos na Area de Trabalho'
try {
    $shell = New-Object -ComObject WScript.Shell
    $mesa = [Environment]::GetFolderPath('Desktop')
    foreach ($a in @(
        @{ Nome = 'juntos.lol';            Alvo = 'start.bat';     Dica = 'Liga o juntos.lol e abre o site' },
        @{ Nome = 'Atualizar juntos.lol';  Alvo = 'atualizar.bat'; Dica = 'Baixa a versao nova e reinicia' },
        @{ Nome = 'Desligar juntos.lol';   Alvo = 'stop.bat';      Dica = 'Desliga o juntos.lol' }
    )) {
        $lnk = $shell.CreateShortcut((Join-Path $mesa "$($a.Nome).lnk"))
        $lnk.TargetPath = Join-Path $Pasta $a.Alvo
        $lnk.WorkingDirectory = $Pasta
        $lnk.Description = $a.Dica
        $lnk.Save()
    }
    Ok 'Atalhos criados: "juntos.lol", "Atualizar juntos.lol" e "Desligar juntos.lol".'
} catch {
    Nota "Nao deu para criar os atalhos ($($_.Exception.Message)). Use os .bat da pasta."
}

# ------------------------------------------------------------------- setup --
Titulo '3 de 3  Preparando (setup)'
Nota 'Abre o assistente de sempre. Na primeira vez a montagem demora.'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Pasta 'setup.ps1')
if ($LASTEXITCODE -ne 0) {
    Erro 'O setup nao terminou. Resolva o que ele disse e rode setup.bat na pasta.'
    Nota $Pasta
    return
}

Write-Host ''
$abrir = Read-Host '  Abrir o juntos.lol agora? (S/n)'
if ($abrir -notmatch '^[nN]') {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Pasta 'start.ps1')
}
