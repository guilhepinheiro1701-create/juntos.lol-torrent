# Fontes de torrent para o juntos.lol

Plugin que liga cinco addons do Stremio — **Brazuca Torrents**,
**Mico-Leão Dublado**, **Torrentio**, **Comet** e **MediaFusion** — mais o
indexador **torrent-indexer**, que raspa os sites de release brasileiros, ao
[juntos.lol](https://juntos.lol), e serve de ponte para qualquer outro que fale
o mesmo protocolo.

O juntos.lol não traz resolvedor de fonte nenhum: o catálogo é o Cinemeta/TMDB
embutido, e de onde vêm os magnets é um ponto de extensão que o host preenche
instalando plugins. Este repositório é um desses plugins. Instalado, abrir um
filme ou um episódio passa a listar fontes; sem nenhum plugin, a tela diz
"Nenhum plugin instalado" e para por aí.

## Instalar

No juntos.lol, botão **Plugins** (na Home ou no cabeçalho do catálogo dentro da
sala) → **adicionar** → cole a URL deste repositório:

```
https://github.com/guilhepinheiro1701-create/juntos.lol-torrent
```

A tela de confirmação mostra o que foi lido do manifesto antes de gravar
qualquer coisa: nome, versão, de onde o plugin se atualiza, e — o que
realmente importa — **os hosts que ele vai alcançar**:

| Host | Provedor |
| --- | --- |
| `94c8cb9f702d-brazuca-torrents.baby-beamup.club` | Brazuca Torrents |
| `27a5b2bfe3c0-stremio-brazilian-addon.baby-beamup.club` | Mico-Leão Dublado (só filmes) |
| `torrent-indexer.darklyn.org` | torrent-indexer (BluDV e Comando) |
| `v3-cinemeta.strem.io` | Cinemeta, só para virar o id do IMDb em título |
| `torrentio.strem.fun` | Torrentio |
| `torrentio.elfhosted.com` | Torrentio (espelho) |
| `comet.elfhosted.com` | Comet |
| `comet.feels.legal` | Comet (espelho) |
| `mediafusion.elfhosted.com` | MediaFusion |

Esses nove são tudo que este plugin consegue pedir. O juntos.lol confere cada
requisição contra essa lista por igualdade exata de hostname, tanto na URL
pedida quanto na URL onde a resposta chegou, então um redirecionamento para
fora da lista é barrado igual.

Também dá para arrastar o `plugin.js` direto no painel, se preferir conferir o
arquivo antes. Nesse caso o plugin continua se atualizando daqui, porque o
`updateUrl` está no manifesto — e o painel diz isso em voz alta.

### Vindo de uma versão anterior

Cada versão que acrescenta host **não se aplica sozinha**. A atualização fica
retida, o painel mostra os hosts novos por extenso, e você aprova. Até aprovar,
continua rodando a versão que você tem.

Isso não é atrito à toa. Código mudar é esperado; capacidade mudar, não — e a
diferença entre uma atualização de rotina e um plugin que passou a falar com
endereços novos é exatamente a coisa que merece um clique seu.

## O que ele faz

Os quatro addons falam o protocolo de streams do Stremio e o juntos.lol
também, então a resposta é devolvida quase intacta: nome do release, tamanho,
seeders e bandeiras de idioma são interpretados do outro lado, em
`web/src/catalog/streams.ts`, onde esse parsing já tem teste. O que este plugin
acrescenta é o que o outro lado não tem como fazer.

**Sete provedores, fundidos.** Acervos diferentes, então todos são
perguntados de uma vez e as respostas unidas, sem repetir: um torrent que dois
conhecem vira uma linha só.

**Provedor que não serve o tipo não é perguntado.** O manifesto vivo do
Mico-Leão Dublado declara `types: ["movie"]`, então pedir um episódio a ele é
gastar requisição para ouvir nada. O campo `types` no `PROVIDERS` evita isso.

**Espelhos, em fila.** Dentro de um provedor é o contrário: espelhos têm o
mesmo acervo, então só se pergunta ao seguinte quando o anterior não deu nada.
Perguntar aos dois gastaria requisição para produzir duplicata.

**Brazuca primeiro.** A ordem importa porque **o juntos.lol filtra a lista mas
nunca a reordena** — o que este plugin devolve é o que aparece, de cima para
baixo. Numa watch party brasileira, o que se procura primeiro é o dublado ou
legendado; quem quiser o contrário tem o filtro de idioma ali do lado.

**Magnet vira infoHash.** O `readLocation` do juntos.lol aceita um `infoHash`
de 40 hex ou uma `url` `https:`, e nada mais — então um stream que traz o
torrent como `magnet:` numa `url`, que é como o Comet e o MediaFusion
respondem sem conta debrid, seria descartado em silêncio. O infohash está ali
dentro do magnet; o plugin o move para o campo que o aplicativo lê. Sem isso,
dois dos quatro provedores seriam decorativos.

**`description` vira `title`.** O Stremio depreciou `title` em favor de
`description`, e os addons novos migraram: o Comet e o MediaFusion descrevem o
release em `description` e deixam `title` vazio. O juntos.lol lê só `title`,
então essas linhas chegariam sem nome, sem tamanho, sem contagem de seeders e
sem bandeira de idioma — e, sem nada para ler, o `streamResolution` jogaria
todas elas no balde `sd`. Copiar um campo no outro é a correção inteira, e tem
de acontecer aqui porque o outro lado não sabe que o campo existe.

**Seeders e tamanho entram no título.** O Mico-Leão Dublado carrega os dois
como campos de topo — `seeders` e `size` no modelo dele —, e o
`parseStreamTitle` só lê os marcadores `👤` e `💾` de dentro do texto do título.
Os números estavam no payload e a linha aparecia sem eles; dobrá-los no título
resolve, e de quebra é o que permite ao filtro abaixo enxergar um zero.

**Toda linha diz de onde veio.** O juntos.lol lê a fonte do marcador `⚙️`, e
só na linha que também traz `👤` ou `💾` — o `parseStreamTitle` acha a linha de
estatísticas primeiro e lê todo o resto de dentro dela. Quando um addon não dá
número nenhum, o plugin escreve uma linha própria com um `💾` sem dígito: o
padrão de tamanho não casa e fica vazio, e a fonte fica preenchida. Vale o
trabalho porque uma linha que não sabe dizer de onde veio é uma linha que
ninguém consegue depurar — inclusive eu, olhando uma captura de tela dela.

Fonte que o addon já declarou não é sobrescrita: o `⚙️ ThePirateBay` do
Torrentio continua sendo o tracker, não o nome do provedor.

**Tamanho também vem de `behaviorHints.videoSize`**, que é o campo padrão do
Stremio para isso, além do `size` de topo. E quando o título traz só o nome do
release e a `description` traz os números, são extraídas dela apenas as linhas
marcadas — a prosa fica de fora, para o label não repetir o mesmo texto.

**Release com TrueHD ou Atmos é descartado.** O worker do juntos.lol monta o
plano do FFmpeg a partir de uma matriz de áudio que conhece aac, ac3, eac3,
dts, dca, opus, flac, mp3 e vorbis — e **não conhece truehd**. O teste
`refuses_unlisted_codecs_clearly`, em `ss-worker/ss-remux/src/plan.rs`, afirma
isso. A matriz é consultada por faixa com `?`, então **uma faixa fora da lista
derruba o plano inteiro**: um DUAL cujo dublado é AC-3 comum falha mesmo assim,
por causa da faixa original.

O que o host vê nesse caso é `remote remux failed` sem razão nenhuma, depois de
minutos baixando — o servidor guarda a mensagem real só no log dele. Descartar
essas linhas aqui custa uma opção que ninguém conseguiria tocar e poupa a
viagem inteira. DTS fica de fora da lista de propósito: a matriz aceita e
converte.

**Torrent sem seeder é descartado.** O juntos.lol lê os bytes do swarm: sem
peer não há byte, e o que o host vê não é "sem seeders" e sim um remux que
morre na primeira leitura — `Error: Assertion failed.`, zero faixas, zero
duração, indistinguível na tela de um arquivo corrompido. Isso pesa mais no
Comet, que sem conta debrid responde a partir de índices de cache: hashes que
um serviço debrid guarda, o que não é a mesma coisa que hashes que o swarm
aberto ainda carrega. Só é descartado o que **declara** `👤 0`; silêncio nunca
conta como zero.

**Degradação em vez de queda.** Se um addon recusar o caminho configurado — uma
opção que mudou de nome, por exemplo —, o plugin pede de novo sem configuração
nenhuma. Provedor fora do ar não derruba os outros; espelho fora do ar custa só
a vez dele.

**Orçamento.** O juntos.lol dá a cada resolução 15 segundos e 32 requisições, e
mata o worker quando um dos dois acaba. Cada salto pelo servidor pode levar até
10 segundos sozinho. Os provedores são perguntados em paralelo, cada um com um
relógio menor que o do host. Medido: dez requisições num filme e nove
num episódio quando tudo responde, quinze no pior caso.

## O indexador, que é de outra natureza

Os cinco addons devolvem streams prontos. O
[torrent-indexer](https://github.com/felipemarinho97/torrent-indexer) é outra
coisa: um serviço em Go que **raspa os sites de release brasileiros** —
bludv, comando, rede-torrent, vaca-torrent e outros — e serve o resultado como
JSON. Não é addon do Stremio, então tem URL própria e um adaptador na volta.

**Ele busca por texto, e um plugin recebe um id do IMDb e mais nada.** Por isso
há uma consulta ao Cinemeta antes do leque abrir: uma só, compartilhada pelos
dois indexadores, e cobrada apenas quando algum deles está em jogo. Sem título,
eles são pulados inteiros — gastar a requisição só compraria um 400.

**Sem os filtros `imdb=` e `year=`.** Eles existem na API, mas o `FilterBy` do
indexador descarta toda entrada cujo campo o raspador não conseguiu preencher —
e frequentemente não consegue, porque depende de achar um link do IMDb na
página. Custariam muito mais recall do que a precisão que trazem. A busca por
título já é o filtro.

**Séries funcionam por acaso feliz.** Os sites brasileiros publicam temporada
inteira, e a busca devolve o pacote; o `pickStreamFile` do juntos.lol já sabe
achar o episódio dentro dele pelo padrão `S01E02`. Não há nada de especial a
fazer.

> `INDEXER_BASE` aponta para `torrent-indexer.darklyn.org`, que é a **instância
> pública de teste do autor** — infraestrutura de terceiro, gratuita, que pode
> cair, limitar ou sumir. Subir a sua é um `docker compose up` no repositório
> dele, e aí é só trocar a constante: você ganha o cache, a velocidade e para
> de depender do servidor de outra pessoa.

## Dois addons que ficaram de fora

O [GuIndex](https://github.com/GuickerZ/guindex) e o
[BRASIL-RD-ADDON](https://github.com/onikopolar/BRASIL-RD-ADDON) foram
examinados e **não entraram: os dois exigem conta debrid paga.** O GuIndex
marca `configurationRequired` sem chave de Real-Debrid ou TorBox; o
BRASIL-RD-ADDON pede a API Key do Torbox no próprio painel. Sem conta, não
devolvem nada.

Vale saber para o futuro: se você assinar um debrid, eles passam a ser as
melhores fontes possíveis para o juntos.lol — porque entregam **link HTTPS
direto**, e o `readLocation` aceita isso. Um link desses não depende de swarm
nenhum, que é exatamente o problema que derrubou o Comet.

De quebra, o GuIndex foi útil de outro jeito: ele já consome esse mesmo
torrent-indexer, e ler o `torrent-indexer-provider.ts` dele confirmou o
desenho — resolver o título no Cinemeta antes de buscar.

## Configuração de cada provedor

| Provedor | Como se configura |
| --- | --- |
| **Brazuca Torrents** | Não aceita opções. Caminho simples. |
| **Mico-Leão Dublado** | Não aceita opções. Só filmes. |
| **torrent-indexer** | `INDEXER_BASE`. Busca por título, resolvido no Cinemeta. |
| **Torrentio** | Opções num segmento do caminho, montado em `TORRENTIO_CONFIG`. |
| **Comet** | base64url de um JSON, montado pelo próprio plugin em `COMET_CONFIG`. |
| **MediaFusion** | Segmento cifrado, gerado no `/configure` da instância e colado em `MEDIAFUSION_CONFIG`. Veja abaixo. |

**Torrentio** recebe a lista padrão de trackers mais os brasileiros — `comando`
e `bludv`, que não estão no conjunto padrão dele —, com `language=portuguese`
na frente da ordenação e um filtro que tira cam, screener e qualidade
desconhecida.

**Comet** recebe `{"debridService":"torrent"}`, o modo torrent direto: sem conta
debrid, e a resposta vem como magnet em vez de link para o cache de alguém — que
é a única forma que o juntos.lol abre de todo jeito. O plugin monta o segmento
sozinho com `btoa`, porque a configuração do Comet é base64 de JSON simples, não
um blob assinado. Se alguma versão recusar, `{}` (que vira `e30`) é o que tentar.

**MediaFusion é o único que este plugin não consegue configurar sozinho**, e
vale dizer por quê. As opções dele viajam ou num cabeçalho HTTP
(`encoded_user_data`) ou num segmento do caminho. O cabeçalho está fora de
alcance: `api.fetch` recebe uma URL e mais nada — sem cabeçalho, sem método, sem
corpo — porque quem executa cada requisição é o servidor do juntos.lol em nome
do plugin. E o segmento do caminho é **cifrado com a `SECRET_KEY` da própria
instância** (AES-256): só ela consegue emitir um.

Então o que está em `MEDIAFUSION_CONFIG` foi gerado em
[mediafusion.elfhosted.com/configure](https://mediafusion.elfhosted.com/configure)
e colado ali. Ele carrega preferências de catálogo, qualidade e idioma, e
**nenhuma conta debrid** — que é o único motivo pelo qual pode ficar num arquivo
público.

> **Se você regerar essa configuração escolhendo um serviço debrid**
> (Real-Debrid, TorBox, AllDebrid, Premiumize), **o token da sua conta vai
> dentro do blob.** Este repositório precisa ser público para o juntos.lol
> instalar o plugin a partir dele, então tudo que está no `plugin.js` está
> publicado, e o histórico do git guarda o que já foi commitado. Nesse caso,
> preencha a constante numa cópia local, tire o `updateUrl` do manifesto e
> instale arrastando o arquivo — o blob não sai da sua máquina, ao custo de
> perder a atualização automática.

Vazio também é válido, e significa perguntar anonimamente. De um jeito ou de
outro o caminho simples fica de reserva, então um segmento que a instância
deixe de aceitar custa uma requisição e não o provedor.

## Acrescentar uma fonte

É acrescentar um objeto a `PROVIDERS` — qualquer addon com
`/stream/{tipo}/{id}.json` serve, que é o que faz disto uma ponte e não um
cliente de nenhum deles em particular. Se o addon só atende parte dos tipos,
declare `types: ['movie']` (ou `['series']`) e ele deixa de ser perguntado para
o que não serve.

Três coisas andam junto: o host novo vai também em `manifest.hosts`; a
atualização fica retida até alguém aprovar o host; e um provedor novo custa
requisição e tempo — confira `RUN_BUDGET_MS` contra o número de espelhos do
provedor mais fundo.

Se o problema for o endereço de saída, há remédio do lado do servidor também:
`PLUGIN_FETCH_PROXY` faz as requisições dos plugins saírem por um proxy `http`,
`https` ou `socks5`.

## Desenvolver

```bash
npm test
```

Sem dependência nenhuma — só o Node 22 e o runner que vem com ele. O plugin é
um arquivo que o navegador de quem instalou vai buscar cru; um `node_modules`
não teria como chegar lá, e um passo de build tornaria o que se audita
diferente do que se executa.

Os testes não se contentam em chamar a função. `test/sandbox.js` remonta a
caixa em que o juntos.lol executa um plugin: um contexto `node:vm` com o escopo
global podado para a mesma allowlist do `web/src/plugins/worker.ts` (subindo a
cadeia de protótipos, como lá), o `plugin.js` avaliado como módulo dentro dele,
e um `api.fetch` falso que aplica a política do `web/src/plugins/policy.ts` e
conta as requisições. Um teste enumera o que sobrou do escopo e falha se
aparecer nome fora da lista.

Esses trechos são cópias declaradas do juntos.lol, não importações: um plugin é
um repositório solto, sem dependência do aplicativo. Cada cópia nomeia o
arquivo de onde veio, porque cópia declarada também envelhece.

Ao mexer no plugin, três coisas quebram em silêncio se não forem lembradas:

- **nada de rede no topo do módulo.** Para ler o manifesto, o juntos.lol avalia
  o módulo na mesma caixa, com a lista de hosts vazia e 5 segundos de teto;
- **nada de `eval`, `new Function` ou WebAssembly.** A CSP do worker não traz
  `'unsafe-eval'` nem `'wasm-unsafe-eval'`;
- **nada de `fetch`, `navigator`, `location` ou `origin`.** O escopo não tem.
  A única saída é o `api.fetch` que chega por parâmetro.

## Verificado e não verificado

O contrato — formato do manifesto, assinatura de `streams`, política de
`api.fetch`, os tetos de tempo e de requisição, o que o `readLocation` aceita, e
o fato de a interface filtrar sem reordenar — foi lido do código do
[juntos.lol](https://github.com/giulianoo0/juntos.lol), não de memória, e é o
que os testes exercitam.

Os endereços, a gramática de URL de cada addon e a grafia das opções foram
conferidos contra o uso real em dezenas de projetos independentes, não contra os
serviços: o ambiente em que este plugin foi escrito não tem saída para esses
hosts. Então **não está confirmado que os nove respondem hoje**.

A exceção é o MediaFusion, que virou o mais certo dos quatro: a configuração em
`MEDIAFUSION_CONFIG` foi gerada na própria instância, o que prova que ela
respondia quando foi gerada e que aceita esse segmento.

É de baixo risco por desenho, e há teste para cada caso: provedor fora do ar não
derruba os outros, espelho fora do ar custa a vez dele, e opção errada cai no
caminho sem configuração. Se quiser conferir antes de instalar, o
`/manifest.json` de cada host diz tudo.

Uma nota sobre o `torrentio.elfhosted.com`: ele é a instalação do Torrentio que
a ElfHosted mantém, publicada por eles como KnightCrawler. Mesmo código e mesma
gramática de URL, **índice próprio** — não é um espelho byte a byte do
`torrentio.strem.fun`. Está em `mirrors` mesmo assim porque o motivo de ele
existir aqui é ser a saída quando a instância principal recusa o endereço, e
não ampliar o acervo.

## Licença

MIT, no `LICENSE`.

Este plugin não hospeda, não indexa e não distribui conteúdo: ele repassa a
resposta de addons de terceiros ao aplicativo que o instalou. O que se faz com
essa resposta é responsabilidade de quem instala.
