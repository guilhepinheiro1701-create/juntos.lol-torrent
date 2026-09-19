#!/usr/bin/env bash
# juntos.lol, na sua máquina. Linux e macOS; no Windows use setup.bat.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '  %s\n' "$*"; }

echo
say "juntos.lol, na sua máquina"
say "=========================="
echo

if ! command -v docker >/dev/null 2>&1; then
  say "[x] Docker não está instalado."
  say "    https://docs.docker.com/engine/install/"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  say "[x] Docker está instalado mas não responde. Ele está rodando?"
  say "    No Linux pode faltar o seu usuário no grupo docker:"
  say "      sudo usermod -aG docker \$USER   (e entre na sessão de novo)"
  exit 1
fi
say "[ok] Docker encontrado e rodando."

# O segredo é desta instalação: ele é o que deixa o worker entrar na frota, e
# um segredo padrão em arquivo versionado não é segredo.
if [ -f .env.local ]; then
  say "[ok] .env.local já existe, mantendo o que está nele."
else
  say "[..] Gerando .env.local com segredos novos..."
  secret() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
  cat > .env.local <<ENV
# Escrito pelo setup.sh. O segredo aqui é desta instalação.
# Apagar este arquivo e rodar o setup de novo gera outro, e é só isso: nada do
# que já foi baixado se perde.
WORKER_ENROLLMENT_SECRET=$(secret)

# Quanto disco o worker pode usar para os torrents, em GB.
WORKER_DISK_QUOTA_GB=35

# Mais de um disco? Liste como rótulo=caminho, separados por vírgula:
#   WORKER_STORAGE_DIRS=SSD=/discos/ssd,HDD=/discos/hdd
# Os caminhos são de dentro do container, então monte-os antes em
# docker-compose.yml, no bloco \`volumes\` do serviço \`worker\`.
# Com dois ou mais, a aba Baixados mostra a escolha.
WORKER_STORAGE_DIRS=
ENV
  chmod 600 .env.local
  say "[ok] .env.local criado."
fi

echo
say "[..] Montando as imagens. A primeira vez demora bastante: compila o"
say "     servidor em Go, o worker em Rust e o site."
echo
docker compose --env-file .env.local build

echo
say "=========================================================="
say "  Pronto. Daqui em diante é só rodar ./start.sh"
say "=========================================================="
echo
