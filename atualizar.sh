#!/usr/bin/env sh
# Atualiza o juntos.lol (Linux/macOS): baixa a versao nova e reinicia.
# O .env.local, a pasta dos filmes e o que ja foi baixado nao sao tocados.
set -e
cd "$(dirname "$0")"
if [ ! -d .git ]; then
  echo "Esta pasta nao veio do git. Baixe de novo com:"
  echo "  git clone -b local https://github.com/guilhepinheiro1701-create/juntos.lol-torrent.git"
  exit 1
fi
antes="$(git rev-parse HEAD)"
git fetch origin local
git merge --ff-only FETCH_HEAD || {
  echo "Arquivos do programa foram mudados aqui. Veja com: git status"
  exit 1
}
depois="$(git rev-parse HEAD)"
if [ "$antes" = "$depois" ]; then
  echo "Ja esta na versao mais nova."
  exit 0
fi
echo "O que mudou:"
git log --format='  - %s' "$antes..$depois"
exec ./start.sh
