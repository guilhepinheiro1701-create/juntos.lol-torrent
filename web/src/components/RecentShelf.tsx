import { useEffect, useState } from 'react'
import { Info, Play, X } from 'lucide-react'
import { episodeLabel, forgetRecent, formatClock, isFinished, readRecents, subscribeRecents, type RecentEntry } from '../recents'
import { Carousel } from '../catalog/Carousel'
import { FadeImg } from '../catalog/FadeImg'

type Translate = (key: string) => string

export function useRecents(): RecentEntry[] {
  const [entries, setEntries] = useState(readRecents)
  useEffect(() => subscribeRecents(() => setEntries(readRecents())), [])
  return entries
}

interface RecentCardProps {
  entry: RecentEntry
  onResume: (entry: RecentEntry) => void
  onDetails: (entry: RecentEntry) => void
  t: Translate
}

function RecentCard({ entry, onResume, onDetails, t }: RecentCardProps) {
  const finished = isFinished(entry)
  const pct = entry.durationMs > 0 ? Math.min(100, Math.round((entry.positionMs / entry.durationMs) * 100)) : 0
  const left = entry.durationMs > 0 ? entry.durationMs - entry.positionMs : 0
  const art = entry.background || entry.poster
  const status = finished
    ? (entry.type === 'series' ? t('recent.nextReady') : t('recent.watched'))
    : left > 60_000 ? t('recent.left').replace('{time}', formatClock(left)) : entry.positionMs > 0 ? formatClock(entry.positionMs) : t('recent.notStarted')

  return (
    <article className="recent-card">
      <button
        type="button"
        className="recent-art"
        aria-label={`${finished && entry.type === 'series' ? t('recent.playNext') : t('recent.resume')}: ${entry.name} ${episodeLabel(entry)}`}
        onClick={() => (finished ? onDetails(entry) : onResume(entry))}
      >
        {art ? <span className="recent-glow" aria-hidden="true"><img src={art} alt="" loading="lazy" /></span> : null}
        {art ? <FadeImg className={`recent-img ${entry.background ? '' : 'is-poster'}`} src={art} alt="" loading="lazy" /> : null}
        <span className="recent-veil" aria-hidden="true" />
        <span className="recent-play" aria-hidden="true"><Play size={18} /></span>
        {pct > 0 && !finished ? <span className="recent-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span> : null}
      </button>
      <div className="recent-text">
        <div>
          <strong>{entry.name}</strong>
          <span>{[episodeLabel(entry), status].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="recent-tools">
          <button type="button" aria-label={t('recent.details')} title={t('recent.details')} onClick={() => onDetails(entry)}>
            <Info size={15} aria-hidden="true" />
          </button>
          <button type="button" aria-label={t('recent.remove')} title={t('recent.remove')} onClick={() => forgetRecent(entry.key)}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  )
}

interface RecentShelfProps {
  entries: RecentEntry[]
  layout: 'row' | 'grid'
  onResume: (entry: RecentEntry) => void
  onDetails: (entry: RecentEntry) => void
  t: Translate
}

/** "Continuar assistindo" no catalogo (fileira) e a aba Recentes (grade). */
export function RecentShelf({ entries, layout, onResume, onDetails, t }: RecentShelfProps) {
  if (entries.length === 0) {
    return layout === 'grid' ? (
      <div className="recent-empty">
        <Play size={26} aria-hidden="true" />
        <strong>{t('recent.emptyTitle')}</strong>
        <p>{t('recent.emptyHint')}</p>
      </div>
    ) : null
  }
  const cards = entries.map((entry) => (
    <RecentCard key={entry.key} entry={entry} onResume={onResume} onDetails={onDetails} t={t} />
  ))
  if (layout === 'grid') {
    return (
      <section className="recent-page" aria-label={t('home.tabRecent')}>
        <h2>{t('recent.title')}</h2>
        <div className="recent-grid">{cards}</div>
      </section>
    )
  }
  return (
    <section className="catalog-row recent-row" aria-label={t('recent.continueRow')}>
      <h2>{t('recent.continueRow')}</h2>
      <Carousel prevLabel={t('catalog.scrollBack')} nextLabel={t('catalog.scrollForward')}>{cards}</Carousel>
    </section>
  )
}
