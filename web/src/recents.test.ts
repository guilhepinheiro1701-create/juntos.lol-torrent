import { beforeEach, describe, expect, it } from 'vitest'
import { forgetRecent, isFinished, notePosition, readRecents, recentFor, rememberStart, takeResumeAt } from './recents'
import { episodePick, nextVideo, sameSource } from './catalog/ContinueCard'
import type { TitlePick } from './catalog/MetaDetails'
import type { CatalogStream } from './catalog/streams'

const stream = (pluginId: string, resolution: CatalogStream['resolution']): CatalogStream => ({
  quality: resolution, resolution, label: `${pluginId} ${resolution}`, seeders: 10, size: '', source: '', languages: [],
  location: { kind: 'torrent', infoHash: 'a'.repeat(40), fileIdx: 0, fileName: 'f.mkv', trackers: [] }, pluginId, pluginName: pluginId,
})
const pick = (season?: number, episode?: number): TitlePick => ({
  stream: stream('br', '1080p'),
  target: season ? { type: 'series', id: 'tt1', season, episode } : { type: 'movie', id: 'tt9' },
  displayName: 'X', metaName: 'Show', poster: 'p.jpg', catalog: { id: 'tmdb:1', type: season ? 'series' : 'movie', background: 'b.jpg' },
})

beforeEach(() => localStorage.clear())

describe('recents', () => {
  it('remembers the source and the position, and finds the title by either id', () => {
    rememberStart('room1', pick(1, 3))
    notePosition('room1', 600_000, 2_700_000)
    const entry = recentFor('series', ['tmdb:1'])
    expect(entry?.positionMs).toBe(600_000)
    expect(entry?.pick.stream.pluginId).toBe('br')
    expect(recentFor('series', ['tt1'])?.episode).toBe(3)
  })

  it('keeps the position when the same episode starts again, resets it for another', () => {
    rememberStart('r1', pick(1, 3))
    notePosition('r1', 600_000, 2_700_000)
    rememberStart('r2', pick(1, 3), 600_000)
    expect(takeResumeAt('r2')).toBe(600_000)
    expect(takeResumeAt('r2')).toBe(0)
    rememberStart('r3', pick(1, 4))
    expect(readRecents()[0].positionMs).toBe(0)
    expect(readRecents()).toHaveLength(1)
  })

  it('counts the credits as finished', () => {
    expect(isFinished({ positionMs: 2_600_000, durationMs: 2_700_000 })).toBe(true)
    expect(isFinished({ positionMs: 600_000, durationMs: 2_700_000 })).toBe(false)
    expect(isFinished({ positionMs: 600_000, durationMs: 0 })).toBe(false)
  })

  it('forgets', () => {
    rememberStart('r', pick())
    forgetRecent(readRecents()[0].key)
    expect(readRecents()).toEqual([])
  })
})

describe('continue helpers', () => {
  it('prefers the same plugin at the same resolution', () => {
    const list = [stream('other', '1080p'), stream('br', '720p'), stream('br', '1080p')]
    expect(sameSource(list, stream('br', '1080p'))?.label).toBe('br 1080p')
    expect(sameSource([stream('other', '720p'), stream('x', '1080p')], stream('br', '1080p'))?.label).toBe('x 1080p')
  })

  it('walks to the next episode across seasons', () => {
    const videos = [{ id: 'a', season: 1, episode: 2, name: '' }, { id: 'b', season: 2, episode: 1, name: '' }, { id: 'c', season: 1, episode: 1, name: '' }]
    expect(nextVideo(videos, 1, 2)?.id).toBe('b')
    expect(nextVideo(videos, 2, 1)).toBeNull()
    rememberStart('r', pick(1, 2))
    const next = episodePick(readRecents()[0], videos[1], stream('br', '1080p'))
    expect(next.target).toMatchObject({ season: 2, episode: 1 })
    expect(next.displayName).toBe('Show S02E01')
  })
})
