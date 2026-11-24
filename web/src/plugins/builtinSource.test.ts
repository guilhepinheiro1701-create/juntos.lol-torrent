import { describe, expect, it } from 'vitest'
import { manifest, streams } from './builtin-source.js'
import { parseManifest } from './manifest'

// O plugin que vai dentro do site tem de passar pelo mesmo portao que um
// trazido de fora. Se ele nao passar, o catalogo abre sem fonte nenhuma e o
// motivo so aparece no console de quem for procurar.
describe('a fonte que vem com o site', () => {
  it('e um manifesto que o proprio site aceita', () => {
    const lido = parseManifest(manifest)

    expect(lido.id).toBe('juntos-torrent-sources')
    expect(lido.hosts.length).toBeGreaterThan(0)
    // Todo host declarado tem de ser um nome, nao um endereco com esquema:
    // e assim que a pagina compara antes de deixar o plugin buscar.
    for (const host of lido.hosts) expect(host).not.toContain('/')
  })

  it('exporta o ponto de entrada que o runtime chama', () => {
    expect(typeof streams).toBe('function')
  })
})

describe('as fontes brasileiras e os avisos falsos', () => {
  const torrent = (name: string, hash: string) => ({ name, title: `${name}\n👤 40 💾 2 GB`, infoHash: hash.repeat(40).slice(0, 40), fileIdx: 0 })

  // Um api.fetch falso: cada host responde o que um addon real responderia.
  function fakeApi(byHost: Record<string, unknown>) {
    const asked: string[] = []
    return {
      asked,
      api: {
        fetch: async (url: string) => {
          asked.push(url)
          const host = new URL(url).hostname
          const body = byHost[host] ?? { streams: [] }
          return { ok: true, status: 200, url, text: async () => JSON.stringify(body), json: async () => body }
        },
      },
    }
  }

  it('declara os hosts novos e pede o Mico-Leao ao Torrentio', async () => {
    expect((manifest as { hosts: string[] }).hosts).toEqual(expect.arrayContaining(['addon.peerflix.mov', 'stremio-betor.onrender.com']))
    const { api, asked } = fakeApi({})
    await streams({ type: 'movie', id: 'tt0816692' }, api)
    expect(asked.some((url) => url.includes('addon.peerflix.mov/language=pt/'))).toBe(true)
    expect(asked.some((url) => url.includes('stremio-betor.onrender.com/stream/movie/tt0816692'))).toBe(true)
    expect(asked.some((url) => url.includes('torrentio') && url.includes('micoleaodublado'))).toBe(true)
  })

  it('descarta o aviso disfarcado de fonte e ainda assim mostra as fontes reais', async () => {
    const { api } = fakeApi({
      'comet.feels.legal': { streams: [{ name: '[⛔️] Comet', description: 'Non-debrid searches disabled', url: 'https://x.example/playback/1' }] },
      'comet.elfhosted.com': { streams: [torrent('Comet real', 'c')] },
      'stremio-betor.onrender.com': { streams: [torrent('BeTor\n[bludv]', 'b')] },
    })
    const list = await streams({ type: 'series', id: 'tt0944947', season: 1, episode: 1 }, api)
    const names = (list as Array<{ name?: string; title?: string }>).map((s) => `${s.name} ${s.title}`).join(' | ')
    expect(names).not.toMatch(/⛔/)
    expect(names).toMatch(/Comet real/)
    expect(names).toMatch(/BeTor/)
  })
})
