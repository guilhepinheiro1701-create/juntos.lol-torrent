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

# Os segredos são desta instalação: o MinIO aqui guarda os seus filmes, e uma
# senha padrão em arquivo versionado não é senha.
if [ -f .env.local ]; then
  say "[ok] .env.local já existe, mantendo os segredos que estão nele."
else
  say "[..] Gerando .env.local com segredos novos..."
  secret() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
  cat > .env.local <<ENV
# Escrito pelo setup.sh. Os segredos aqui são desta instalação.
# Apagar este arquivo e rodar o setup de novo gera outros, e o MinIO antigo
# deixa de abrir: guarde-o junto com o resto.
MINIO_ROOT_USER=juntos
MINIO_ROOT_PASSWORD=$(secret)
MINIO_BUCKET=juntos
S3_HOST=juntos-minio
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

# O navegador busca os segmentos em juntos-minio:9000, e a assinatura S3 inclui
# o Host — então o nome precisa resolver igual dentro e fora do container.
if ! grep -q "juntos-minio" /etc/hosts 2>/dev/null; then
  echo
  say "[!] Falta uma linha em /etc/hosts. Sem ela o vídeo não toca."
  say "    Vou pedir sudo para adicionar:  127.0.0.1 juntos-minio"
  echo
  printf '127.0.0.1 juntos-minio\n' | sudo tee -a /etc/hosts >/dev/null
fi
say "[ok] juntos-minio aponta para esta máquina."

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
