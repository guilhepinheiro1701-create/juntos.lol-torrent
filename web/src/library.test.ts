import { beforeEach, describe, expect, it } from 'vitest'
import { forget, library, libraryEntry, remember } from './library'

describe('library', () => {
  beforeEach(() => localStorage.clear())

  it('keeps what was downloaded and finds it again by room', () => {
    remember({ roomId: 'r1', jobId: 'j1', fileName: 'Duna.mkv', title: 'Duna' })

    expect(libraryEntry('r1')).toMatchObject({ roomId: 'r1', jobId: 'j1', title: 'Duna' })
    expect(libraryEntry('r2')).toBeNull()
  })

  it('replaces the record for a room rather than stacking a second one', () => {
    remember({ roomId: 'r1', jobId: 'j1', fileName: 'first.mkv' })
    remember({ roomId: 'r1', jobId: 'j2', fileName: 'second.mkv' })

    expect(library()).toHaveLength(1)
    expect(libraryEntry('r1')?.jobId).toBe('j2')
  })

  it('lists the newest download first', () => {
    remember({ roomId: 'old', jobId: 'j1', fileName: 'a.mkv' })
    remember({ roomId: 'new', jobId: 'j2', fileName: 'b.mkv' })
    // remember stamps Date.now(), which can land on the same millisecond here.
    const held = JSON.parse(localStorage.getItem('ss.library')!) as { roomId: string; savedAt: number }[]
    localStorage.setItem('ss.library', JSON.stringify(
      held.map((entry) => entry.roomId === 'old' ? { ...entry, savedAt: entry.savedAt - 10_000 } : entry),
    ))

    expect(library().map((entry) => entry.roomId)).toEqual(['new', 'old'])
  })

  it('forgets one room without touching the rest', () => {
    remember({ roomId: 'r1', jobId: 'j1', fileName: 'a.mkv' })
    remember({ roomId: 'r2', jobId: 'j2', fileName: 'b.mkv' })

    forget('r1')

    expect(libraryEntry('r1')).toBeNull()
    expect(libraryEntry('r2')).not.toBeNull()
  })

  // Anything can be in localStorage: another version of this page, a half
  // written value, a key someone edited by hand.
  it('reads nothing at all out of a corrupt store', () => {
    for (const raw of ['not json', '{}', '"a string"', '[1, 2, 3]', '[{"roomId":"r1"}]']) {
      localStorage.setItem('ss.library', raw)
      expect(library()).toEqual([])
    }
  })

  it('survives a store it cannot write to', () => {
    const setItem = localStorage.setItem
    localStorage.setItem = () => { throw new Error('quota') }
    expect(() => remember({ roomId: 'r1', jobId: 'j1', fileName: 'a.mkv' })).not.toThrow()
    localStorage.setItem = setItem
  })
})
