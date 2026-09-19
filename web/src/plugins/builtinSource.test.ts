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
