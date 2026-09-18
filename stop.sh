#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose -f docker-compose.local.yml --env-file .env.local stop
echo
echo "  Desligado. Nada foi apagado: os filmes baixados, o banco e o bucket"
echo "  continuam onde estavam, e ./start.sh volta com tudo."
echo
