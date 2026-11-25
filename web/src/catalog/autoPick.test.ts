import { describe, expect, it } from 'vitest'
import { availableLanguages, availableQualities, rankStreams, sizeBytes } from './autoPick'
import { loadingProgress } from '../startProgress'
import type { CatalogStream } from './streams'

const s = (label: string, resolution: CatalogStream['resolution'], seeders: number | null, languages: string[] = [], size = ''): CatalogStream => ({
  quality: resolution, resolution, label, seeders, size, source: '', languages,
  location: { kind: 'torrent', infoHash: 'a'.repeat(40), fileIdx: 0, fileName: 'f.mkv', trackers: [] }, pluginId: 'p', pluginName: 'p',
})

describe('rankStreams', () => {
  const list = [
    s('4k-many', '2160p', 900),
    s('1080-dub', '1080p', 120, ['🇧🇷']),
    s('1080-orig', '1080p', 300),
    s('720-dub', '720p', 400, ['🇧🇷']),
    s('1080-dead', '1080p', 0, ['🇧🇷']),
    s('1080-remux', '1080p', 320, [], '58.2 GB'),
  ]

  it('auto prefers a healthy 1080p, dubbed when the viewer reads Portuguese', () => {
    expect(rankStreams(list, 'auto', 'auto', true)[0].label).toBe('1080-dub')
    expect(rankStreams(list, 'auto', 'auto', false)[0].label).toBe('1080-orig')
  })

  it('honours an explicit quality and language, and never leads with a dead torrent', () => {
    expect(rankStreams(list, '2160p', 'auto')[0].label).toBe('4k-many')
    expect(rankStreams(list, '720p', 'dubbed')[0].label).toBe('720-dub')
    expect(rankStreams(list, '1080p', 'original')[0].label).toBe('1080-orig')
    expect(rankStreams(list, '1080p', 'dubbed')[0].label).not.toBe('1080-dead')
  })

  it('lists what the title actually has', () => {
    expect(availableQualities(list)).toEqual(['2160p', '1080p', '720p'])
    expect(availableLanguages(list)).toEqual(['dubbed', 'original'])
    expect(sizeBytes('2,5 GB')).toBe(2.5 * 1024 ** 3)
    expect(sizeBytes('')).toBeNull()
  })
})

describe('loadingProgress', () => {
  it('only moves forward and stops promising once past the typical time', () => {
    const a = loadingProgress('connect', 2)
    const b = loadingProgress('connect', 10)
    expect(b.pct).toBeGreaterThan(a.pct)
    expect(loadingProgress('connect', 300).pct).toBeLessThanOrEqual(70)
    expect(loadingProgress('open', 1).pct).toBeGreaterThanOrEqual(70)
    expect(a.etaSeconds).toBeGreaterThan(b.etaSeconds ?? 0)
    expect(loadingProgress('connect', 40).etaSeconds).toBeNull()
  })
})

describe('rankStreams with seeds checked live', () => {
  const at = (label: string, hash: string, languages: string[] = []): CatalogStream => ({
    ...s(label, '1080p', 50, languages),
    location: { kind: 'torrent', infoHash: hash.repeat(40), fileIdx: 0, fileName: 'f.mkv', trackers: [] },
  })
  const list = [at('dub-one-seed', 'a', ['🇧🇷']), at('dub-one-seed-2', 'b', ['🇧🇷']), at('orig-alive', 'c')]
  const live = {
    loading: false, unreachable: false,
    counts: new Map([['a'.repeat(40), { seeders: 1, leechers: 1 }], ['b'.repeat(40), { seeders: 1, leechers: 0 }], ['c'.repeat(40), { seeders: 40, leechers: 9 }]]),
  }

  // O caso dos Simpsons: todas as dubladas com 1 seed, sem peer que conecte.
  it('puts a live original ahead of dubbed versions with a single seed, even when dubbed was asked', () => {
    expect(rankStreams(list, 'auto', 'dubbed', true, live)[0].label).toBe('orig-alive')
  })

  it('still prefers a dubbed version that is actually alive', () => {
    const alive = { ...live, counts: new Map(live.counts).set('a'.repeat(40), { seeders: 6, leechers: 1 }) }
    expect(rankStreams(list, 'auto', 'dubbed', true, alive)[0].label).toBe('dub-one-seed')
  })
})
