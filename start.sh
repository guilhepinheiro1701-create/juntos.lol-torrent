#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env.local ] || { echo "  [x] Falta o .env.local. Rode ./setup.sh primeiro."; exit 1; }

echo
echo "  Subindo o juntos.lol..."
echo
docker compose --env-file .env.local up -d

# Abrir o navegador antes de o servidor responder mostra um erro que assusta
# sem motivo.
echo "  Esperando o servidor responder..."
for _ in $(seq 30); do
  if curl -fsS -m 2 http://localhost:8099/healthz >/dev/null 2>&1; then
    command -v xdg-open >/dev/null 2>&1 && xdg-open http://localhost:8099 >/dev/null 2>&1 || true
    command -v open >/dev/null 2>&1 && open http://localhost:8099 >/dev/null 2>&1 || true
    echo
    echo "  Aberto em http://localhost:8099"
    echo "  Para desligar: ./stop.sh"
    echo
    exit 0
  fi
  sleep 2
done

echo
echo "  [!] O servidor ainda não respondeu. Os containers estão de pé, então"
echo "      provavelmente é só demora. Veja com:"
echo "        docker compose logs -f app"
echo
exit 1
