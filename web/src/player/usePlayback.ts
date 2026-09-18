import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { PlayState } from '../types'
import { expectedPositionMs, needsResync } from './position'

/**
 * Playback for one viewer, on this machine.
 *
 * This replaces the room socket without changing the shape the player talks
 * to: Player.tsx still calls send('play' | 'pause' | 'seek' | 'rate') and still
 * reads a PlayState back, because the gate, the cold-seek wait and the region
 * bookkeeping are all written against that protocol. What goes away is the
 * round trip — a command now lands on the element in the same tick instead of
 * travelling to a server and back, which is the whole point of playing locally.
 *
 * serverTimeMs keeps its name and holds Date.now(): with no server there is no
 * clock to correct against, so every consumer's offset is zero and
 * expectedPositionMs still extrapolates a playing state correctly.
 */
export interface PlaybackResult {
  state: PlayState
  buffering: boolean
  autoplayBlocked: boolean
  /** Always zero: local playback has no clock to correct against. */
  serverOffsetMs: number
  send: (type: string, payload?: Record<string, unknown>) => boolean
  reportBuffering: (stalled: boolean) => void
}

const initialState: PlayState = { playing: false, positionMs: 0, rate: 1, serverTimeMs: 0 }

/**
 * How long after a steer the element's own account of itself is ignored.
 * play() resolves a tick or more after it is called, and assigning currentTime
 * or playbackRate fires events straight away, so an element read back too soon
 * still describes where it was — and would undo the steer that just happened.
 */
const STEER_SETTLE_MS = 400

/** The rates the old room accepted; kept so a corrupt rate cannot wedge the
 * element the way it could not wedge the room. */
function validRate(rate: number): boolean {
  return Number.isFinite(rate) && rate >= 0.25 && rate <= 4
}

function readNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function usePlayback(
  videoRef: MutableRefObject<HTMLVideoElement | null>,
  mediaOffsetMsRef?: MutableRefObject<number>,
  coldWaitRef?: MutableRefObject<boolean>,
  remoteSteerAtRef?: MutableRefObject<number>,
  coldForRef?: MutableRefObject<((ms: number) => boolean) | null>,
): PlaybackResult {
  const [state, setState] = useState(initialState)
  const [buffering, setBuffering] = useState(false)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const bufferingRef = useRef(false)
  const steerAtRef = useRef(0)
  const stateRef = useRef(initialState)
  stateRef.current = state

  const mediaOffset = useCallback(() => mediaOffsetMsRef?.current ?? 0, [mediaOffsetMsRef])
  const coldWait = useCallback(() => coldWaitRef?.current ?? false, [coldWaitRef])
  const coldAt = useCallback((next: PlayState): boolean => {
    const judge = coldForRef?.current
    return judge ? judge(expectedPositionMs(next, Date.now())) : coldWait()
  }, [coldForRef, coldWait])

  /** Puts the element where the state says it should be. This is the old
   * socket's applyState, minus the socket: the element is steered from here,
   * never from a message, so the player's own echo suppression still sees a
   * steer it did not cause. */
  const applyState = useCallback((next: PlayState) => {
    setState(next)
    stateRef.current = next
    const media = videoRef.current
    if (!media) return
    steerAtRef.current = Date.now()
    if (remoteSteerAtRef) remoteSteerAtRef.current = Date.now()
    if (coldAt(next)) {
      if (!media.paused) media.pause()
      return
    }
    const expected = expectedPositionMs(next, Date.now())
    if (!bufferingRef.current && needsResync(media.currentTime * 1000 + mediaOffset(), expected)) {
      media.currentTime = (expected - mediaOffset()) / 1000
    }
    const rate = next.rate || 1
    if (media.playbackRate !== rate) media.playbackRate = rate
    if (next.playing && media.paused) {
      void media.play()
        .then(() => setAutoplayBlocked(false))
        .catch((error: unknown) => {
          // Only a refused gesture is worth reporting; anything else is a
          // load that has not settled yet and will play on its own.
          if (error instanceof DOMException && error.name === 'NotAllowedError') setAutoplayBlocked(true)
        })
    }
    if (!next.playing && !media.paused) {
      media.pause()
      setAutoplayBlocked(false)
    }
  }, [coldAt, mediaOffset, remoteSteerAtRef, videoRef])

  /** Applies one transport command, with the same rules the room applied:
   * a bad rate is ignored rather than obeyed, and a rate change keeps the
   * position it had reached. Returns true so callers written against the
   * socket's "queued or sent" answer read the same. */
  const send = useCallback((type: string, payload: Record<string, unknown> = {}): boolean => {
    const current = stateRef.current
    const next: PlayState = { ...current, serverTimeMs: Date.now() }
    const positionMs = readNumber(payload, 'positionMs')
    const rate = readNumber(payload, 'rate')
    switch (type) {
      case 'play':
        if (rate !== null && rate !== 0) {
          if (!validRate(rate)) return true
          next.rate = rate
        }
        next.playing = true
        if (positionMs !== null) next.positionMs = positionMs
        break
      case 'pause':
        if (rate !== null && rate !== 0) {
          if (!validRate(rate)) return true
          next.rate = rate
        }
        next.playing = false
        if (positionMs !== null) next.positionMs = positionMs
        break
      case 'seek':
        if (positionMs === null) return true
        next.positionMs = positionMs
        break
      case 'rate':
        if (rate === null || !validRate(rate)) return true
        next.positionMs = expectedPositionMs(current, next.serverTimeMs)
        next.rate = rate
        break
      default:
        // 'subtitles', 'heartbeat', 'ready' and the rest were things to tell
        // other people. There is nobody to tell.
        return true
    }
    applyState(next)
    return true
  }, [applyState])

  const reportBuffering = useCallback((stalled: boolean) => {
    if (bufferingRef.current === stalled) return
    bufferingRef.current = stalled
    setBuffering(stalled)
    if (stalled) return
    const media = videoRef.current
    if (!media || media.paused || coldWait()) return
    const expected = expectedPositionMs(stateRef.current, Date.now())
    if (needsResync(media.currentTime * 1000 + mediaOffset(), expected)) {
      media.currentTime = (expected - mediaOffset()) / 1000
    }
  }, [coldWait, mediaOffset, videoRef])

  /**
   * The element is the truth about where playback is; the state is a summary
   * of it. Keeping the summary in step matters because the player extrapolates
   * from it, and a long stall or a browser-side rate clamp would otherwise
   * leave it describing a position the viewer left minutes ago.
   */
  useEffect(() => {
    const media = videoRef.current
    if (!media) return
    const resample = () => {
      if (bufferingRef.current || coldWait()) return
      if (Date.now() - steerAtRef.current < STEER_SETTLE_MS) return
      const positionMs = Math.round(media.currentTime * 1000) + mediaOffset()
      const current = stateRef.current
      const expected = expectedPositionMs(current, Date.now())
      const playing = !media.paused && !media.ended
      if (playing === current.playing && !needsResync(positionMs, expected)) return
      const next: PlayState = { playing, positionMs, rate: media.playbackRate || 1, serverTimeMs: Date.now() }
      setState(next)
      stateRef.current = next
    }
    const events = ['play', 'pause', 'seeked', 'ratechange', 'ended'] as const
    for (const name of events) media.addEventListener(name, resample)
    const timer = window.setInterval(resample, 1000)
    return () => {
      window.clearInterval(timer)
      for (const name of events) media.removeEventListener(name, resample)
    }
  }, [coldWait, mediaOffset, videoRef])

  return { state, buffering, autoplayBlocked, serverOffsetMs: 0, send, reportBuffering }
}
