# Fontes de torrent para o juntos.lol

Plugin que liga quatro addons do Stremio — **Brazuca Torrents**,
**Torrentio**, **Comet** e **MediaFusion** — ao
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
| `torrentio.strem.fun` | Torrentio |
| `torrentio.elfhosted.com` | Torrentio (espelho) |
| `comet.elfhosted.com` | Comet |
| `comet.feels.legal` | Comet (espelho) |
| `mediafusion.elfhosted.com` | MediaFusion |

Esses seis são tudo que este plugin consegue pedir. O juntos.lol confere cada
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

**Quatro provedores, fundidos.** Acervos diferentes, então os quatro são
perguntados de uma vez e as respostas unidas, sem repetir: um torrent que dois
conhecem vira uma linha só.

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

**Degradação em vez de queda.** Se um addon recusar o caminho configurado — uma
opção que mudou de nome, por exemplo —, o plugin pede de novo sem configuração
nenhuma. Provedor fora do ar não derruba os outros; espelho fora do ar custa só
a vez dele.

**Orçamento.** O juntos.lol dá a cada resolução 15 segundos e 32 requisições, e
mata o worker quando um dos dois acaba. Cada salto pelo servidor pode levar até
10 segundos sozinho. Os provedores são perguntados em paralelo, cada um com um
relógio menor que o do host. No caminho feliz são quatro requisições; no pior
caso, com tudo fora do ar, dez.

## Configuração de cada provedor

| Provedor | Como se configura |
| --- | --- |
| **Brazuca Torrents** | Não aceita opções. Caminho simples. |
| **Torrentio** | Opções num segmento do caminho, montado em `TORRENTIO_CONFIG`. |
| **Comet** | base64url de um JSON, montado pelo próprio plugin em `COMET_CONFIG`. |
| **MediaFusion** | Anônimo por padrão. Veja abaixo. |

**Torrentio** recebe a lista padrão de trackers mais os brasileiros — `comando`
e `bludv`, que não estão no conjunto padrão dele —, com `language=portuguese`
na frente da ordenação e um filtro que tira cam, screener e qualidade
desconhecida.

**Comet** recebe `{"debridService":"torrent"}`, o modo torrent direto: sem conta
debrid, e a resposta vem como magnet em vez de link para o cache de alguém — que
é a única forma que o juntos.lol abre de todo jeito. O plugin monta o segmento
sozinho com `btoa`, porque a configuração do Comet é base64 de JSON simples, não
um blob assinado. Se alguma versão recusar, `{}` (que vira `e30`) é o que tentar.

**MediaFusion é o único que não dá para configurar daqui**, e vale dizer por quê
em vez de deixar uma string vazia parecendo descuido. As opções dele viajam ou
num cabeçalho HTTP (`encoded_user_data`) ou num segmento do caminho. O cabeçalho
está fora de alcance: `api.fetch` recebe uma URL e mais nada — sem cabeçalho, sem
método, sem corpo — porque quem executa cada requisição é o servidor do
juntos.lol em nome do plugin. E o segmento do caminho é **cifrado com a
`SECRET_KEY` da própria instância** (AES-256): só ela consegue emitir um.

Então ele é perguntado anonimamente, no caminho simples, e fica com os padrões
que a instância aplica a quem não se identificou. Para fazer melhor, abra
[mediafusion.elfhosted.com/configure](https://mediafusion.elfhosted.com/configure),
configure, e cole o segmento opaco e comprido da URL resultante em
`MEDIAFUSION_CONFIG`, no topo do `plugin.js`. Preenchido, ele é tentado
primeiro, com o caminho simples de reserva.

## Acrescentar uma fonte

É acrescentar um objeto a `PROVIDERS` — qualquer addon com
`/stream/{tipo}/{id}.json` serve, que é o que faz disto uma ponte e não um
cliente de nenhum deles em particular. Um candidato para quem quer dublado é o
Mico-Leão Dublado (`27a5b2bfe3c0-stremio-brazilian-addon.baby-beamup.club`), que
devolve `url` em vez de `infoHash` — o juntos.lol abre as duas formas, e a por
URL nem passa pelo swarm.

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
hosts. Então **não está confirmado que os seis respondem hoje**, e o
comportamento anônimo do MediaFusion é o ponto mais incerto do conjunto — há
projeto que o usa assim e há registro de instância recusando quem não se
identifica.

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
