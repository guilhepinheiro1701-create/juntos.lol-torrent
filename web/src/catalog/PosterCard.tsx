import { memo, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { Film, Play, Tv } from 'lucide-react'
import type { CatalogMeta } from './tmdb'
import { FadeImg } from './FadeImg'
import { Badge } from '@/components/ui/badge'

export interface TitleOpen {
  meta: CatalogMeta
  rect?: DOMRect
}

interface PosterCardProps {
  meta: CatalogMeta
  onOpen: (open: TitleOpen) => void
}

/**
 * Uma capa, e nada em volta até você chegar perto.
 *
 * O nome e o ano moravam embaixo da capa, sempre visíveis: cada fileira virava
 * três andares de texto e o olho tinha de pular por cima deles para ver a
 * próxima capa. Nos catálogos que a pessoa conhece — Netflix, Disney+ — a capa
 * ocupa a fileira inteira e o resto só aparece quando ela para em cima.
 *
 * Onde não há hover (celular, tablet), a legenda continua visível: não existe
 * "parar em cima" com o dedo, e esconder o nome ali seria esconder de vez. Quem
 * usa teclado recebe o mesmo tratamento pelo :focus-visible, e o nome está no
 * aria-label de qualquer forma.
 */
export const PosterCard = memo(function PosterCard({ meta, onOpen }: PosterCardProps) {
  const artRef = useRef<HTMLSpanElement>(null)

  const open = (event: MouseEvent | KeyboardEvent) => {
    const pointer = 'detail' in event && event.detail > 0
    onOpen({ meta, rect: pointer ? artRef.current?.getBoundingClientRect() : undefined })
  }

  return (
    <button type="button" className="poster-card" onClick={open} aria-label={meta.name}>
      <span ref={artRef} className="poster-art">
        {meta.poster ? (
          <FadeImg src={meta.poster} alt="" loading="lazy" />
        ) : (
          meta.type === 'movie' ? <Film size={28} aria-hidden="true" /> : <Tv size={28} aria-hidden="true" />
        )}
        <span className="poster-veil" aria-hidden="true" />
        <span className="poster-play" aria-hidden="true"><Play size={17} /></span>
        <span className="poster-caption">
          <span className="poster-name">{meta.name}</span>
          {meta.releaseInfo ? (
            <Badge variant="secondary" className="poster-year">{meta.releaseInfo}</Badge>
          ) : null}
        </span>
      </span>
    </button>
  )
})
