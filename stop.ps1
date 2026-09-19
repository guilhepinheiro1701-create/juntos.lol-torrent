# Desliga o juntos.lol, sem apagar nada.

$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot

Write-Host ''
Write-Host '  Desligando o juntos.lol...' -ForegroundColor Gray
Write-Host ''

& docker compose -f docker-compose.local.yml --env-file .env.local stop

Write-Host ''
Write-Host '  Desligado.' -ForegroundColor Green
Write-Host '       Nada foi apagado: os filmes baixados, as salas e os videos ja' -ForegroundColor DarkGray
Write-Host '       preparados continuam onde estavam. start.bat volta com tudo.' -ForegroundColor DarkGray
Write-Host ''
Start-Sleep -Seconds 5
