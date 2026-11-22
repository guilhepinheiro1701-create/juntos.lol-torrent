import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { LoaderCircle, Search, X } from 'lucide-react'
import { useT } from '../i18n/useT'
import { fetchCatalog, searchCatalog, type CatalogMeta, type MetaType } from './tmdb'
import { PosterCard, type TitleOpen } from './PosterCard'
import { Carousel } from './Carousel'
import { FeaturedHero } from './FeaturedHero'
import { prefetchMetaDetails } from './lazyDetails'

// Curto o bastante para parecer instantaneo enquanto se digita, longo o
// bastante para nao disparar uma busca por letra.
const SEARCH_DEBOUNCE_MS = 220
const FEATURED_COUNT = 6

interface RowSpec {
  key: string
  labelKey: string
  type: MetaType
  genre?: string
}

const ROWS: RowSpec[] = [
  { key: 'movies', labelKey: 'catalog.popularMovies', type: 'movie' },
  { key: 'series', labelKey: 'catalog.popularSeries', type: 'series' },
  { key: 'action', labelKey: 'catalog.action', type: 'movie', genre: 'Action' },
  { key: 'comedy', labelKey: 'catalog.comedy', type: 'series', genre: 'Comedy' },
  { key: 'animation', labelKey: 'catalog.animation', type: 'series', genre: 'Animation' },
]

/**
 * Os titulos do destaque: os mais populares que tem paisagem, de filmes e
 * series alternados. Sem paisagem nenhuma (catalogo antigo), usa o pôster.
 */
function pickFeatured(rows: Record<string, RowState>): CatalogMeta[] {
  const lists = ['movies', 'series']
    .map((key) => rows[key])
    .map((state) => (state?.status === 'ready' ? state.metas : []))
  const withArt = lists.map((list) => list.filter((meta) => meta.background))
  const source = withArt.some((list) => list.length > 0) ? withArt : lists.map((list) => list.filter((meta) => meta.poster))
  const picked: CatalogMeta[] = []
  for (let index = 0; picked.length < FEATURED_COUNT && index < 20; index += 1) {
    for (const list of source) {
      if (index < list.length && picked.length < FEATURED_COUNT) picked.push(list[index])
    }
  }
  return picked
}

/** O catalogo rola dentro de um container em alguns layouts e na janela em outros. */
function scrollBoardToTop(root: HTMLElement | null) {
  for (let node = root?.parentElement; node; node = node.parentElement) {
    const overflow = window.getComputedStyle(node).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollTop > 0) {
      node.scrollTo({ top: 0 })
      return
    }
  }
  if (window.scrollY > 0) window.scrollTo({ top: 0 })
}

type RowState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; metas: CatalogMeta[] }

interface CatalogBrowserProps {
  onOpenTitle: (open: TitleOpen) => void
  compact?: boolean
  hideSearch?: boolean
}

// The searchable board: a search field over rows of posters. Selecting a
// title is the parent's business — the browser only reports the pick.
export const CatalogBrowser = memo(function CatalogBrowser({ onOpenTitle, compact, hideSearch }: CatalogBrowserProps) {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [retrySeq, setRetrySeq] = useState(0)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CatalogMeta[] | null>(null)
  const [searching, setSearching] = useState(false)
  const searchSeqRef = useRef(0)
  const [searchCompact, setSearchCompact] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 620px)').matches)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const focusedRef = useRef(false)
  const queryRef = useRef('')

  const isMobile = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 620px)').matches

  useEffect(() => {
    document.body.classList.toggle('catalog-search-open', !searchCompact)
    return () => document.body.classList.remove('catalog-search-open')
  }, [searchCompact])

  useEffect(() => {
    const idle = window.requestIdleCallback
    if (typeof idle === 'function') {
      const handle = idle(prefetchMetaDetails, { timeout: 4_000 })
      return () => window.cancelIdleCallback?.(handle)
    }
    const timer = window.setTimeout(prefetchMetaDetails, 2_000)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    let target: HTMLElement | Window = window
    for (let node = rootRef.current?.parentElement; node; node = node.parentElement) {
      const overflow = window.getComputedStyle(node).overflowY
      if (overflow === 'auto' || overflow === 'scroll') {
        target = node
        break
      }
    }
    const mobileQuery = window.matchMedia('(max-width: 620px)')
    let lastY = target instanceof Window ? target.scrollY : target.scrollTop
    const onScroll = () => {
      const y = target instanceof Window ? target.scrollY : target.scrollTop
      const delta = y - lastY
      lastY = y
      if (mobileQuery.matches) return
      if (focusedRef.current || queryRef.current.trim() !== '') return
      if (delta > 4 && y > 40) setSearchCompact(true)
      else if (delta < -4 || y <= 40) setSearchCompact(false)
    }
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => target.removeEventListener('scroll', onScroll)
  }, [])

  const expandSearch = () => {
    setSearchCompact(false)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  useEffect(() => {
    let cancelled = false
    setRows((current) => {
      const next = { ...current }
      for (const row of ROWS) {
        if (next[row.key]?.status !== 'ready') next[row.key] = { status: 'loading' }
      }
      return next
    })
    for (const row of ROWS) {
      fetchCatalog(row.type, row.genre)
        .then((metas) => {
          if (!cancelled) setRows((current) => ({ ...current, [row.key]: { status: 'ready', metas: metas.slice(0, 40) } }))
        })
        .catch(() => {
          if (!cancelled) setRows((current) => (
            current[row.key]?.status === 'ready' ? current : { ...current, [row.key]: { status: 'error' } }
          ))
        })
    }
    return () => { cancelled = true }
  }, [retrySeq])

  // Enter busca na hora (e fecha o teclado do celular/TV); sem Enter, a busca
  // sai sozinha logo depois que a pessoa para de digitar.
  const [flushSeq, setFlushSeq] = useState(0)
  const flushedRef = useRef(0)

  useEffect(() => {
    const wasEmpty = queryRef.current.trim() === ''
    queryRef.current = query
    if (wasEmpty && query.trim() !== '') scrollBoardToTop(rootRef.current)
    const seq = (searchSeqRef.current += 1)
    const immediate = flushSeq !== flushedRef.current
    flushedRef.current = flushSeq
    const trimmed = query.trim()
    if (!trimmed) {
      setResults(null)
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = window.setTimeout(() => {
      searchCatalog(trimmed)
        .then((metas) => {
          if (searchSeqRef.current !== seq) return
          setResults(metas)
          setSearching(false)
        })
        .catch(() => {
          if (searchSeqRef.current !== seq) return
          setResults([])
          setSearching(false)
        })
    }, immediate ? 0 : SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query, flushSeq])

  const typing = query.trim() !== ''
  const featured = useMemo(() => pickFeatured(rows), [rows])

  const enter = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, transform: 'translateY(10px)' }, animate: { opacity: 1, transform: 'translateY(0px)' } }

  return (
    <div ref={rootRef} className={`catalog-browser ${compact ? 'is-compact' : ''}`}>
      <motion.div
        layout={!reduceMotion}
        className={`catalog-search ${searchCompact ? 'is-collapsed' : ''}`}
        style={{ borderRadius: 999 }}
        initial={{ opacity: 0 }}
        animate={{ opacity: hideSearch ? 0 : 1 }}
        transition={reduceMotion ? { duration: 0.15 } : { type: 'spring', duration: 0.55, bounce: 0.25, opacity: { duration: 0.2, ease: [0.23, 1, 0.32, 1] } }}
        data-hidden={hideSearch ? 'true' : undefined}
        onClick={searchCompact ? expandSearch : undefined}
        role={searchCompact ? 'button' : undefined}
        aria-label={searchCompact ? t('catalog.search') : undefined}
        tabIndex={searchCompact ? 0 : undefined}
        onKeyDown={searchCompact ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            expandSearch()
          }
        } : undefined}
      >
        <motion.span layout={!reduceMotion} className={`catalog-search-icon ${searching ? 'is-busy' : ''}`} aria-hidden="true">
          {searching ? <LoaderCircle size={17} /> : <Search size={17} />}
        </motion.span>
        <AnimatePresence mode="popLayout" initial={false}>
          {!searchCompact ? (
            <motion.div
              key="field"
              className="catalog-search-field"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
            >
              <input
                ref={inputRef}
                type="search"
                value={query}
                placeholder={t('catalog.searchPlaceholder')}
                aria-label={t('catalog.search')}
                onFocus={() => { focusedRef.current = true }}
                onBlur={() => {
                  focusedRef.current = false
                  if (isMobile() && queryRef.current.trim() === '') setSearchCompact(true)
                }}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  setFlushSeq((value) => value + 1)
                  if (isMobile()) event.currentTarget.blur()
                }}
                enterKeyHint="search"
                autoComplete="off"
                spellCheck={false}
              />
              {query ? (
                <button type="button" className="catalog-search-clear" aria-label={t('catalog.clearSearch')} onClick={() => setQuery('')}>
                  <X size={15} aria-hidden="true" />
                </button>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>

      {typing ? (
        <section className="search-results" aria-label={t('catalog.search')} aria-busy={searching}>
          <header className="search-results-head">
            <h2>{t('catalog.resultsFor').replace('{query}', query.trim())}</h2>
            {results !== null && results.length > 0 ? (
              <span>{t('catalog.resultsCount').replace('{count}', String(results.length))}</span>
            ) : null}
          </header>
          {results === null ? (
            <div className="search-grid" aria-hidden="true">
              {Array.from({ length: 12 }, (_, index) => <span key={index} className="poster-skeleton" />)}
            </div>
          ) : results.length > 0 ? (
            <motion.div
              key={query.trim()}
              className={`search-grid ${searching ? 'is-stale' : ''}`}
              {...enter}
              transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            >
              {results.map((meta) => (
                <PosterCard key={`${meta.type}:${meta.id}`} meta={meta} onOpen={onOpenTitle} />
              ))}
            </motion.div>
          ) : (
            <p className="empty-copy catalog-empty">{searching ? t('catalog.searching') : t('catalog.noResults')}</p>
          )}
        </section>
      ) : (
        <>
          {featured.length > 0 ? <FeaturedHero metas={featured} onOpen={onOpenTitle} /> : (
            rows.movies?.status === 'error' ? null : <div className="featured-skeleton" aria-hidden="true" />
          )}
          {ROWS.map((row) => {
            const state = rows[row.key] ?? { status: 'loading' as const }
            return (
              <section key={row.key} className="catalog-row" aria-label={t(row.labelKey)}>
                <h2>{t(row.labelKey)}</h2>
                {state.status === 'ready' ? (
                  <motion.div
                    {...enter}
                    transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                  >
                    <Carousel prevLabel={t('catalog.scrollBack')} nextLabel={t('catalog.scrollForward')}>
                      {state.metas.map((meta) => (
                        <PosterCard key={`${meta.type}:${meta.id}`} meta={meta} onOpen={onOpenTitle} />
                      ))}
                    </Carousel>
                  </motion.div>
                ) : state.status === 'error' ? (
                  <p className="empty-copy catalog-empty">
                    {t('catalog.rowFailed')}{' '}
                    <button type="button" className="catalog-retry" onClick={() => setRetrySeq((seq) => seq + 1)}>
                      {t('catalog.retry')}
                    </button>
                  </p>
                ) : (
                  <div className="catalog-strip" aria-hidden="true">
                    {Array.from({ length: 8 }, (_, index) => <span key={index} className="poster-skeleton" />)}
                  </div>
                )}
              </section>
            )
          })}
        </>
      )}
    </div>
  )
})
