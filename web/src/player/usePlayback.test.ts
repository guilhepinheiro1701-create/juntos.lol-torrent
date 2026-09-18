import { act, renderHook } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlayback } from './usePlayback'

const NOW = 100_000

function makeVideo(paused = true) {
  const video = document.createElement('video')
  Object.defineProperty(video, 'paused', { value: paused, writable: true, configurable: true })
  video.play = vi.fn().mockResolvedValue(undefined)
  video.pause = vi.fn(() => { Object.defineProperty(video, 'paused', { value: true, writable: true, configurable: true }) })
  return video
}

describe('usePlayback', () => {
  beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(NOW) })
  afterEach(() => vi.restoreAllMocks())

  it('reports no clock offset, because there is no clock to correct against', () => {
    const videoRef: MutableRefObject<HTMLVideoElement | null> = { current: makeVideo() }
    const { result, unmount } = renderHook(() => usePlayback(videoRef))

    expect(result.current.serverOffsetMs).toBe(0)
    unmount()
  })

  it('only seeks when the drift is worth a seek', () => {
    const video = makeVideo()
    const videoRef: MutableRefObject<HTMLVideoElement | null> = { current: video }
    const { result, unmount } = renderHook(() => usePlayback(videoRef))

    video.currentTime = 30.1
    act(() => { result.current.send('seek', { positionMs: 30_000 }) })
    expect(video.currentTime).toBe(30.1)

    act(() => { result.current.send('seek', { positionMs: 45_000 }) })
    expect(video.currentTime).toBe(45)
    unmount()
  })

  it('plays and pauses the element in the same tick as the command', () => {
    const video = makeVideo()
    const videoRef: MutableRefObject<HTMLVideoElement | null> = { current: video }
    const { result, unmount } = renderHook(() => usePlayback(videoRef))

    act(() => { result.current.send('play', { positionMs: 0, rate: 1 }) })
    expect(video.play).toHaveBeenCalledOnce()
    expect(result.current.state).toMatchObject({ playing: true, positionMs: 0, rate: 1 })

    Object.defineProperty(video, 'paused', { value: false, writable: true, configurable: true })
    act(() => { result.current.send('pause', { positionMs: 12_000, rate: 1 }) })
    expect(video.pause).toHaveBeenCalled()
    expect(result.current.state).toMatchObject({ playing: false, positionMs: 12_000 })
    unmount()
  })

  it('refuses a rate the old room would have refused, and keeps the one it had', () => {
    const video = makeVideo()
    const videoRef: MutableRefObject<HTMLVideoElement | null> = { current: video }
    const { result, unmount } = renderHook(() => usePlayback(videoRef))

    act(() => { result.current.send('rate', { rate: 2 }) })
    expect(result.current.state.rate).toBe(2)

    for (const rate of [0, 0.1, 8, Number.NaN, Number.POSITIVE_INFINITY]) {
      act(() => { result.current.send('rate', { rate }) })
      expect(result.current.state.rate).toBe(2)
    }
    unmount()
  })

  it('keeps the position a rate change found it at', () => {
    const video = makeVideo()
    const videoRef: MutableRefObject<HTMLVideoElement | null> = { current: video }
    const { result, unmount } = renderHook(() => usePlayback(videoRef))

    act(() => { result.current.send('play', { positionMs: 10_000, rate: 1 }) })
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 4_000)
    act(() => { result.current.send('rate', { rate: 2 }) })

    // Four seconds of playing at 1x, then the rate changes: the clock restarts
    // from where it had actually reached, not from where the play began.
    expect(result.current.state.positionMs).toBe(14_000)
    expect(result.current.state.rate).toBe(2)
    unmount()
  })

  it('does not steer the element while it is waiting on a cold region', () => {
    const video = makeVideo()
    Object.defineProperty(video, 'paused', { value: false, writable: true, configurable: true })
    video.currentTime = 5
    const videoRef: MutableRefObject<HTMLVideoElement | null> = { current: video }
    const coldWaitRef = { current: true }
    const { result, unmount } = renderHook(() => usePlayback(videoRef, undefined, coldWaitRef))

    act(() => { result.current.send('seek', { positionMs: 600_000 }) })
    expect(video.currentTime).toBe(5)
    expect(video.pause).toHaveBeenCalled()
    unmount()
  })

  it('leaves the element alone while it is stalled, and catches it up once it is not', () => {
    const video = makeVideo()
    const videoRef: MutableRefObject<HTMLVideoElement | null> = { current: video }
    const { result, unmount } = renderHook(() => usePlayback(videoRef))

    act(() => { result.current.send('play', { positionMs: 30_000, rate: 1 }) })
    Object.defineProperty(video, 'paused', { value: false, writable: true, configurable: true })
    video.currentTime = 30

    act(() => { result.current.reportBuffering(true) })
    expect(result.current.buffering).toBe(true)

    act(() => { result.current.send('seek', { positionMs: 90_000 }) })
    expect(video.currentTime).toBe(30)

    act(() => { result.current.reportBuffering(false) })
    expect(result.current.buffering).toBe(false)
    expect(video.currentTime).toBe(90)
    unmount()
  })

  it('carries the media offset, so a region that does not start at zero still lands', () => {
    const video = makeVideo()
    video.currentTime = 0
    const videoRef: MutableRefObject<HTMLVideoElement | null> = { current: video }
    const mediaOffsetMsRef = { current: 500_000 }
    const { result, unmount } = renderHook(() => usePlayback(videoRef, mediaOffsetMsRef))

    act(() => { result.current.send('seek', { positionMs: 530_000 }) })
    expect(video.currentTime).toBe(30)
    unmount()
  })

  it('ignores the messages that only ever had other people to reach', () => {
    const video = makeVideo()
    const videoRef: MutableRefObject<HTMLVideoElement | null> = { current: video }
    const { result, unmount } = renderHook(() => usePlayback(videoRef))

    act(() => { result.current.send('play', { positionMs: 7_000, rate: 1 }) })
    const before = result.current.state

    for (const type of ['chat', 'subtitles', 'heartbeat', 'ready', 'titleRequest', 'stillHere']) {
      act(() => { expect(result.current.send(type, { positionMs: 999_000 })).toBe(true) })
    }
    expect(result.current.state).toBe(before)
    unmount()
  })

  it('marks autoplay blocked when the browser refuses the gesture', async () => {
    const video = makeVideo()
    video.play = vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError'))
    const videoRef: MutableRefObject<HTMLVideoElement | null> = { current: video }
    const { result, unmount } = renderHook(() => usePlayback(videoRef))

    await act(async () => { result.current.send('play', { positionMs: 0, rate: 1 }) })
    expect(result.current.autoplayBlocked).toBe(true)
    unmount()
  })

  // A play() that loses to the next load rejects too, and saying "your browser
  // blocked this" over that would be a lie the viewer cannot act on.
  it('does not blame autoplay for a play the loader interrupted', async () => {
    const video = makeVideo()
    video.play = vi.fn().mockRejectedValue(new DOMException('interrupted', 'AbortError'))
    const videoRef: MutableRefObject<HTMLVideoElement | null> = { current: video }
    const { result, unmount } = renderHook(() => usePlayback(videoRef))

    await act(async () => { result.current.send('play', { positionMs: 0, rate: 1 }) })
    expect(result.current.autoplayBlocked).toBe(false)
    unmount()
  })
})
