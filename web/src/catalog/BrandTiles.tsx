import { memo, useState, type CSSProperties } from 'react'
import { BRANDS, type Brand } from './brands'

interface BrandTilesProps {
  label: string
  onPick: (brand: Brand) => void
}

/** O logotipo da produtora; tenta cada fonte em ordem e so cai no nome se nenhuma abrir. */
function BrandLogo({ brand }: { brand: Brand }) {
  const [attempt, setAttempt] = useState(0)
  const src = brand.logos[attempt]
  if (!src) return <span className="brand-tile-name">{brand.name}</span>
  return (
    <img
      className={`brand-tile-logo ${brand.mono ? 'is-mono' : ''}`}
      src={src}
      alt=""
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setAttempt((value) => value + 1)}
    />
  )
}

/**
 * Os tiles das produtoras, logo abaixo do destaque. A cor da marca vira o
 * fundo e a luz que o tile emite ao passar o mouse ou com o foco do controle.
 */
export const BrandTiles = memo(function BrandTiles({ label, onPick }: BrandTilesProps) {
  return (
    <nav className="brand-tiles" aria-label={label}>
      {BRANDS.map((brand) => (
        <button
          key={brand.key}
          type="button"
          aria-label={brand.name}
          className={`brand-tile brand-tile--${brand.key}`}
          style={{ '--brand-a': brand.colors[0], '--brand-b': brand.colors[1] } as CSSProperties}
          onClick={() => onPick(brand)}
        >
          <span className="brand-tile-glow" aria-hidden="true" />
          <BrandLogo brand={brand} />
        </button>
      ))}
    </nav>
  )
})
