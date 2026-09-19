#!/usr/bin/env bash
# Escolhe em que pasta os filmes ficam. Veja pasta.ps1 para o porquê de isto
# ser um script e não um botão no site: o baixador roda num container, e um
# container só enxerga as pastas montadas nele.
set -euo pipefail
cd "$(dirname "$0")"

DENTRO=/discos/filmes
ROTULO="Meus filmes"

[ -f .env.local ] || { echo "  [x] Falta o .env.local. Rode ./setup.sh primeiro."; exit 1; }

atual=""
if [ -f docker-compose.override.yml ]; then
  atual=$(sed -n "s#^[[:space:]]*-[[:space:]]*\"\(.*\):$DENTRO\"#\1#p" docker-compose.override.yml | head -n1)
fi

echo
echo "  Onde guardar os filmes"
echo
[ -n "$atual" ] && echo "  Hoje os filmes vão para: $atual" && echo

padrao="$HOME/Vídeos/juntos.lol"
[ -d "$HOME/Videos" ] && padrao="$HOME/Videos/juntos.lol"

if [ -n "$atual" ]; then
  echo "  Enter sem digitar nada mantém a pasta de hoje."
else
  echo "  Enter sem digitar nada usa: $padrao"
fi
echo
read -r -p "  Pasta: " escolha
escolha=${escolha:-${atual:-$padrao}}

case "$escolha" in
  /*) ;;
  *) echo "  [x] Preciso do caminho completo, começando por /."; exit 1 ;;
esac

mkdir -p "$escolha" || { echo "  [x] Não consegui criar $escolha"; exit 1; }
# Escrever agora, e não descobrir na primeira gravação que a pasta é só leitura.
touch "$escolha/.juntos-teste" 2>/dev/null || { echo "  [x] Não consigo escrever em $escolha"; exit 1; }
rm -f "$escolha/.juntos-teste"

cat > docker-compose.override.yml <<YAML
# Escrito por pasta.sh. Não edite à mão: rode ./pasta.sh de novo.
#
# O docker lê este arquivo junto com o docker-compose.yml, sozinho. Ele só
# acrescenta a pasta escolhida ao baixador; o resto vem do outro.
services:
  worker:
    volumes:
      - juntos-worker:/var/lib/ss-worker
      - "$escolha:$DENTRO"
YAML

if grep -q '^WORKER_STORAGE_DIRS=' .env.local; then
  # Um endereço com barras dentro do valor: | como separador do sed.
  sed -i.bak "s|^WORKER_STORAGE_DIRS=.*|WORKER_STORAGE_DIRS=$ROTULO=$DENTRO|" .env.local && rm -f .env.local.bak
else
  printf 'WORKER_STORAGE_DIRS=%s=%s\n' "$ROTULO" "$DENTRO" >> .env.local
fi

echo
echo "  [ok] Os filmes vão para $escolha"
echo
echo "       Vale a partir da próxima vez que o site subir."
echo "       Se ele já estiver de pé: ./stop.sh e depois ./start.sh"
echo
echo "       O que já foi baixado antes fica onde estava; nada é movido."
