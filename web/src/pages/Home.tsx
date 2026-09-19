import { Suspense, useCallback, useEffect, useRef, useState, type DragEvent, type ChangeEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion, LayoutGroup } from 'motion/react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { FolderOpen, Puzzle, Upload } from 'lucide-react'
import { YoutubeGlyph } from '../ui/YoutubeGlyph'
import { useT } from '../i18n/useT'
import { createRoomAndUpload, createRoomAndUploadTorrent, createRoomAndUploadUrl, createRoomAndUploadYoutube, isUnreadableFile, youtubeFileName, type UploadProgress } from '../upload'
import { BuildInfo } from '../components/BuildInfo'
import { LibraryShelf } from '../components/LibraryShelf'
import { StoragePicker } from '../components/StoragePicker'
import { OfflineNotice } from '../components/OfflineNotice'
import { useOnline } from '../useOnline'
import { DiscordLink } from '../components/DiscordLink'
import { JlocalDownload, JlocalStatus } from '../components/JlocalPill'
import { useJLocal } from '../jlocal/status'
import { PluginsPanel } from '../plugins/PluginsPanel'
import { Onboarding } from '../onboarding/Onboarding'
import { playError } from '../onboarding/sounds'
import { useToast } from '../ui/toastContext'
import { hasSeenOnboarding } from '../onboarding/seen'
import { TorrentPicker } from '../components/TorrentPicker'
import { YoutubePicker } from '../components/YoutubePicker'
import { isYoutubeError, youtubeErrorKey, type YoutubeSession } from '../youtube'
import { DrivePicker, drivePlaybackUrls } from '../components/DrivePicker'
import { Button } from '../ui/Button'
import { Dialog, DialogContent } from '../ui/Dialog'
import type { TorrentSession, TorrentVideoFile, WorkerProbe } from '../torrent'
import { isTorrentError, torrentErrorKey } from '../torrentErrors'
import { MorphPanel } from '../ui/MorphPanel'
import { useMorphingStep } from '../ui/useMorphingStep'
import { StepBack } from '../ui/StepBack'
import { CatalogBrowser } from '../catalog/CatalogBrowser'
import { ProgressiveBlur } from '../catalog/ProgressiveBlur'
import type { TitlePick } from '../catalog/MetaDetails'
import { MetaDetails } from '../catalog/lazyDetails'
import { openCatalogStream } from '../catalog/openStream'
import { WorkerProbes } from '../components/WorkerProbes'
import { FleetStatus } from '../components/FleetStatus'
import { nowPlayingFromPick, nowPlayingKey } from '../catalog/useNextEpisode'
import type { CatalogMeta, MetaType } from '../catalog/tmdb'
import type { TitleOpen } from '../catalog/PosterCard'

import { MAX_UPLOAD_BYTES } from '../limits'
import { Mark, Wordmark, WRITES_ON_LOAD } from '../ui/Brand'

type HomeView = 'catalog' | 'manual' | 'status' | 'library'
export { MAX_UPLOAD_BYTES }

// The manual-upload panel's steps; false is the panel being shut.
type ManualStep = false | 'menu' | 'file' | 'magnet' | 'youtube' | 'drive'
const HISTORY_KEY = 'ss.room-history.v1'

interface RoomHistoryEntry {
  id: string
  fileName: string
  createdAt: number
}

type PendingMedia =
  | { kind: 'local'; file: File }
  | { kind: 'torrent'; file: TorrentVideoFile; session: TorrentSession }
  | { kind: 'youtube'; session: YoutubeSession }
  | { kind: 'drive'; file: TorrentVideoFile; session: TorrentSession }
  | { kind: 'stream'; pick: TitlePick }

// Router state must be serializable, so the morph origin travels as numbers.
interface TitleLocationState {
  meta?: CatalogMeta
  rect?: { top: number; left: number; width: number; height: number }
}

function readHistory(): RoomHistoryEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    const history = value.filter((entry): entry is RoomHistoryEntry => (
      typeof entry === 'object' && entry !== null &&
      typeof entry.id === 'string' && typeof entry.fileName === 'string' &&
      typeof entry.createdAt === 'number'
    )).map(({ id, fileName, createdAt }) => ({ id, fileName, createdAt })).slice(0, 12)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
    return history
  } catch {
    return []
  }
}

function isMetaType(value: string | undefined): value is MetaType {
  return value === 'movie' || value === 'series'
}

export function Home() {
  const jlocal = useJLocal()
  const t = useT()
  const navigate = useNavigate()
  const params = useParams<{ type?: string; id?: string }>()
  const location = useLocation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [starting, setStarting] = useState(false)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<RoomHistoryEntry[]>(readHistory)
  const [pendingMedia, setPendingMedia] = useState<PendingMedia | null>(null)
  const reduceMotion = useReducedMotion()
  const { toast } = useToast()
  const [onboarding, setOnboarding] = useState(() => !hasSeenOnboarding())
  const [manualOpen, setManualOpen] = useState<ManualStep>('menu')
  const view: HomeView = location.pathname.startsWith('/status') ? 'status'
    : location.pathname.startsWith('/downloads') ? 'library'
      : location.pathname.startsWith('/catalog') || location.pathname.startsWith('/title/') ? 'catalog'
        : 'manual'

  const showView = (next: HomeView) => {
    if (next === view) return
    window.scrollTo({ top: 0 })
    navigate(next === 'manual' ? '/' : next === 'library' ? '/downloads' : `/${next}`, { state: null })
  }

  const online = useOnline()
  // Always the four. Hiding downloads until there was something in them read,
  // from the outside, as the feature not existing at all — and a person cannot
  // download a film through a tab they have never been shown.
  const tabs: HomeView[] = ['catalog', 'manual', 'library', 'status']

  useEffect(() => {
    setError('')
    setManualOpen(view === 'manual' ? 'menu' : false)
  }, [view])
  const [pluginsOpen, setPluginsOpen] = useState(false)
  const { shown: shownManual, morphing: morphingManual } = useMorphingStep(manualOpen)
  const [panelFilled, setPanelFilled] = useState(false)
  useEffect(() => {
    if (manualOpen === false) {
      setPanelFilled(false)
      return
    }
    if (panelFilled) return
    const timer = window.setTimeout(() => setPanelFilled(true), 200)
    return () => window.clearTimeout(timer)
  }, [manualOpen, panelFilled])
  const [resumed, setResumed] = useState<{ magnet: string; session: TorrentSession } | null>(null)
  const [startingLabel, setStartingLabel] = useState('')
  const [youtubeDraft, setYoutubeDraft] = useState('')
  const [streamProbes, setStreamProbes] = useState<WorkerProbe[]>([])

  const state = (location.state ?? {}) as TitleLocationState
  const detailsOpen: TitleOpen | null = isMetaType(params.type) && params.id
    ? {
      meta: state.meta?.id === params.id ? state.meta : { id: params.id, type: params.type, name: state.meta?.name ?? '', poster: '', releaseInfo: '' },
      rect: state.rect ? new DOMRect(state.rect.left, state.rect.top, state.rect.width, state.rect.height) : undefined,
    }
    : null

  const discardPending = (media: PendingMedia | null) => {
    if (media?.kind === 'torrent' || media?.kind === 'drive' || media?.kind === 'youtube') media.session.destroy()
  }

  const selectFile = (file?: File) => {
    if (!file || starting) return
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(t('home.tooLarge'))
      return
    }
    setError('')
    setManualOpen(false)
    setPendingMedia({ kind: 'local', file })
  }

  const openTitle = useCallback((open: TitleOpen) => {
    const rect = open.rect
      ? { top: open.rect.top, left: open.rect.left, width: open.rect.width, height: open.rect.height }
      : undefined
    navigate(`/title/${open.meta.type}/${encodeURIComponent(open.meta.id)}`, { state: { meta: open.meta, rect } })
  }, [navigate])

  const closeTitle = () => {
    navigate('/catalog', { state: null })
  }

  const pickStream = (pick: TitlePick) => {
    setError('')
    setPendingMedia({ kind: 'stream', pick })
  }

  const startUpload = async () => {
    const media = pendingMedia
    if (!media || starting) return
    setPendingMedia(null)
    setStarting(true)
    setStartingLabel(
      media.kind === 'stream' ? media.pick.displayName
          : media.kind === 'youtube' ? youtubeFileName(media.session)
            : media.file.name,
    )
    try {
      let room
      let fileName = ''
      if (media.kind === 'local') {
        room = await createRoomAndUpload(media.file, '', setProgress)
        fileName = media.file.name
      } else if (media.kind === 'torrent') {
        room = await createRoomAndUploadTorrent({ file: media.file, session: media.session }, '', setProgress)
        fileName = media.file.name
      } else if (media.kind === 'youtube') {
        room = await createRoomAndUploadYoutube(media.session, '')
        fileName = youtubeFileName(media.session)
      } else if (media.kind === 'drive') {
        // The picker already selected the file; resolve its ranged Drive URL
        // and sidecars, then create the room onto a client-remuxed URL source.
        const playback = await drivePlaybackUrls(media.file, media.session)
        try {
          room = await createRoomAndUploadUrl(playback.url, media.file.name, media.file.size, '', playback.sideFiles)
        } catch (error) {
          media.session.destroy()
          throw error
        }
        fileName = media.file.name
      } else if (media.kind === 'stream' && media.pick.stream.location.kind === 'url') {
        closeTitle()
        const { url } = media.pick.stream.location
        room = await createRoomAndUploadUrl(url, `${media.pick.displayName}.mkv`, 0, '')
        fileName = media.pick.displayName
        const playing = nowPlayingFromPick(media.pick)
        try {
          if (playing) localStorage.setItem(nowPlayingKey(room.roomID), JSON.stringify(playing))
        } catch {}
      } else {
        closeTitle()
        setProgress({ phase: 'converting', pct: 0 })
        setStreamProbes([])
        const opened = await openCatalogStream(media.pick.stream, media.pick.target, undefined, { onProbe: setStreamProbes })
        setProgress(null)
        try {
          room = await createRoomAndUploadTorrent(opened, '', setProgress)
        } catch (error) {
          opened.session.destroy()
          throw error
        }
        fileName = media.pick.displayName
        const playing = nowPlayingFromPick(media.pick)
        try {
          if (playing) localStorage.setItem(nowPlayingKey(room.roomID), JSON.stringify(playing))
        } catch {}
      }
      const nextHistory = [
        { id: room.roomID, fileName, createdAt: Date.now() },
        ...history.filter((entry) => entry.id !== room.roomID),
      ].slice(0, 12)
      localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory))
      setHistory(nextHistory)
      navigate(`/room/${room.roomID}`)
    } catch (error) {
      discardPending(media)
      const message = t(
        isUnreadableFile(error) ? 'error.fileChanged'
          : isTorrentError(error) ? torrentErrorKey(error)
            : isYoutubeError(error) ? youtubeErrorKey(error)
              : 'home.failed',
      )
      if (view === 'catalog') {
        playError()
        toast(message)
      } else {
        setError(message)
      }
      setStarting(false)
      setProgress(null)
    }
  }

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragging(false)
    selectFile(event.dataTransfer.files[0])
  }

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0])
  }

  const MANUAL_STEPS = (<>
      {shownManual === 'menu' ? (
        <div className="morph-step" data-step="menu">
          <h2 className="stage-title">{t('home.title')}</h2>
          <p className="stage-description">{t('home.guide')}</p>
          <div className="source-options">
            <button onClick={() => setManualOpen('file')}>
              <Upload size={18} aria-hidden="true" />{t('home.uploadFile')}
            </button>
            <button onClick={() => { setError(''); setManualOpen('magnet') }}>
              <span className="magnet-glyph" aria-hidden="true">µ</span>{t('home.openTorrent')}
            </button>
            <button onClick={() => { setError(''); setYoutubeDraft(''); setManualOpen('youtube') }}>
              <YoutubeGlyph size={18} />{t('home.openYoutube')}
            </button>
            <button onClick={() => { setError(''); setManualOpen('drive') }}>
              <FolderOpen size={18} aria-hidden="true" />{t('home.openDrive')}
            </button>
          </div>
        </div>
      ) : null}

      {shownManual === 'file' ? (
        <div className="morph-step" data-step="file">
          <div className="morph-head">
            <StepBack label={t('home.back')} onClick={() => setManualOpen('menu')} />
            <h2 className="stage-title">{t('home.uploadFile')}</h2>
          </div>
          <button
            type="button"
            className={`drop-zone dialog-drop ${dragging ? 'is-dragging' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="drop-icon" size={34} strokeWidth={1.6} aria-hidden="true" />
            <strong>{t('home.dropOrPick')}</strong>
            <span>{t('home.dropHint')}</span>
          </button>
          {error ? <div className="error-card" role="alert">{error}</div> : null}
        </div>
      ) : null}

      {shownManual === 'magnet' ? (
        <div className="morph-step" data-step="magnet">
          <TorrentPicker
            maxFileBytes={MAX_UPLOAD_BYTES}
            t={t}
            initialSession={resumed?.session ?? null}
            initialMagnet={resumed?.magnet ?? ''}
            onExit={() => { setResumed(null); setManualOpen('menu') }}
            onYoutubeLink={(link) => { setYoutubeDraft(link); setManualOpen('youtube') }}
            onPicked={(file, session, magnet) => {
              setResumed({ magnet, session })
              setManualOpen(false)
              setPendingMedia({ kind: 'torrent', file, session })
            }}
          />
        </div>
      ) : null}

      {shownManual === 'youtube' ? (
        <div className="morph-step" data-step="youtube">
          <YoutubePicker
            t={t}
            initialUrl={youtubeDraft}
            onExit={() => setManualOpen('menu')}
            onPicked={(session) => {
              setManualOpen(false)
              setPendingMedia({ kind: 'youtube', session })
            }}
          />
        </div>
      ) : null}


      {shownManual === 'drive' ? (
        <div className="morph-step" data-step="drive">
          <DrivePicker
            maxFileBytes={MAX_UPLOAD_BYTES}
            t={t}
            onExit={() => setManualOpen('menu')}
            onPicked={(file, session) => {
              setManualOpen(false)
              setPendingMedia({ kind: 'drive', file, session })
            }}
          />
        </div>
      ) : null}
    </>)

  return (
    <main className="home-shell catalog-shell">
      <header className="home-header">
        <LayoutGroup id="jlocal">
        <ProgressiveBlur />
        <div className="header-start">
          <a className="home-wordmark" href="/" aria-label="juntos.lol">
            <Wordmark className="wordmark" writing={WRITES_ON_LOAD} />
            <Mark className="mark" />
          </a>
          <button className="header-language" aria-label={t('home.language')} onClick={() => t.setLanguage(t.language === 'en' ? 'pt-BR' : 'en')}>
            <span aria-hidden="true">{t.language === 'en' ? '🇺🇸' : '🇧🇷'}</span>{t.language === 'en' ? 'EN' : 'PT'}
          </button>
          <JlocalStatus status={jlocal} t={t} />
        </div>
        <div className="header-tabs" role="tablist" aria-label={t('home.ways')}>
          {tabs.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              className={view === value ? 'is-active' : ''}
              onClick={() => showView(value)}
            >
              {view === value ? (
                <motion.span
                  layoutId="home-tab-pill"
                  className="season-pill"
                  transition={reduceMotion ? { duration: 0 } : { type: 'spring', duration: 0.45, bounce: 0.2 }}
                />
              ) : null}
              <span className="season-tab-label">
                {value === 'catalog' ? t('home.tabCatalog')
                  : value === 'manual' ? t('home.tabOwn')
                    : value === 'library' ? t('home.tabDownloads')
                      : t('home.tabStatus')}
              </span>
            </button>
          ))}
        </div>
        <div className="header-end">
          <BuildInfo label={t('home.source')} />
          <DiscordLink label={t('home.discord')} />
          <button type="button" className="header-plugins" onClick={() => setPluginsOpen(true)}>
            <Puzzle size={15} aria-hidden="true" /><span className="nav-label">{t('plugins.open')}</span>
          </button>
          <JlocalDownload status={jlocal} t={t} />
        </div>
        </LayoutGroup>
      </header>

      <section className="catalog-stage">
        {view === 'status' ? (
          <FleetStatus />
        ) : view === 'library' ? (
          <LibraryShelf t={t} onOpened={(roomId) => navigate(`/room/${roomId}`)} />
        ) : view === 'catalog' ? (
          online
            ? <CatalogBrowser onOpenTitle={openTitle} hideSearch={detailsOpen !== null} />
            : <OfflineNotice t={t} onDownloads={() => showView('library')} />
        ) : (
          <div className="manual-stage">
            <MorphPanel className="upload-morph" sizeKey={panelFilled ? shownManual : 'opening'} morphing={morphingManual || !panelFilled}>
              {MANUAL_STEPS}
            </MorphPanel>
          </div>
        )}
        {error ? <div className="error-card" role="alert">{error}</div> : null}
      </section>

      <AnimatePresence>
        {starting ? (
          <motion.div
            className="starting-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            role="status"
            aria-live="polite"
          >
            <motion.div
              className="starting-card"
              initial={{ opacity: 0, transform: 'translateY(14px)' }}
              animate={{ opacity: 1, transform: 'translateY(0px)' }}
              transition={{ duration: 0.35, delay: 0.15, ease: [0.23, 1, 0.32, 1] }}
            >
              <span className="player-spinner" aria-hidden="true" />
              <h2>{t('home.preparing')}</h2>
              <p className="starting-file">{startingLabel}</p>
              <WorkerProbes probes={streamProbes} t={t} />
              <p className="starting-phase">
                {progress?.phase === 'converting' && progress.pct > 0
                  ? `${progress.pct}%`
                  : t('catalog.opening')}
              </p>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {detailsOpen ? (
        <Suspense fallback={null}>
          <MetaDetails
            onOpenPlugins={() => setPluginsOpen(true)}
            key={`${detailsOpen.meta.type}:${detailsOpen.meta.id}`}
            open={detailsOpen}
            mode="create"
            onClose={closeTitle}
            onPickStream={pickStream}
          />
        </Suspense>
      ) : null}

      {onboarding ? <Onboarding onDone={() => setOnboarding(false)} /> : null}

      <PluginsPanel open={pluginsOpen} onClose={() => setPluginsOpen(false)} />

      <input ref={inputRef} hidden type="file" accept="video/*,.mkv" onChange={onChange} />

      <Dialog
        open={pendingMedia !== null}
        onOpenChange={(open) => {
          if (open || !pendingMedia) return
          discardPending(pendingMedia)
          setPendingMedia(null)
        }}
      >
        {pendingMedia ? (
          <DialogContent
            closeLabel={t('home.closeDialog')}
            title={t('home.dialogTitle')}
            description={t('home.dialogGuide')}
          >
            <span className="dialog-file">
              {pendingMedia.kind === 'stream' ? pendingMedia.pick.displayName
                  : pendingMedia.kind === 'youtube' ? youtubeFileName(pendingMedia.session)
                    : pendingMedia.file.name}
            </span>
            <form onSubmit={(event) => { event.preventDefault(); void startUpload() }}>
              {/* Onde o filme vai parar, perguntado no unico momento em que a
                  pergunta cabe: depois de escolher o que assistir e antes de
                  baixar qualquer coisa. Antes isto vivia dentro da aba
                  Baixados, que so aparecia depois do primeiro download — ou
                  seja, depois de ja ter sido gravado em algum lugar. */}
              <StoragePicker t={t} />
              <div className="dialog-actions">
                <Button onClick={() => {
                  discardPending(pendingMedia)
                  setPendingMedia(null)
                }}>{t('home.cancel')}</Button>
                <Button type="submit" variant="primary">{t('home.continue')}</Button>
              </div>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>
    </main>
  )
}
