import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { builtinId, ensureBuiltin, forgetBuiltinRemoved, rememberBuiltinRemoved } from './builtin'
import type { InstalledPlugin } from './store'

vi.mock('./builtin-source.js?raw', () => ({ default: 'export const manifest = {}' }))
vi.mock('./install', () => ({ buildInstall: vi.fn() }))

const { buildInstall } = await import('./install')

const fabricado = (over: Partial<InstalledPlugin> = {}): InstalledPlugin => ({
  id: 'built-in-id', manifest: { id: 'p', name: 'Fontes', version: '1.0.0', hosts: ['a.test'], updateUrl: null },
  source: 'fonte', sha256: 'aaa',
  origin: { kind: 'builtin', name: 'juntos-br', updateUrl: null },
  approvedHosts: ['a.test'], enabled: true, pendingUpdate: null, installedAt: 1,
  ...over,
} as InstalledPlugin)

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(buildInstall).mockResolvedValue(fabricado())
})
afterEach(() => vi.restoreAllMocks())

describe('o plugin que vem com o site', () => {
  it('se instala sozinho num navegador que nunca viu nada', async () => {
    const save = vi.fn().mockResolvedValue(undefined)

    await expect(ensureBuiltin({ read: async () => null, save })).resolves.toBe('installed')
    expect(save).toHaveBeenCalledOnce()
  })

  it('nao reescreve nada quando a fonte e a mesma', async () => {
    const save = vi.fn()

    await expect(ensureBuiltin({ read: async () => fabricado(), save })).resolves.toBe('kept')
    expect(save).not.toHaveBeenCalled()
  })

  // Um `git pull` do site e o que atualiza este plugin. O que a pessoa decidiu
  // sobre ele nao pode ser desfeito por isso.
  it('atualiza a fonte e preserva o que a pessoa escolheu', async () => {
    vi.mocked(buildInstall).mockResolvedValue(fabricado({ sha256: 'bbb', source: 'nova' }))
    const save = vi.fn().mockResolvedValue(undefined)

    await expect(ensureBuiltin({ read: async () => fabricado({ enabled: false, installedAt: 42 }), save }))
      .resolves.toBe('updated')

    const gravado = save.mock.calls[0][0] as InstalledPlugin
    expect(gravado.source).toBe('nova')
    expect(gravado.enabled).toBe(false)
    expect(gravado.installedAt).toBe(42)
  })

  it('nao volta depois de apagado', async () => {
    rememberBuiltinRemoved()
    const save = vi.fn()

    await expect(ensureBuiltin({ read: async () => null, save })).resolves.toBe('buried')
    expect(save).not.toHaveBeenCalled()

    forgetBuiltinRemoved()
    await expect(ensureBuiltin({ read: async () => null, save: vi.fn().mockResolvedValue(undefined) }))
      .resolves.toBe('installed')
  })

  it('tem sempre o mesmo id, para nao se duplicar a cada recarga', async () => {
    await expect(builtinId()).resolves.toBe(await builtinId())
  })
})
