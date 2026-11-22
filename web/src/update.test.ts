import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const OLD = 'a'.repeat(40)
const NEW = 'b'.repeat(40)

function reply(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response)
}

describe('checkForUpdate', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules() })
  afterEach(() => vi.unstubAllEnvs())

  it('offers the new commits when GitHub is ahead, and caches the answer', async () => {
    vi.stubEnv('VITE_GIT_SHA', OLD)
    const { checkForUpdate } = await import('./update')
    const fetcher = vi.fn((url: string) => url.includes('/compare/')
      ? reply({ status: 'ahead', commits: [{ commit: { message: 'etapa 1: coisa\n\ncorpo' } }, { commit: { message: 'etapa 2' } }] })
      : reply({ sha: NEW })) as unknown as typeof fetch
    expect(await checkForUpdate(fetcher, 1_000)).toEqual({ latest: NEW, changes: ['etapa 1: coisa', 'etapa 2'] })
    await checkForUpdate(fetcher, 2_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('stays quiet when already up to date, unbuilt, or offline', async () => {
    vi.stubEnv('VITE_GIT_SHA', NEW)
    const { checkForUpdate } = await import('./update')
    expect(await checkForUpdate((() => reply({ sha: NEW })) as unknown as typeof fetch)).toBeNull()
    localStorage.clear()
    expect(await checkForUpdate((() => Promise.reject(new Error('offline'))) as unknown as typeof fetch)).toBeNull()
    vi.resetModules()
    vi.stubEnv('VITE_GIT_SHA', 'local')
    const fresh = await import('./update')
    const never = vi.fn() as unknown as typeof fetch
    expect(await fresh.checkForUpdate(never)).toBeNull()
    expect(never).not.toHaveBeenCalled()
  })
})
