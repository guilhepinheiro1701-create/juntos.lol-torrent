#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env.local ] || { echo "  [x] Falta o .env.local. Rode ./setup.sh primeiro."; exit 1; }

compose() { docker compose --env-file .env.local "$@"; }

# Quando algo dá errado, mostrar o que o servidor disse aqui mesmo, em vez de
# mandar quem rodou o script digitar outra coisa.
mostrar_log() {
  echo
  echo "  Últimas linhas do app:"
  echo
  compose logs --tail 40 app 2>&1 | sed 's/^/    /'
}

# `up` sozinho reaproveita a imagem que já existe: depois de um `git pull` isso
# sobe o programa velho com as configurações novas, e ele morre no boot. Com o
# cache do Docker, quando nada mudou o --build leva segundos.
#
# --remove-orphans limpa o que uma versão anterior deixou de pé e esta pilha
# não usa mais: o MinIO e o criador do bucket saíram quando os segmentos
# passaram a morar numa pasta do próprio servidor.
echo
echo "  Conferindo se algo mudou e subindo..."
echo
compose up -d --build --remove-orphans

# `up -d` devolve sucesso assim que manda subir, mesmo que o servidor morra um
# segundo depois. "Está de pé" e "respondeu" são duas perguntas.
app_caiu() {
  local id estado
  id=$(compose ps -q app 2>/dev/null | head -n1 || true)
  [ -n "$id" ] || return 0
  estado=$(docker inspect --format '{{.State.Status}} {{.RestartCount}}' "$id" 2>/dev/null) || return 1
  case "$estado" in
    exited*|dead*) return 0 ;;
  esac
  # Reiniciou pelo menos uma vez: está em looping, e esperar mais não muda.
  # Escrito como `if`, e não `[ ... ] && return`: com `set -e`, uma lista com
  # && que termina em falso derruba a função inteira.
  if [ "${estado##* }" != "0" ]; then return 0; fi
  return 1
}

echo "  Esperando o servidor responder..."
for tentativa in $(seq 40); do
  if curl -fsS -m 3 http://localhost:8099/healthz >/dev/null 2>&1; then
    command -v xdg-open >/dev/null 2>&1 && xdg-open http://localhost:8099 >/dev/null 2>&1 || true
    command -v open >/dev/null 2>&1 && open http://localhost:8099 >/dev/null 2>&1 || true
    echo
    echo "  Aberto em http://localhost:8099"
    # O endereço que serve nos outros aparelhos da casa.
    ips=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' || true)
    if [ -n "$ips" ]; then
      echo
      echo "  Na TV ou noutro computador da casa, abra:"
      for ip in $ips; do echo "    http://$ip:8099"; done
      echo "  Funciona só dentro da sua rede. Não abra essa porta no roteador."
    fi
    echo "  Para desligar: ./stop.sh"
    echo
    exit 0
  fi
  # As duas primeiras voltas não acusam nada: o container acabou de ser mandado
  # subir e pode ainda não aparecer.
  if [ "$tentativa" -gt 2 ] && app_caiu; then
    echo
    echo "  [x] O servidor subiu e morreu em seguida."
    mostrar_log
    echo
    echo "      A última linha costuma dizer o que faltou."
    exit 1
  fi
  sleep 2
done

echo
echo "  [x] O servidor demorou demais para responder, mas continua de pé."
mostrar_log
echo
exit 1
