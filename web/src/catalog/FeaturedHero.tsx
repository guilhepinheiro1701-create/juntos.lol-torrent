import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronLeft, ChevronRight, Play } from 'lucide-react'
import { useT } from '../i18n/useT'
import type { CatalogMeta } from './tmdb'
import type { TitleOpen } from './PosterCard'

const ROTATE_MS = 8_000

interface FeaturedHeroProps {
  metas: CatalogMeta[]
  onOpen: (open: TitleOpen) => void
}

/**
 * O destaque do topo do catalogo.
 *
 * Aprendido das plataformas de streaming, nao copiado delas: uma paisagem
 * grande que troca sozinha, e — o que mais muda a cara da pagina — a propria
 * imagem desfocada por tras de tudo, de modo que a cor do filme em destaque
 * "vaza" para o fundo do site. A troca pausa enquanto o mouse ou o foco do
 * controle remoto estao em cima, e para de vez quando a aba nao esta visivel.
 */
export const FeaturedHero = memo(function FeaturedHero({ metas, onOpen }: FeaturedHeroProps) {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const rootRef = useRef<HTMLElement>(null)
  const count = metas.length
  const current = metas[Math.min(index, count - 1)]

  const go = useCallback((next: number) => {
    if (count === 0) return
    setIndex(((next % count) + count) % count)
  }, [count])

  useEffect(() => {
    if (paused || count < 2 || reduceMotion) return
    const timer = window.setTimeout(() => {
      if (document.visibilityState === 'visible') go(index + 1)
    }, ROTATE_MS)
    return () => window.clearTimeout(timer)
  }, [paused, count, index, go, reduceMotion])

  if (!current) return null
  const backdrop = current.background || current.poster
  const isPortraitFallback = !current.background

  const open = () => onOpen({ meta: current })

  return (
    <section
      ref={rootRef}
      className="featured-hero"
      aria-roledescription="carousel"
      aria-label={t('catalog.featured')}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setPaused(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1) }
        else if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1) }
      }}
    >
      {/* A luz ambiente: a mesma imagem, enorme e desfocada, atras do destaque. */}
      <div className="featured-ambient" aria-hidden="true">
        <AnimatePresence initial={false}>
          <motion.img
            key={backdrop}
            src={backdrop}
            alt=""
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.9, ease: [0.23, 1, 0.32, 1] }}
          />
        </AnimatePresence>
      </div>

      <div className="featured-frame">
        <AnimatePresence initial={false}>
          <motion.img
            key={backdrop}
            className={`featured-backdrop ${isPortraitFallback ? 'is-portrait' : ''}`}
            src={backdrop}
            alt=""
            initial={{ opacity: 0, scale: reduceMotion ? 1 : 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.8, ease: [0.23, 1, 0.32, 1] }}
          />
        </AnimatePresence>
        <div className="featured-shade" aria-hidden="true" />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${current.type}:${current.id}`}
            className="featured-copy"
            initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
            transition={{ duration: reduceMotion ? 0 : 0.35, ease: [0.23, 1, 0.32, 1] }}
            aria-live={paused ? 'polite' : 'off'}
          >
            <span className="featured-kicker">
              {current.type === 'movie' ? t('catalog.movie') : t('catalog.serie')}
              {current.releaseInfo ? <><span aria-hidden="true">·</span>{current.releaseInfo}</> : null}
            </span>
            <h2 className="featured-title">{current.name}</h2>
            {current.description ? <p className="featured-description">{current.description}</p> : null}
            <div className="featured-actions">
              <button type="button" className="featured-play" onClick={open}>
                <Play size={18} aria-hidden="true" />
                {t('catalog.watch')}
              </button>
            </div>
          </motion.div>
        </AnimatePresence>

        {count > 1 ? (
          <>
            <button type="button" className="featured-arrow featured-arrow--prev" aria-label={t('catalog.scrollBack')} onClick={() => go(index - 1)}>
              <ChevronLeft size={22} aria-hidden="true" />
            </button>
            <button type="button" className="featured-arrow featured-arrow--next" aria-label={t('catalog.scrollForward')} onClick={() => go(index + 1)}>
              <ChevronRight size={22} aria-hidden="true" />
            </button>
            <div className="featured-dots" role="tablist" aria-label={t('catalog.featured')}>
              {metas.map((meta, position) => (
                <button
                  key={`${meta.type}:${meta.id}`}
                  type="button"
                  role="tab"
                  aria-selected={position === index}
                  aria-label={meta.name}
                  className={position === index ? 'is-active' : ''}
                  onClick={() => go(position)}
                >
                  <span
                    key={position === index ? `run-${index}` : 'idle'}
                    className="featured-dot-fill"
                    style={{ animationDuration: `${ROTATE_MS}ms`, animationPlayState: paused || reduceMotion ? 'paused' : 'running' }}
                  />
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  )
})
