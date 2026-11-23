import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSwarmHealth, liveSeeds, type LiveSwarms } from './swarmHealth'
import { rankStreams } from './autoPick'
import type { CatalogStream } from './streams'

const s = (label: string, hash: string, seeders: number | null, resolution: CatalogStream['resolution'] = '1080p'): CatalogStream => ({
  quality: resolution, resolution, label, seeders, size: '', source: '', languages: ['🇧🇷'],
  location: { kind: 'torrent', infoHash: hash.repeat(40).slice(0, 40), fileIdx: 0, fileName: 'f.mkv', trackers: ['udp://x.example:1', 'http://web.example/announce'] },
  pluginId: 'p', pluginName: 'p',
})

const live = (entries: Record<string, number>, extra: Partial<LiveSwarms> = {}): LiveSwarms => ({
  loading: false, unreachable: false,
  counts: new Map(Object.entries(entries).map(([h, n]) => [h.repeat(40).slice(0, 40), { seeders: n, leechers: 0 }])),
  ...extra,
})

afterEach(() => vi.unstubAllGlobals())

describe('ranking with verified seeds', () => {
  it('drops a source the plugin oversold and trusts the number checked now', () => {
    const list = [s('stale-120', 'a', 120), s('real-40', 'b', 15)]
    expect(rankStreams(list, 'auto', 'auto')[0].label).toBe('stale-120')
    const ranked = rankStreams(list, 'auto', 'auto', true, live({ a: 0, b: 40 }))
    expect(ranked.map((x) => x.label)).toEqual(['real-40', 'stale-120'])
    expect(liveSeeds(list[0], live({ a: 0 }))).toBe(0)
    expect(liveSeeds(list[1], live({ a: 0 }))).toBeNull()
  })
})

describe('fetchSwarmHealth', () => {
  it('asks only for torrents, with their UDP trackers, and reads the counts', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ asked: 5, answered: 3, swarms: { ['a'.repeat(40)]: { seeders: 7, leechers: 1 } } })))
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchSwarmHealth([s('one', 'a', 3)])
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.infoHashes).toEqual(['a'.repeat(40)])
    expect(body.trackers).toEqual(['udp://x.example:1'])
    expect(result.counts.get('a'.repeat(40))?.seeders).toBe(7)
    expect(result.unreachable).toBe(false)
  })

  it('flags a firewall when no tracker answered', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ asked: 5, answered: 0, swarms: {} }))))
    const result = await fetchSwarmHealth([s('one', 'a', 3)])
    expect(result.unreachable).toBe(true)
    expect(result.counts.size).toBe(0)
  })

  it('treats a cached answer as reachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ cached: true, swarms: { ['a'.repeat(40)]: { seeders: 2, leechers: 0 } } }))))
    const result = await fetchSwarmHealth([s('one', 'a', 3)])
    expect(result.unreachable).toBe(false)
    expect(result.counts.get('a'.repeat(40))?.seeders).toBe(2)
  })
})
