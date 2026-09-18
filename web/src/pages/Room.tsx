import { LayoutGroup } from 'motion/react'
import { JlocalDownload, JlocalStatus } from '../components/JlocalPill'
import { useJLocal } from '../jlocal/status'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChaptersPanel } from '../player/ChaptersPanel'
import { StatusPill } from '../components/StatusPill'
import { CopyErrorReport } from '../components/CopyErrorReport'
import { UploadAvailability, type OpeningWait } from '../components/UploadAvailability'
import { Compass, Download, HardDriveDownload, Replace, Upload } from 'lucide-react'
import { YoutubeGlyph } from '../ui/YoutubeGlyph'
import { useT, type Translator } from '../i18n/useT'
import { Player, regionHolds } from '../player/Player'
import { usePlayback } from '../player/usePlayback'
import { IconButton } from '../ui/IconButton'
import { MorphPanel } from '../ui/MorphPanel'
import { MorphingMenu } from '../ui/MorphingMenu'
import { useMorphingStep } from '../ui/useMorphingStep'
import { Dialog, DialogContent } from '../ui/Dialog'
import { useToast } from '../ui/toastContext'
import type { RoomInfo } from '../types'
import type { OverlayFocus } from '../catalog/CatalogOverlay'
const CatalogOverlay = lazy(() => import('../catalog/CatalogOverlay').then((module) => ({ default: module.CatalogOverlay })))
import { openCatalogStream } from '../catalog/openStream'
import { WorkerProbes } from '../components/WorkerProbes'
import type { TitlePick } from '../catalog/MetaDetails'
import { NextEpisodeCard } from '../catalog/NextEpisode'
import { nowPlayingFromPick, nowPlayingKey, useNextEpisode, type NowPlaying } from '../catalog/useNextEpisode'
import { TorrentPicker } from '../components/TorrentPicker'
import { YoutubePicker } from '../components/YoutubePicker'
import { YoutubeError, isYoutubeError, openYoutube, youtubeErrorKey, youtubeErrorRetryable, type YoutubeSession } from '../youtube'
import { PipelineChip } from '../components/PipelineChip'
import { openTorrent, type TorrentSession, type TorrentVideoFile, type WorkerProbe } from '../torrent'
import { isTorrentError, torrentErrorKey, torrentErrorRetryable } from '../torrentErrors'
import { MAX_UPLOAD_BYTES } from '../limits'
import {
  FILE_UNREADABLE,
  SOURCE_UNREACHABLE,
  UNSUPPORTED_MEDIA,
  WORKER_UNREACHABLE,
  REMUX_UNAVAILABLE,
  assertReadable,
  changeRoomSource,
  lastUploadFailureDetail,
  subscribeUploadDone,
  subscribeUploadProgress,
  startFileUpload,
  isRemoteProduction,
  startTorrentUpload,
  startUrlUpload,
  startYoutubeUpload,
  youtubeFileName,
  type RoomUploadProgress,
  remuxHandleFor,
  torrentStatsFor,
  uploadActive,
  resumableSourceFor,
  clearResumableSource,
  ownerTokenFor,
  torrentJobFor,
} from '../upload'
import { expectedPositionMs } from '../player/position'
import { keepTorrent, reportPosition, torrentKept } from '../remoteTorrent'
import { forget, libraryEntry, remember } from '../library'
import type { TorrentStats } from '../torrent'

const PREPARING_POLL_MS = 3_000
// Often enough that the fleet follows a seek without a wait anyone notices,
// rare enough that a film playing straight through is nearly silent.
const POSITION_REPORT_MS = 10_000
// How long a pipeline may go quiet before the room counts as unproduced: long
// enough to outlast a cold seek, well short of the server's claim sweep.
const PRODUCER_ALIVE_MS = 90_000

export function RoomPage() {
  const { id = '' } = useParams()
  const [room, setRoom] = useState<RoomInfo | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/rooms/${encodeURIComponent(id)}`, { signal: controller.signal }).then(async (response) => {
      if (response.status === 404) { setMissing(true); return }
      if (!response.ok) throw new Error('room request failed')
      setRoom(await response.json() as RoomInfo)
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setMissing(true)
    })
    return () => controller.abort()
  }, [id])

  const waiting: GateStep = missing ? 'expired' : !room ? 'connecting' : null
  if (waiting !== null) return <RoomGate step={waiting} />
  return <ConnectedRoom room={room!} />
}

type GateStep = 'connecting' | 'expired' | 'preparing' | 'buffering' | 'failed' | 'error' | null

/** One panel that changes what it asks for, rather than swapping screens. */
function RoomGate({ step, room, progress, preparation, swarm, wait, overlay = false, leaving = false, failure, errorMessage }: {
  step: GateStep
  room?: RoomInfo
  progress?: RoomUploadProgress | null
  preparation?: RoomInfo['preparation']
  swarm?: TorrentStats | null
  wait?: OpeningWait | null
  /** Laid over the room rather than in place of it. */
  overlay?: boolean
  leaving?: boolean
  failure?: string | null
  errorMessage?: string
}) {
  const t = useT()
  const { shown, morphing } = useMorphingStep(step)
  return (
    <main className={`center-state${overlay ? ' gate-overlay' : ''}${leaving ? ' is-leaving' : ''}`}>
      <MorphPanel className="gate-panel raised" sizeKey={shown} morphing={morphing}>
        {shown === 'connecting' ? (
          <div className="gate-centered">
            <span className="stage-spinner" aria-hidden="true" />
            <StatusPill status="connecting" label={t('status.connecting')} />
          </div>
        ) : null}

        {shown === 'preparing' || shown === 'buffering' ? (
          <UploadAvailability progress={progress ?? null} preparation={preparation} swarm={swarm} wait={shown === 'buffering' ? wait ?? { secondsLeft: null, cold: false } : null} t={t} />
        ) : null}

        {shown === 'expired' ? (
          <div className="gate-centered">
            <h1>{t('room.expired')}</h1>
            <Link className="primary-button" to="/">{t('room.new')}</Link>
          </div>
        ) : null}

        {shown === 'failed' ? (
          <div className="gate-centered gate-bad">
            <h1>{t('room.uploadFailed')}</h1>
            {failure === FILE_UNREADABLE ? <p>{t('error.fileChanged')}</p> : null}
            {failure === UNSUPPORTED_MEDIA ? <p>{t('error.unsupportedMedia')}</p> : null}
            {failure === SOURCE_UNREACHABLE ? <p>{t('error.sourceUnreachable')}</p> : null}
            {failure === WORKER_UNREACHABLE ? <p>{t('error.workerUnreachable')}</p> : null}
            {failure === REMUX_UNAVAILABLE ? <p>{t('error.remuxUnavailable')}</p> : null}
            <Link className="primary-button" to="/">{t('room.new')}</Link>
            {room ? <CopyErrorReport room={room} failure={failure ?? null} detail={lastUploadFailureDetail()} t={t} /> : null}
          </div>
        ) : null}

        {shown === 'error' ? (
          <div className="gate-centered gate-bad">
            <h1>{t('room.error')}</h1>
            {errorMessage ? <p>{errorMessage}</p> : null}
            <Link className="primary-button" to="/">{t('room.new')}</Link>
            {room ? <CopyErrorReport room={room} failure={errorMessage ?? 'server'} detail={lastUploadFailureDetail()} t={t} /> : null}
          </div>
        ) : null}
      </MorphPanel>
    </main>
  )
}

function ConnectedRoom({ room }: { room: RoomInfo }) {
  const jlocal = useJLocal()
  const t = useT()
  const videoRef = useRef<HTMLVideoElement>(null)
  const mediaOffsetMsRef = useRef(0)
  const playerSeekRef = useRef<((seconds: number) => void) | null>(null)
  const coldWaitRef = useRef(false)
  const coldForRef = useRef<((ms: number) => boolean) | null>(null)
  const remoteSteerAtRef = useRef(0)
  const sync = usePlayback(videoRef, mediaOffsetMsRef, coldWaitRef, remoteSteerAtRef, coldForRef)
  const { toast } = useToast()
  const [liveRoom, setLiveRoom] = useState(room)
  if (!liveRoom.mediaRegions || liveRoom.mediaRegions.length === 0) {
    mediaOffsetMsRef.current = liveRoom.mediaOffsetMs ?? 0
  }
  const [localSwarm, setLocalSwarm] = useState<TorrentStats | null>(null)
  useEffect(() => {
    const read = () => setLocalSwarm(torrentStatsFor(room.id))
    read()
    const timer = window.setInterval(read, 1_000)
    return () => window.clearInterval(timer)
  }, [room.id])
  const reported = liveRoom.preparation?.swarm
  const swarmStats: TorrentStats | null = useMemo(() => localSwarm ?? (reported ? {
    peers: reported.peers,
    downloadSpeed: reported.downSpeed,
    downloaded: reported.haveBytes,
    diskBytes: reported.diskBytes,
    progress: reported.selectedBytes > 0 ? Math.min(reported.haveBytes / reported.selectedBytes, 1) : 0,
  } : null), [localSwarm, reported])
  const resumeWanted = sync.state ? expectedPositionMs(sync.state, Date.now()) : null
  const liveRegions = liveRoom.mediaRegions ?? []
  const producing = liveRoom.producerHeartbeatMs !== undefined
    && Date.now() - liveRoom.producerHeartbeatMs < PRODUCER_ALIVE_MS
  const needsPreparo = !producing
    && (liveRoom.status !== 'ready'
      || (resumeWanted !== null && liveRegions.length > 0
        && resumeWanted < (liveRoom.durationMs || Number.POSITIVE_INFINITY)
        && !liveRegions.some((region) => regionHolds(region, resumeWanted))))
  const resumeTried = useRef(false)
  useEffect(() => {
    if (resumeTried.current || !ownerTokenFor(room.id)) return
    if (!needsPreparo) return
    if (room.sourceKind !== 'upload') { resumeTried.current = true; return }
    // The fleet's first heartbeat lands seconds after the handoff; the tab that
    // made it must not read that silence as a preparo to resume.
    if (uploadActive(room.id) || remuxHandleFor(room.id) || isRemoteProduction(room.id)) return
    const source = resumableSourceFor(room.id)
    if (!source) { resumeTried.current = true; return }
    resumeTried.current = true
    toast(t('room.resuming'))
    void (async () => {
      try {
        if (source.kind === 'url') {
          const next = await changeRoomSource(room.id, 'upload', source.fileName)
          startUrlUpload(room.id, next.mediaGeneration, source.url ?? '', source.fileName, source.size ?? 0)
          return
        }
        if (source.kind === 'youtube') {
          const session = await openYoutube(source.url ?? '')
          try {
            const next = await changeRoomSource(room.id, 'youtube', youtubeFileName(session))
            startYoutubeUpload(room.id, next.mediaGeneration, session)
          } catch (error) {
            session.destroy()
            throw error
          }
          return
        }
        const session = await openTorrent(source.magnet ?? '')
        const file = session.files.find((candidate) => candidate.path === source.filePath) ?? session.files[0]
        if (!file) {
          session.destroy()
          throw new Error('resumable file missing from torrent')
        }
        await session.select(file.path)
        try {
          const next = await changeRoomSource(room.id, 'upload', file.name)
          startTorrentUpload(room.id, next.mediaGeneration, { file, session })
        } catch (error) {
          session.destroy()
          throw error
        }
      } catch (error) {
        console.error('resume preparation failed', error)
        toast(t('room.resumeFailed'))
        if (!torrentErrorRetryable(error) || !youtubeErrorRetryable(error)) clearResumableSource(room.id)
      }
    })()
  }, [needsPreparo, room.id, room.sourceKind, t, toast])
  const [sidePanel, setSidePanel] = useState<'chapters' | null>(null)
  const [uploadProgress, setUploadProgress] = useState<RoomUploadProgress | null>(null)
  const [uploadFailed, setUploadFailed] = useState<string | null>(null)
  const mediaStatus = liveRoom.status
  const [sourcePanel, setSourcePanel] = useState<'torrent' | 'youtube' | null>(null)
  // The torrent the room is playing now, when this browser is the one that
  // opened it: the picker lists it again as a playlist instead of asking.
  const playlist = useMemo(() => {
    if (sourcePanel !== 'torrent' || liveRoom.sourceOrigin !== 'torrent') return null
    const source = resumableSourceFor(room.id)
    if (!source || source.kind !== 'torrent' || !source.magnet || source.fileName !== liveRoom.fileName) return null
    return { magnet: source.magnet, filePath: source.filePath }
  }, [sourcePanel, liveRoom.sourceOrigin, liveRoom.fileName, room.id])
  const [sourceError, setSourceError] = useState<string>('')
  const [swapProbes, setSwapProbes] = useState<WorkerProbe[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  // A stage room paints a relay broadcast: no player, no timeline, no buffering gate.
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [catalogFocus, setCatalogFocus] = useState<OverlayFocus | null>(null)
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(nowPlayingKey(room.id)) ?? 'null') as NowPlaying | null
    } catch {
      return null
    }
  })
  const gate: GateStep = uploadFailed !== null ? 'failed'
    : mediaStatus === 'processing' || mediaStatus === 'uploading' ? 'preparing'
    : mediaStatus === 'error' ? 'error'
    : null
  const { shown: shownGate } = useMorphingStep(gate)
  const [opening, setOpening] = useState(true)
  const [openingWait, setOpeningWait] = useState<OpeningWait | null>(null)
  useEffect(() => {
    if (gate === 'preparing') { setOpening(true); setOpeningWait(null) }
  }, [gate])
  const onWait = useCallback((wait: OpeningWait) => {
    setOpeningWait(wait)
    if (wait.secondsLeft === null && !wait.cold) setOpening(false)
  }, [])
  const openingGate: GateStep = opening && mediaStatus === 'ready' ? 'buffering' : null
  const { shown: shownOpening } = useMorphingStep(openingGate)

  const swapSource = async (run: () => Promise<void>) => {
    setSourceError('')
    setSourcePanel(null)
    setSwapProbes([])
    try {
      await run()
    } catch (error) {
      console.error('change source failed', error)
      setSourceError(isTorrentError(error) ? torrentErrorKey(error) : isYoutubeError(error) ? youtubeErrorKey(error) : 'room.changeFailed')
    }
  }

  const chooseFile = (file?: File) => {
    if (!file) return
    void swapSource(async () => {
      await assertReadable(file)
      const next = await changeRoomSource(room.id, 'upload', file.name)
      startFileUpload(room.id, next.mediaGeneration, file)
    })
  }

  const chooseTorrent = (file: TorrentVideoFile, session: TorrentSession) => {
    void swapSource(async () => {
      let next
      try {
        next = await changeRoomSource(room.id, 'upload', file.name)
      } catch (error) {
        session.destroy()
        throw error
      }
      startTorrentUpload(room.id, next.mediaGeneration, { file, session })
    })
  }

  const chooseYoutube = (session: YoutubeSession) => {
    void swapSource(async () => {
      if (session.summary.live) {
        // Ao vivo só tocava pelo relay MoQ, que não existe na versão local.
        session.destroy()
        setSourceError('changeFailed')
        return
      }
      let next
      try {
        next = await changeRoomSource(room.id, 'youtube', youtubeFileName(session))
      } catch (error) {
        session.destroy()
        throw error
      }
      startYoutubeUpload(room.id, next.mediaGeneration, session)
    })
  }

  const chooseCatalogStream = (pick: TitlePick) => {
    setCatalogOpen(false)
    setCatalogFocus(null)
    const playing = nowPlayingFromPick(pick)
    setNowPlaying(playing)
    try {
      if (playing) localStorage.setItem(nowPlayingKey(room.id), JSON.stringify(playing))
      else localStorage.removeItem(nowPlayingKey(room.id))
    } catch {}
    void swapSource(async () => {
      if (pick.stream.location.kind === 'url') {
        const { url } = pick.stream.location
        const next = await changeRoomSource(room.id, 'upload', pick.displayName)
        startUrlUpload(room.id, next.mediaGeneration, url, `${pick.displayName}.mkv`, 0)
        return
      }
      const opened = await openCatalogStream(pick.stream, pick.target, undefined, { onProbe: setSwapProbes })
      try {
        const next = await changeRoomSource(room.id, 'upload', pick.displayName)
        startTorrentUpload(room.id, next.mediaGeneration, opened)
      } catch (error) {
        opened.session.destroy()
        throw error
      }
    })
  }

  const preparing = mediaStatus === 'uploading' || mediaStatus === 'processing'
  // The room used to push its own changes down the socket: a status, a media
  // patch, a version bump that asked the page to refetch. With one viewer and
  // no socket, the page asks instead. It asks while there is something to
  // watch — a preparo running, or a pipeline still writing regions behind a
  // room that already plays — and stops once the room has settled, so a
  // finished film is not refetched every three seconds forever.
  const watching = preparing || producing
  useEffect(() => {
    if (!watching) return
    const controller = new AbortController()
    const read = () => {
      void fetch(`/api/rooms/${encodeURIComponent(room.id)}`, { signal: controller.signal })
        .then(async (response) => { if (response.ok) setLiveRoom(await response.json() as RoomInfo) })
        .catch(() => undefined)
    }
    read()
    const timer = window.setInterval(read, PREPARING_POLL_MS)
    return () => { window.clearInterval(timer); controller.abort() }
  }, [watching, room.id])

  useEffect(() => {
    remuxHandleFor(room.id)?.follow(expectedPositionMs(sync.state, Date.now()))
  }, [room.id, sync.state])

  // The socket used to tell the server where playback was, which is how the
  // fleet knew to produce from a seek it had not reached yet, and how the
  // server knew the room was still being watched. Both now ride on this, on a
  // timer: a report per seek would be noise, and the server debounces anyway.
  const positionRef = useRef(sync.state)
  positionRef.current = sync.state
  useEffect(() => {
    const tell = () => { void reportPosition(room.id, expectedPositionMs(positionRef.current, Date.now())) }
    tell()
    const timer = window.setInterval(tell, POSITION_REPORT_MS)
    return () => { window.clearInterval(timer); tell() }
  }, [room.id])

  useEffect(() => subscribeUploadProgress(room.id, setUploadProgress), [room.id, liveRoom.mediaGeneration])
  useEffect(() => {
    setUploadFailed(null)
    return subscribeUploadDone(room.id, (error) => {
      setUploadProgress(null)
      if (error) setUploadFailed(error)
    })
  }, [room.id, liveRoom.mediaGeneration])

  const nextEpisode = useNextEpisode(
    nowPlaying,
    videoRef,
    mediaStatus === 'ready',
    chooseCatalogStream,
  )

  if (shownGate !== null) {
    return (
      <RoomGate
        step={gate}
        room={liveRoom}
        progress={uploadProgress}
        preparation={liveRoom.preparation}
        swarm={swarmStats}
        failure={uploadFailed}
        errorMessage={liveErrorText(liveRoom.errorMessage, t)}
      />
    )
  }

  return (
    <>
    {shownOpening !== null ? (
      <RoomGate
        overlay
        leaving={openingGate === null}
        step={openingGate}
        room={liveRoom}
        preparation={liveRoom.preparation}
        swarm={swarmStats}
        wait={openingWait}
      />
    ) : null}
    <main className="room-shell room-enter">
      <header className="room-header">
        <LayoutGroup id="jlocal">
        <div className="room-heading"><span className="room-file">{liveRoom.fileName}</span><JlocalStatus status={jlocal} t={t} /></div>
        <div className="header-actions">
          {(uploadProgress !== null || swarmStats !== null || mediaStatus === 'ready')
            ? <PipelineChip swarm={swarmStats} progress={uploadProgress} remote={isRemoteProduction(room.id)} videoRef={videoRef} t={t} />
            : null}
          {uploadFailed !== null ? <span className="upload-chip is-error">{t('room.uploadFailed')}</span> : null}
          <StatusPill status={sync.buffering ? 'buffering' : 'live'} label={t(sync.buffering ? 'status.buffering' : 'status.live')} />
          <MediaSwitch
            t={t}
            onOpen={() => setSourceError('')}
            onCatalog={() => { setCatalogFocus(null); setCatalogOpen(true) }}
            onTorrent={() => setSourcePanel('torrent')}
            onYoutube={() => setSourcePanel('youtube')}
            onFile={() => fileInputRef.current?.click()}
          />
          <KeepButton roomId={room.id} fileName={liveRoom.fileName} nowPlaying={nowPlaying} t={t} />
          <JlocalDownload status={jlocal} t={t} />
        </div>
        </LayoutGroup>
      </header>
      <div className={`room-layout ${sidePanel !== null ? 'chat-open' : ''}`}>
        <section className="media-column">
          {(
            <Player
              room={liveRoom}
              isController
              videoRef={videoRef}
              send={sync.send}
              t={t}
              syncState={sync.state}
              serverOffsetMs={sync.serverOffsetMs}
              swarm={swarmStats}
              mediaOffsetMsRef={mediaOffsetMsRef}
              seekRef={playerSeekRef}
              coldWaitRef={coldWaitRef}
              coldForRef={coldForRef}
              remoteSteerAtRef={remoteSteerAtRef}
              autoplayBlocked={sync.autoplayBlocked}
              onBuffering={sync.reportBuffering}
              onWait={onWait}
              onChapters={() => setSidePanel((panel) => panel === 'chapters' ? null : 'chapters')}
              overlay={
                <>
                  {nextEpisode.pending && nowPlaying ? (
                    <NextEpisodeCard
                      video={nextEpisode.pending.video}
                      poster={nowPlaying.poster}
                      seconds={nextEpisode.seconds}
                      onPlayNow={nextEpisode.playNow}
                      onDismiss={nextEpisode.dismiss}
                    />
                  ) : null}
                </>
              }
            />
          )}
        </section>
        {sidePanel === 'chapters' ? (
          <ChaptersPanel
            chapters={liveRoom.chapters ?? []}
            open
            onClose={() => setSidePanel(null)}
            onSeek={(seconds) => {
              const throughPlayer = playerSeekRef.current
              if (throughPlayer) throughPlayer(seconds)
              else sync.send('seek', { positionMs: Math.round(seconds * 1000) })
            }}
            videoRef={videoRef}
            t={t}
          />
        ) : null}
      </div>
      <input
        ref={fileInputRef}
        hidden
        type="file"
        accept="video/*,.mkv"
        onChange={(event) => chooseFile(event.target.files?.[0])}
      />
      {swapProbes.length > 0 && shownGate === 'preparing' ? <div className="swap-probes"><WorkerProbes probes={swapProbes} t={t} /></div> : null}
      {sourceError ? <div className="error-card compact" role="alert">{t(sourceError)}</div> : null}
      {catalogOpen ? (
        <Suspense fallback={null}>
          <CatalogOverlay
            mode="host"
            focus={catalogFocus}
            onClose={() => { setCatalogOpen(false); setCatalogFocus(null) }}
            onPickStream={chooseCatalogStream}
          />
        </Suspense>
      ) : null}
      <Dialog open={sourcePanel !== null} onOpenChange={(open) => { if (!open) setSourcePanel(null) }}>
        {sourcePanel !== null ? (
          <DialogContent
            className="torrent-dialog"
            closeLabel={t('home.closeDialog')}
            hideTitle
            title={t(sourcePanel === 'youtube' ? 'home.youtubeTitle' : 'home.torrentTitle')}
          >
            {sourcePanel === 'youtube' ? (
              <YoutubePicker
                t={t}
                onExit={() => setSourcePanel(null)}
                onPicked={(session) => { setSourcePanel(null); chooseYoutube(session) }}
              />
            ) : (
              <TorrentPicker
                maxFileBytes={MAX_UPLOAD_BYTES}
                t={t}
                onExit={() => setSourcePanel(null)}
                onYoutubeLink={() => setSourcePanel('youtube')}
                onPicked={chooseTorrent}
                initialMagnet={playlist?.magnet}
                autoLoad={playlist !== null}
                currentPath={playlist?.filePath}
              />
            )}
          </DialogContent>
        ) : null}
      </Dialog>
    </main>
    </>
  )
}

// The film icon marks whose computer the video is on; for the controller, a
// right-click opens what can be done to that person.

/**
 * Keeping a title on disk, and giving the space back.
 *
 * Watching already puts the bytes on the worker — that is what the sliding
 * window is for — but the worker takes them back the moment the session cools:
 * the reaper, the quota eviction and shed_fill all exist to reclaim space.
 * This asks it not to, which is the whole difference between watching
 * something and having it.
 *
 * The state comes from the worker, not from what this browser wrote down: the
 * two disagree after a cleared site, a reinstall, or a keep made elsewhere,
 * and the worker is the one holding the file.
 */
function KeepButton({ roomId, fileName, nowPlaying, t }: {
  roomId: string
  fileName: string
  nowPlaying: NowPlaying | null
  t: Translator
}) {
  const { toast } = useToast()
  const [jobId, setJobId] = useState(() => torrentJobFor(roomId) || libraryEntry(roomId)?.jobId || '')
  const [kept, setKept] = useState<boolean | null>(null)
  const [working, setWorking] = useState(false)

  // The job arrives with the preparo, which may still be in flight when the
  // room paints, so the id is looked for until it turns up.
  useEffect(() => {
    if (jobId) return
    const look = () => {
      const found = torrentJobFor(roomId) || libraryEntry(roomId)?.jobId || ''
      if (found) setJobId(found)
    }
    const timer = window.setInterval(look, 1_000)
    return () => window.clearInterval(timer)
  }, [jobId, roomId])

  useEffect(() => {
    if (!jobId) return
    let disposed = false
    void torrentKept(jobId).then((on) => {
      if (disposed) return
      setKept(on)
      // The worker has the last word: a title it is no longer holding leaves
      // the library rather than sitting there as a promise it cannot keep.
      if (!on) forget(roomId)
    })
    return () => { disposed = true }
  }, [jobId, roomId])

  if (!jobId) return null

  const toggle = async () => {
    const next = !kept
    setWorking(true)
    try {
      await keepTorrent(jobId, next)
    } catch (error) {
      console.error('keep failed', error)
      toast(t('room.keepFailed'))
      setWorking(false)
      return
    }
    if (next) {
      remember({
        roomId, jobId, fileName,
        title: nowPlaying?.name,
        poster: nowPlaying?.poster,
        magnet: resumableSourceFor(roomId)?.magnet,
        filePath: resumableSourceFor(roomId)?.filePath,
      })
    } else {
      forget(roomId)
    }
    setKept(next)
    setWorking(false)
    toast(t(next ? 'room.keptToast' : 'room.releasedToast'))
  }

  return (
    <IconButton
      icon={kept ? <HardDriveDownload size={16} /> : <Download size={16} />}
      label={t(kept ? 'room.keptLabel' : 'room.keepLabel')}
      className={kept ? 'is-confirmed' : ''}
      disabled={working || kept === null}
      onClick={() => { void toggle() }}
    />
  )
}

/** The one entry point for putting something else on, as a MorphingMenu. */
function MediaSwitch({ onOpen, onCatalog, onTorrent, onYoutube, onFile, t }: {
  onOpen: () => void
  onCatalog: () => void
  onTorrent: () => void
  onYoutube: () => void
  onFile: () => void
  t: Translator
}) {
  const pick = (close: () => void, action: () => void) => () => { close(); action() }
  return (
    <MorphingMenu
      align="end"
      haspopup="menu"
      minWidth={0}
      onOpen={onOpen}
      triggerClassName="media-switch-pill"
      panelClassName="media-switch-panel"
      trigger={() => <><Replace size={15} aria-hidden="true" />{t('room.changeMedia')}</>}
    >
      {(close) => (
        <div className="media-switch-menu">
          <button type="button" onClick={pick(close, onCatalog)}>
            <Compass size={15} aria-hidden="true" />{t('catalog.tab')}
          </button>
          <button type="button" onClick={pick(close, onTorrent)}>
            <span className="magnet-glyph" aria-hidden="true">µ</span>{t('room.switchTorrent')}
          </button>
          <button type="button" onClick={pick(close, onYoutube)}>
            <YoutubeGlyph size={15} />{t('room.switchYoutube')}
          </button>
          <button type="button" onClick={pick(close, onFile)}>
            <Upload size={15} aria-hidden="true" />{t('room.switchFile')}
          </button>
        </div>
      )}
    </MorphingMenu>
  )
}


/** An arrival is audible as well as visible; a departure stays silent. */


/** A live's failure comes as a code; the page says it in words. */
function liveErrorText(message: string | undefined, t: Translator): string | undefined {
  if (!message) return message
  if (message === 'live_ended' || message.startsWith('youtube_')) return t(youtubeErrorKey(new YoutubeError(message)))
  return message
}
