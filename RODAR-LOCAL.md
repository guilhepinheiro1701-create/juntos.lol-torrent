# Rodar o juntos.lol na sua máquina

## O mínimo que você precisa saber

O juntos.lol é feito de três programas que conversam entre si: o site e o
servidor (que são um só), o baixador de torrents e um banco de dados pequeno.
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

**2. Clique em `setup.bat`.** Roda uma vez só, e mostra três passos:

1. confere o Docker;
2. gera o segredo desta instalação, num arquivo `.env.local`;
3. monta os programas.

Ele **não** pede administrador, e não mexe em nada fora desta pasta.

O passo 3 é o demorado: **de 15 a 40 minutos na primeira vez**, porque ele
compila tudo do zero. Vai passar muito texto na tela — isso é normal, não é
erro. Nas próximas vezes é quase instantâneo, porque fica guardado.

**3. Clique em `start.bat`** sempre que quiser assistir. Ele sobe tudo, espera
o servidor responder e abre o navegador sozinho em `http://localhost:8099`.

Ele também reconstrói o que mudou, então depois de um `git pull` é só clicar
nele: normalmente leva segundos, e só demora quando o código realmente mudou.
Se algo morrer no caminho, ele mostra as últimas linhas do servidor ali mesmo,
em vez de mandar você procurá-las.

**4. `pasta.bat`** escolhe em que pasta do seu computador os filmes ficam.
Opcional: sem ele, tudo vai para um volume do Docker.

**5. `stop.bat`** para desligar. Fechar a janela do `start` **não** desliga:
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

## Onde ficam os pedaços do vídeo

Numa pasta dentro do Docker, e o próprio servidor do site os entrega, no mesmo
endereço da página.

A versão de nuvem usa um bucket da Cloudflare, porque lá quem escreve e quem lê
são máquinas diferentes. Aqui é um computador só, então o bucket não serviria
para nada e custava caro: um segundo servidor para subir, uma senha para
guardar, um nome de endereço que tinha de significar a mesma coisa dentro e
fora do container — e era por isso que o setup antigo pedia administrador para
mexer no arquivo `hosts` do Windows. Nada disso existe mais.

> Se você rodou uma versão anterior, a linha `127.0.0.1 juntos-minio` ficou no
> seu arquivo `hosts`. Ela não atrapalha nada; pode deixar ou tirar.

## O que o setup NÃO faz

Ele não baixa nem instala o Docker por você. Um instalador pede permissão de
administrador sobre a máquina inteira, e essa decisão é sua, na página do
fabricante. O setup abre a página e para.

## O que sobe

| | |
|---|---|
| `app` | o servidor, o site e os segmentos do vídeo, em `127.0.0.1:8099` |
| `worker` | os torrents, em `127.0.0.1:8081` e a porta 4240 para os peers |
| `redis` | as salas |

Tudo publica em `127.0.0.1` de propósito. **Não exponha isto na internet:** não há TLS, e o worker roda em HTTP puro.

A porta **4240** (TCP e UDP) é a única que o roteador precisa deixar entrar, e só para o torrent achar peers. **Abra à mão no roteador:** de dentro de um container, o pedido automático (UPnP) fala com o Docker, não com o seu roteador, então não adianta.

## Assistir de outro computador, ou na TV

Deixe este micro ligado com o Docker rodando e abra o site de qualquer aparelho
da casa. O `start.bat` imprime o endereço no fim:

```
Na TV ou noutro computador da casa, abra:
   http://192.168.0.10:8099
```

Não há nada a configurar. Os pedaços do vídeo passam por este mesmo servidor,
então o segundo aparelho não precisa alcançar o baixador — só a porta 8099.

O plugin de fontes **vem junto com o site**, então o navegador da TV acha
filmes na primeira vez que abre, sem instalar nada.

> **Isto só vale dentro da sua rede.** Qualquer um conectado no seu Wi-Fi pode
> abrir o site — não há senha. **Não redirecione a porta 8099 no roteador:**
> isso colocaria o site na internet aberta, sem TLS e sem login.
>
> Para voltar a trancar tudo neste micro, ponha `SITE_BIND=127.0.0.1` no
> `.env.local` e rode `stop.bat` e `start.bat`.

### Na TV mesmo

Se a TV tiver navegador, é só digitar o endereço. Se não tiver, o caminho mais
simples é um computador ligado nela por HDMI, com o navegador em tela cheia.

## Escolher em que pasta os filmes ficam

**Clique em `pasta.bat`** (ou `./pasta.sh`). Ele pergunta o caminho — por
exemplo `E:\Filmes` —, cria a pasta se ela não existir, confere que dá para
escrever nela e escreve a configuração sozinho. Depois, `stop.bat` e
`start.bat`.

Não é preciso abrir nenhum `.yml`.

> **Por que isto não é um botão dentro do site.** O baixador roda num
> container, e um container só enxerga as pastas que foram montadas nele.
> Abrir uma pasta nova exige recriar o container, coisa que a página não pode
> fazer — e não deveria: dar ao site o poder de montar pastas suas seria dar a
> ele a máquina inteira. A escolha é feita uma vez aqui, e daí em diante o site
> mostra a pasta e deixa escolher entre as que existem.

O que já foi baixado antes continua onde estava; nada é movido.

### Mais de uma pasta

Para dois ou mais discos ao mesmo tempo, aí sim é edição à mão. No
`docker-compose.override.yml`, no serviço `worker`:

```yaml
services:
  worker:
    volumes:
      - juntos-worker:/var/lib/ss-worker
      - "E:/Filmes:/discos/filmes"
      - "D:/Series:/discos/series"
```

E no `.env.local`:

```
WORKER_STORAGE_DIRS=Filmes=/discos/filmes,Series=/discos/series
```

Os caminhos depois dos dois-pontos são os de **dentro** do container. Com dois
ou mais, a escolha aparece na tela de começar, com o espaço livre de cada um.
O rótulo é o que a página manda; o caminho nunca sai do worker, e um rótulo que
a instalação não declarou é recusado.

## Os dois modos de assistir

**Assistir** — aperta o play, escolhe a fonte, e o worker baixa numa janela que acompanha onde você está. Não ocupa o filme inteiro no disco, e o espaço volta depois.

**Baixar em segundo plano** — o segundo botão na tela de começar. O filme vai
para a fila e você fica onde estava: pode continuar procurando, ou assistir
outra coisa enquanto ele baixa. A aba **Baixados** mostra a fila com a
porcentagem de cada um. Pode até fechar o navegador — quem baixa é o worker,
não a página.

Se o computador desligar no meio, ou o Docker fechar, **o download continua de
onde parou**. Os bytes ficam no disco — o worker poupa as pastas marcadas
quando sobe — e o site reabre o trabalho assim que você entra, conferindo o que
já está lá antes de pedir o que falta. Não baixa de novo o que já tinha.

> Isso vale enquanto a pasta for a mesma. Se você trocar o disco no
> `pasta.bat` entre uma vez e outra, o filme recomeça, porque o lugar é outro.

**Baixar** — o botão durante a exibição, para quando você já está assistindo e
decide guardar. O arquivo fica no disco de verdade: sobrevive a reiniciar o worker, e a aba **Baixados** reabre sem internet. Devolver o espaço é um clique na mesma tela.

Sem internet, a aba do catálogo diz isso e leva para os Baixados. O catálogo precisa de um serviço de metadados e dos addons; o que já está no disco não precisa de nenhum dos dois.

## Quando algo não vai

```sh
# o que cada container está dizendo
docker compose logs -f app
docker compose logs -f worker

# o estado de todos
docker compose ps
```

**O vídeo não toca e o console mostra 403 no `PUT`.** A assinatura do envio
vale quinze minutos e é refeita a cada reinício do servidor. Recarregue a
página; se insistir, veja `logs -f app`.

**O start diz que o servidor subiu e morreu.** Ele já imprime as últimas linhas
do `app` logo abaixo, e a última costuma dizer o que faltou. Se falar em
variável de ambiente, apague o `.env.local` e rode o `setup` de novo.

**"no workers".** O worker não entrou na frota. Quase sempre é o `WORKER_ENROLLMENT_SECRET` diferente entre o `app` e o `worker` — acontece se o `.env.local` foi editado à mão. Veja `logs -f worker`.

**As fontes voltam vazias e o console mostra 429.** É o teto de buscas por
hora do próprio site, feito para um servidor compartilhado. Aqui ele já vem
alto (`PLUGIN_FETCH_PER_HOUR=20000`); se ainda assim bater, suba no
`.env.local`.

**A tela fica em "Conferindo o que já está no disco…".** É o baixador
reconferindo pedaço por pedaço um filme que já estava ali — reabrir um download
cria um trabalho novo, e ele só chama de "tem" o que já verificou. Não está
baixando de novo; é leitura de disco, e passa.

**O download está lento.** Três coisas mandam nisso, nesta ordem:

1. **A subida.** No BitTorrent quem não envia não recebe: os outros clientes
   reciprocam na medida do que lhes chega. Por padrão não há limite
   (`WORKER_UPLOAD_MBIT=0`). Se a sua internet engasga com a subida cheia,
   ponha um número ali — mas saiba que isso baixa a descida junto.
2. **A porta 4240.** Sem ela só há conexões de saída, e metade do enxame fica
   fora de alcance. Abra no roteador, apontando para esta máquina, TCP e UDP.
3. **O torrent.** Alguns simplesmente não têm seeds. A aba **Status** mostra
   quantos peers o worker achou.

## Apagar tudo

```sh
docker compose down -v
```

O `-v` leva os volumes junto: filmes baixados, salas e os segmentos já
preparados. Sem ele, só os containers somem.
