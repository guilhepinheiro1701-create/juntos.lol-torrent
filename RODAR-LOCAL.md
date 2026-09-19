# Rodar o juntos.lol na sua máquina

## O mínimo que você precisa saber

O juntos.lol é feito de quatro programas que conversam entre si: o site, o
servidor, o baixador de torrents e um lugar para guardar o vídeo já preparado.
Instalar isso na mão significaria instalar Go, Rust, Node, FFmpeg e um banco
de dados, um por um, na versão certa.

O **Docker** existe para evitar exatamente isso. Ele roda cada programa dentro
de uma caixa que já vem com tudo de que aquele programa precisa. Então a única
coisa que você instala é o Docker; o resto vem pronto.

## Windows

**1. Instale o Docker Desktop.**
Baixe em <https://www.docker.com/products/docker-desktop/> e instale.

- Se ele pedir para instalar o **WSL 2**, aceite. É um componente do próprio
  Windows que o Docker usa para rodar Linux por baixo.
- Ele pede para reiniciar o computador no fim. Reinicie.
- Depois de reiniciar, **abra o Docker Desktop uma vez** e espere. O ícone da
  baleia na barra de tarefas para de se mexer, e o painel passa a dizer
  *Engine running*. Isso pode levar um ou dois minutos na primeira vez.

**2. Clique em `setup.bat`.** Roda uma vez só, e mostra quatro passos:

1. confere o Docker;
2. gera as senhas desta instalação, num arquivo `.env.local`;
3. acrescenta uma linha ao arquivo `hosts` do Windows (pede administrador,
   e explica o porquê antes);
4. monta os programas.

O passo 4 é o demorado: **de 15 a 40 minutos na primeira vez**, porque ele
compila tudo do zero. Vai passar muito texto na tela — isso é normal, não é
erro. Nas próximas vezes é quase instantâneo, porque fica guardado.

**3. Clique em `start.bat`** sempre que quiser assistir. Ele sobe tudo, espera
o servidor responder e abre o navegador sozinho em `http://localhost:8099`.

**4. `stop.bat`** para desligar. Fechar a janela do `start` **não** desliga:
as caixas continuam rodando em segundo plano de propósito, para o site seguir
disponível.

> Os `.bat` são só atalhos de três linhas. A lógica está nos `.ps1` ao lado,
> que você pode abrir e ler.

## Linux e macOS

```sh
./setup.sh     # uma vez
./start.sh     # sempre que quiser assistir
./stop.sh      # desligar
```

## Por que o setup pede administrador

Uma vez só, para acrescentar **uma linha** ao arquivo `hosts`:

```
127.0.0.1 juntos-minio
```

O navegador busca os pedaços do vídeo no endereço `juntos-minio`, e esse nome
precisa significar a mesma coisa dentro da caixa do Docker e aqui fora. O
motivo é que a assinatura de segurança do armazenamento inclui o endereço: se
não bater dos dois lados, o envio é recusado e o vídeo não toca.

Se preferir fazer à mão, o setup mostra o passo a passo com o Bloco de Notas.

## O que o setup NÃO faz

Ele não baixa nem instala o Docker por você. Um instalador pede permissão de
administrador sobre a máquina inteira, e essa decisão é sua, na página do
fabricante. O setup abre a página e para.

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

**1. Monte os caminhos** no `docker-compose.yml`, no serviço `worker`:

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
docker compose logs -f app
docker compose logs -f worker

# o estado de todos
docker compose ps
```

**O vídeo não toca e o console mostra 403 no `PUT`.** É o `juntos-minio` não resolvendo. Confira a linha no arquivo hosts.

**"no workers".** O worker não entrou na frota. Quase sempre é o `WORKER_ENROLLMENT_SECRET` diferente entre o `app` e o `worker` — acontece se o `.env.local` foi editado à mão. Veja `logs -f worker`.

**O download não anda.** Porta 4240 fechada no roteador, ou o torrent não tem seeds. A aba **Status** mostra os peers que o worker achou.

## Apagar tudo

```sh
docker compose down -v
```

O `-v` leva os volumes junto: filmes baixados, salas e bucket. Sem ele, só os containers somem.
