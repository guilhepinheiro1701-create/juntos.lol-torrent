import { afterEach, describe, expect, it, vi } from 'vitest'
import { TorrentRejectedError } from '../remoteTorrent'

const opens: Array<{ id: string; signal: AbortSignal; resolve: (v: unknown) => void; reject: (e: unknown) => void }> = []
vi.mock('../catalog/openStream', async (orig) => ({
  ...(await orig<typeof import('../catalog/openStream')>()),
  openCatalogStream: vi.fn((stream: { label: string }, _t: unknown, _s: unknown, options: { signal: AbortSignal }) => new Promise((resolve, reject) => {
    opens.push({ id: stream.label, signal: options.signal, resolve, reject })
  })),
}))

const { raceOpen } = await import('./raceOpen')
const pick = (label: string) => ({ stream: { label } }) as never

describe('raceOpen', () => {
  afterEach(() => { opens.length = 0 })

  it('keeps the first source that lists and cancels the others', async () => {
    const race = raceOpen([pick('a'), pick('b'), pick('c')], new AbortController().signal, 40_000, () => undefined)
    await Promise.resolve()
    expect(opens.map((o) => o.id)).toEqual(['a', 'b', 'c'])
    const destroy = vi.fn()
    opens[1].resolve({ session: { destroy }, file: {} })
    const won = await race
    expect((won.pick as unknown as { stream: { label: string } }).stream.label).toBe('b')
    expect(opens[0].signal.aborted).toBe(true)
    expect(opens[2].signal.aborted).toBe(true)
    expect(opens[1].signal.aborted).toBe(false)
    const late = vi.fn()
    opens[0].resolve({ session: { destroy: late }, file: {} })
    await Promise.resolve()
    expect(late).toHaveBeenCalled()
  })

  it('reports the most telling failure when every source fails', async () => {
    const race = raceOpen([pick('a'), pick('b')], new AbortController().signal, 40_000, () => undefined)
    await Promise.resolve()
    opens[0].reject(new TorrentRejectedError('no_metadata'))
    opens[1].reject(new TorrentRejectedError('episode_missing'))
    await expect(race).rejects.toMatchObject({ code: 'episode_missing' })
  })
})
