import { useState } from 'react'
import { ListRestart, LoaderCircle, Play, SkipForward } from 'lucide-react'
import { resolveStreams } from '../plugins/resolve'
import { episodeLabel, formatClock, isFinished, type RecentEntry } from '../recents'
import { isPlayable, type CatalogStream } from './streams'
import type { TitlePick } from './MetaDetails'
import type { MetaVideo } from './tmdb'

type Translate = (key: string) => string

/**
 * Entre as fontes de um episodio, a que mais se parece com a que tocou antes:
 * o mesmo plugin na mesma resolucao, depois so a resolucao, depois a primeira
 * que este navegador consegue tocar.
 */
export function sameSource(streams: CatalogStream[], previous: CatalogStream): CatalogStream | null {
  const playable = streams.filter(isPlayable)
  return playable.find((stream) => stream.pluginId === previous.pluginId && stream.resolution === previous.resolution)
    ?? playable.find((stream) => stream.resolution === previous.resolution)
    ?? playable[0]
    ?? null
}

export function nextVideo(videos: MetaVideo[], season?: number, episode?: number): MetaVideo | null {
  if (season == null || episode == null) return null
  const ordered = videos.filter((video) => video.season > 0).sort((a, b) => a.season - b.season || a.episode - b.episode)
  const index = ordered.findIndex((video) => video.season === season && video.episode === episode)
  return index >= 0 ? ordered[index + 1] ?? null : null
}

export function episodePick(entry: RecentEntry, video: MetaVideo, stream: CatalogStream): TitlePick {
  return {
    ...entry.pick,
    stream,
    target: { ...entry.pick.target, season: video.season, episode: video.episode },
    displayName: `${entry.name} S${String(video.season).padStart(2, '0')}E${String(video.episode).padStart(2, '0')}`,
  }
}

interface ContinueCardProps {
  entry: RecentEntry
  videos: MetaVideo[]
  onPlay: (pick: TitlePick, resumeAtMs: number) => void
  t: Translate
}

/** "Continuar de onde parou", no topo da pagina do titulo, sem passar pela lista de fontes. */
export function ContinueCard({ entry, videos, onPlay, t }: ContinueCardProps) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const finished = isFinished(entry)
  const next = finished ? nextVideo(videos, entry.season, entry.episode) : null
  const label = episodeLabel(entry)
  const pct = entry.durationMs > 0 ? Math.min(100, Math.round((entry.positionMs / entry.durationMs) * 100)) : 0

  const playNext = async () => {
    if (!next || busy) return
    setBusy(true)
    setFailed(false)
    try {
      const result = await resolveStreams({ type: 'series', id: entry.pick.target.id, season: next.season, episode: next.episode })
      const stream = result.kind === 'streams' ? sameSource(result.streams, entry.pick.stream) : null
      if (!stream) { setFailed(true); return }
      onPlay(episodePick(entry, next, stream), 0)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="continue-card" aria-label={t('recent.continue')}>
      <div className="continue-copy">
        <span className="continue-kicker">{finished ? t('recent.watched') : t('recent.continue')}</span>
        <strong>
          {next
            ? `${t('recent.nextEpisode')} · T${next.season}:E${next.episode}${next.name ? ` — ${next.name}` : ''}`
            : [label, entry.positionMs > 0 && !finished ? `${formatClock(entry.positionMs)}${entry.durationMs > 0 ? ` / ${formatClock(entry.durationMs)}` : ''}` : '']
              .filter(Boolean).join(' · ') || entry.name}
        </strong>
        <span className="continue-source">{t('recent.sameSource')}: {entry.pick.stream.quality || entry.pick.stream.resolution} · {entry.pick.stream.pluginName}</span>
        {!finished && pct > 0 ? <span className="continue-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span> : null}
        {failed ? <span className="continue-error">{t('recent.nextFailed')}</span> : null}
      </div>
      <div className="continue-actions">
        {next ? (
          <button type="button" className="continue-primary" onClick={() => { void playNext() }} disabled={busy}>
            {busy ? <LoaderCircle size={17} className="spin" aria-hidden="true" /> : <SkipForward size={17} aria-hidden="true" />}
            {t('recent.playNext')}
          </button>
        ) : (
          <button type="button" className="continue-primary" onClick={() => onPlay(entry.pick, finished ? 0 : entry.positionMs)}>
            <Play size={17} aria-hidden="true" />
            {finished ? t('recent.again') : t('recent.resume')}
          </button>
        )}
        {!finished && entry.positionMs > 0 ? (
          <button type="button" className="continue-secondary" onClick={() => onPlay(entry.pick, 0)}>
            <ListRestart size={16} aria-hidden="true" />
            {t('recent.fromStart')}
          </button>
        ) : null}
      </div>
    </section>
  )
}
