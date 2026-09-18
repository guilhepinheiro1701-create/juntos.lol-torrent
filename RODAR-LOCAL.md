# Rodar o juntos.lol na sua máquina

Tudo em containers. A única coisa que precisa estar instalada é o Docker.

## Windows

1. Instale o [Docker Desktop](https://www.docker.com/products/docker-desktop/), abra uma vez e espere ficar verde.
2. Clique em **`setup.bat`**. Roda uma vez só.
3. Depois disso, **`start.bat`** sempre que quiser assistir. Abre no navegador sozinho.
4. **`stop.bat`** para desligar.

Fechar a janela do `start.bat` não desliga nada: os containers ficam rodando em segundo plano. É o `stop.bat` que desliga.

## Linux e macOS

```sh
./setup.sh     # uma vez
./start.sh     # sempre que quiser assistir
./stop.sh      # desligar
```

## O que o setup faz

- **Confere o Docker.** Se faltar, abre a página oficial e para. Não baixa nem roda instalador por você: isso é software com privilégio de administrador, e quem decide instalar é você.
- **Gera `.env.local`** com uma senha do MinIO e um segredo de inscrição do worker, ambos aleatórios. São desta instalação. Se apagar o arquivo e rodar o setup de novo, os segredos mudam e o MinIO antigo deixa de abrir — guarde-o junto com o resto.
- **Adiciona `127.0.0.1 juntos-minio`** ao arquivo hosts, pedindo administrador. Isso é necessário porque a assinatura S3 inclui o `Host`: o nome precisa resolver igual dentro do container e no navegador, senão o `PUT` dos segmentos dá 403 e o vídeo não toca.
- **Monta as imagens.** A primeira vez demora bastante — compila o servidor em Go, o worker em Rust e o site. Depois é cache.

## O que sobe

| | |
|---|---|
| `app` | o servidor e o site, em `127.0.0.1:8099` |
| `worker` | os torrents, em `127.0.0.1:8081` e a porta 4240 para os peers |
| `minio` | os segmentos HLS, em `127.0.0.1:9000` (console em `:9001`) |
| `redis` | as salas |

Tudo publica em `127.0.0.1` de propósito. **Não exponha isto na internet:** não há TLS, e o worker roda em HTTP puro.

A porta **4240** (TCP e UDP) é a única que o roteador precisa deixar entrar, e só para o torrent achar peers. Sem ela o download fica lento ou não anda.

## Escolher em que disco os filmes ficam

Por padrão tudo vai para um volume do Docker. Para usar discos seus, duas edições:

**1. Monte os caminhos** no `docker-compose.local.yml`, no serviço `worker`:

```yaml
    volumes:
      - juntos-worker:/var/lib/ss-worker
      - /mnt/ssd/juntos:/discos/ssd      # Linux/macOS
      - /mnt/hdd/juntos:/discos/hdd
      # No Windows: - D:\juntos:/discos/hdd
```

**2. Nomeie-os** no `.env.local`:

```
WORKER_STORAGE_DIRS=SSD=/discos/ssd,HDD=/discos/hdd
```

Os caminhos são sempre os de **dentro** do container. Com dois ou mais, a aba **Baixados** passa a mostrar a escolha, com o espaço livre de cada um. Com um só, não mostra nada — escolha entre uma coisa não é escolha.

O rótulo é o que a página manda; o caminho nunca sai do worker. Um rótulo que a instalação não declarou é recusado.

## Os dois modos de assistir

**Assistir** — aperta o play, escolhe a fonte, e o worker baixa numa janela que acompanha onde você está. Não ocupa o filme inteiro no disco, e o espaço volta depois.

**Baixar** — o botão na sala. O arquivo fica no disco de verdade: sobrevive a reiniciar o worker, e a aba **Baixados** reabre sem internet. Devolver o espaço é um clique na mesma tela.

Sem internet, a aba do catálogo diz isso e leva para os Baixados. O catálogo precisa de um serviço de metadados e dos addons; o que já está no disco não precisa de nenhum dos dois.

## Quando algo não vai

```sh
# o que cada container está dizendo
docker compose -f docker-compose.local.yml logs -f app
docker compose -f docker-compose.local.yml logs -f worker

# o estado de todos
docker compose -f docker-compose.local.yml ps
```

**O vídeo não toca e o console mostra 403 no `PUT`.** É o `juntos-minio` não resolvendo. Confira a linha no arquivo hosts.

**"no workers".** O worker não entrou na frota. Quase sempre é o `WORKER_ENROLLMENT_SECRET` diferente entre o `app` e o `worker` — acontece se o `.env.local` foi editado à mão. Veja `logs -f worker`.

**O download não anda.** Porta 4240 fechada no roteador, ou o torrent não tem seeds. A aba **Status** mostra os peers que o worker achou.

## Apagar tudo

```sh
docker compose -f docker-compose.local.yml down -v
```

O `-v` leva os volumes junto: filmes baixados, salas e bucket. Sem ele, só os containers somem.
