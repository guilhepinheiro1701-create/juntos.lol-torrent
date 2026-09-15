# Torrentio para o juntos.lol

Plugin de fontes que liga o [Torrentio](https://torrentio.strem.fun) — e
qualquer outro addon que fale o protocolo de streams do Stremio — ao
[juntos.lol](https://juntos.lol).

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

- `torrentio.strem.fun`
- `torrentio.elfhosted.com`

Esses dois são tudo que este plugin consegue pedir. O juntos.lol confere cada
requisição contra essa lista por igualdade exata de hostname, tanto na URL
pedida quanto na URL onde a resposta chegou, então um redirecionamento para
fora da lista é barrado igual.

Também dá para arrastar o `plugin.js` direto no painel, se preferir conferir o
arquivo antes. Nesse caso o plugin continua se atualizando daqui, porque o
`updateUrl` está no manifesto — e o painel diz isso em voz alta.

## O que ele faz

Torrentio fala o protocolo de streams do Stremio e o juntos.lol também, então a
resposta do addon é devolvida quase intacta: nome do release, tamanho, seeders
e bandeiras de idioma são interpretados do outro lado, em
`web/src/catalog/streams.ts`, onde esse parsing já tem teste. O que este plugin
acrescenta é o que o outro lado não tem como fazer.

**Configuração pensada para quem assiste em português.** Os trackers
brasileiros — `comando` e `bludv` — não estão no conjunto padrão do Torrentio,
e uma watch party brasileira sem eles perde a maior parte do que quer. O plugin
pede a lista padrão mais os dois, com `language=portuguese` na frente da
ordenação e um filtro que tira cam, screener e qualidade desconhecida.

**Queda para o espelho.** A instância principal do Torrentio recusa faixas de
endereço de datacenter, e toda requisição deste plugin sai do servidor do
juntos.lol, que está numa. Quando é esse o problema, o espelho da comunidade
(ElfHosted) responde onde a principal não respondeu. O plugin tenta a
principal, e só pede ao espelho quando ela não deu nada.

**Degradação em vez de queda.** Se o Torrentio recusar o caminho configurado —
uma opção que mudou de nome, por exemplo —, o plugin pede de novo sem
configuração nenhuma. Pior caso, o Torrentio responde sem filtro, o que é pior
que configurado e muito melhor que vazio. Já uma resposta com `streams: []` é
uma resposta ("procurei e não achei") e não provoca repetição.

**Orçamento.** O juntos.lol dá a cada resolução 15 segundos e 32 requisições,
e mata o worker quando um dos dois acaba. Cada salto pelo servidor pode levar
até 10 segundos sozinho. O plugin trabalha contra um relógio próprio, menor que
o do host, e um upstream travado custa a vez dele em vez de custar a resolução
inteira.

## Configurar

Tudo que se ajusta está no topo do `plugin.js`, em maiúsculas.

| Constante | O que muda |
| --- | --- |
| `TORRENTIO_CONFIG` | Opções do Torrentio: `providers`, `language`, `sort`, `qualityfilter`, `limit`. |
| `SOURCES` | Para onde perguntar, em ordem de preferência. |
| `MODE` | `'fallback'` pergunta ao seguinte só quando o anterior não deu nada; `'merge'` pergunta a todos de uma vez e junta, sem repetir. |
| `RUN_BUDGET_MS` / `ATTEMPT_MS` | O relógio da resolução inteira e o de cada upstream. |

`'fallback'` é o padrão porque `SOURCES` são espelhos de um addon só: eles têm
o mesmo acervo, e juntá-los gastaria requisição para produzir duplicata. Troque
para `'merge'` quando `SOURCES` deixar de ser espelho e passar a ser addon
diferente — um MediaFusion, um Comet, o que for. O formato é o mesmo
`/stream/{tipo}/{id}.json`, que é o que faz disto uma ponte e não um cliente do
Torrentio.

**Acrescentar um host exige acrescentá-lo também em `manifest.hosts`.** E aí
vale reparar num detalhe do desenho do juntos.lol: uma versão nova que peça
host que ninguém aprovou **não é aplicada sozinha**. A atualização fica retida,
o painel mostra os hosts novos por extenso, e quem instalou decide. Código
mudar é esperado; capacidade mudar, não.

Se o problema for mesmo o endereço de saída, há remédio do lado do servidor
também: `PLUGIN_FETCH_PROXY` faz as requisições dos plugins saírem por um proxy
`http`, `https` ou `socks5`.

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
`api.fetch`, os tetos de tempo e de requisição, o retorno esperado — foi lido
do código do [juntos.lol](https://github.com/giulianoo0/juntos.lol), não de
memória, e é o que os testes exercitam.

O que **não** deu para conferir contra o serviço ao vivo, porque o ambiente em
que este plugin foi escrito não tem saída para esses hosts:

- a grafia exata das opções em `TORRENTIO_CONFIG`;
- se `torrentio.elfhosted.com` responde hoje.

As duas são de baixo risco e fáceis de acertar: opção errada cai no caminho sem
configuração (há teste para isso), e espelho fora do ar custa a vez dele e não
a resolução (há teste para isso também). Se quiser conferir antes de instalar,
`curl https://torrentio.strem.fun/manifest.json` e a página de configuração do
Torrentio dizem tudo.

## Licença

MIT, no `LICENSE`.

Este plugin não hospeda, não indexa e não distribui conteúdo: ele repassa a
resposta de um addon de terceiros ao aplicativo que o instalou. O que se faz
com essa resposta é responsabilidade de quem instala.
