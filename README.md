# Torrentio + Brazuca para o juntos.lol

Plugin de fontes que liga o [Torrentio](https://torrentio.strem.fun), o
**Brazuca Torrents** — e qualquer outro addon que fale o protocolo de streams
do Stremio — ao [juntos.lol](https://juntos.lol).

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

- `94c8cb9f702d-brazuca-torrents.baby-beamup.club`
- `torrentio.strem.fun`
- `torrentio.elfhosted.com`

Esses três são tudo que este plugin consegue pedir. O juntos.lol confere cada
requisição contra essa lista por igualdade exata de hostname, tanto na URL
pedida quanto na URL onde a resposta chegou, então um redirecionamento para
fora da lista é barrado igual.

Também dá para arrastar o `plugin.js` direto no painel, se preferir conferir o
arquivo antes. Nesse caso o plugin continua se atualizando daqui, porque o
`updateUrl` está no manifesto — e o painel diz isso em voz alta.

### Vindo da versão 1.0.0

A 2.0.0 acrescenta um host, e é assim que o juntos.lol trata isso: a
atualização **não se aplica sozinha**. Ela fica retida, o painel mostra
`94c8cb9f702d-brazuca-torrents.baby-beamup.club` por extenso, e você aprova.
Até aprovar, continua rodando a versão que você tem.

Isso não é atrito à toa. Código mudar é esperado; capacidade mudar, não — e a
diferença entre uma atualização de rotina e um plugin que passou a falar com um
endereço novo é exatamente a coisa que merece um clique seu.

## O que ele faz

Torrentio e Brazuca falam o protocolo de streams do Stremio e o juntos.lol
também, então a resposta dos addons é devolvida quase intacta: nome do release,
tamanho, seeders e bandeiras de idioma são interpretados do outro lado, em
`web/src/catalog/streams.ts`, onde esse parsing já tem teste. O que este plugin
acrescenta é o que o outro lado não tem como fazer.

**Dois provedores, fundidos.** O Brazuca Torrents indexa tracker brasileiro —
BaixaFilmes, RedeTorrent, VacaTorrent — e é onde mora a maior parte do que está
dublado. O Torrentio indexa o resto do mundo. Acervos diferentes, então os dois
são perguntados de uma vez e as respostas são unidas, sem repetir: um torrent
que os dois conhecem vira uma linha só.

**Espelhos, em fila.** Dentro de um provedor é o contrário: espelhos têm o
mesmo acervo, então só se pergunta ao seguinte quando o anterior não deu nada.
Perguntar aos dois gastaria requisição para produzir duplicata.

**Brazuca primeiro.** A ordem importa porque **o juntos.lol filtra a lista mas
nunca a reordena** — o que este plugin devolve é o que aparece, de cima para
baixo. Numa watch party brasileira, o que se procura primeiro é o dublado ou
legendado; quem quiser o contrário tem o filtro de idioma ali do lado.

**Config para português no Torrentio.** Os trackers brasileiros — `comando` e
`bludv` — não estão no conjunto padrão do Torrentio. O plugin pede a lista
padrão mais os dois, com `language=portuguese` na frente da ordenação e um
filtro que tira cam, screener e qualidade desconhecida. O Brazuca não aceita
opção nenhuma, então vai direto ao caminho simples.

**Degradação em vez de queda.** Se o Torrentio recusar o caminho configurado —
uma opção que mudou de nome, por exemplo —, o plugin pede de novo sem
configuração nenhuma. Pior caso, o Torrentio responde sem filtro, o que é pior
que configurado e muito melhor que vazio. Já uma resposta com `streams: []` é
uma resposta ("procurei e não achei") e não provoca repetição.

**Orçamento.** O juntos.lol dá a cada resolução 15 segundos e 32 requisições, e
mata o worker quando um dos dois acaba. Cada salto pelo servidor pode levar até
10 segundos sozinho. O plugin trabalha contra um relógio próprio, menor que o
do host: um provedor travado custa a vez dele, não a resolução inteira. No
caminho feliz são duas requisições; no pior caso, seis.

## Configurar

Tudo que se ajusta está no topo do `plugin.js`, em maiúsculas.

| Constante | O que muda |
| --- | --- |
| `PROVIDERS` | Quem perguntar, e em que ordem a lista aparece. Cada provedor tem `mirrors`. |
| `TORRENTIO_CONFIG` | Opções do Torrentio: `providers`, `language`, `sort`, `qualityfilter`, `limit`. |
| `RUN_BUDGET_MS` / `ATTEMPT_MS` | O relógio da resolução inteira e o de cada tentativa. |

**Acrescentar uma fonte** é acrescentar um objeto a `PROVIDERS` — qualquer
addon com `/stream/{tipo}/{id}.json` serve, que é o que faz disto uma ponte e
não um cliente do Torrentio. Um bom candidato para quem quer dublado é o
Mico-Leão Dublado (`27a5b2bfe3c0-stremio-brazilian-addon.baby-beamup.club`),
que devolve `url` em vez de `infoHash` — o juntos.lol abre as duas formas, e a
por URL nem passa pelo swarm.

Duas coisas andam junto com isso: o host novo vai também em `manifest.hosts`, e
a atualização fica retida até alguém aprovar o host (veja acima). Um provedor
novo também custa requisição e tempo — confira `RUN_BUDGET_MS` contra o número
de espelhos que o provedor mais fundo tem.

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
`api.fetch`, os tetos de tempo e de requisição, o retorno esperado, e o fato de
a interface filtrar sem reordenar — foi lido do código do
[juntos.lol](https://github.com/giulianoo0/juntos.lol), não de memória, e é o
que os testes exercitam.

Os endereços e a grafia das opções do Torrentio foram conferidos contra o uso
real em muitos projetos independentes, não contra o serviço: o ambiente em que
este plugin foi escrito não tem saída para esses hosts. Então **não está
confirmado que os três respondem hoje**.

É de baixo risco por desenho, e há teste para cada caso: provedor fora do ar
não derruba o outro, espelho fora do ar custa a vez dele, e opção errada cai no
caminho sem configuração. Se quiser conferir antes de instalar,
`curl https://torrentio.strem.fun/manifest.json` e o `/manifest.json` de cada
um dos outros dizem tudo.

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
