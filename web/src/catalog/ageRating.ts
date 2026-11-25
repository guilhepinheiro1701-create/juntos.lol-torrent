import { useEffect, useState } from 'react'
import type { MetaType } from './tmdb'

/**
 * Classificacao indicativa, perguntada ao servidor (que tem a chave do TMDB,
 * se houver, e o Wikidata como reserva). "ClassInd" e a brasileira; "US" a
 * americana, mostrada quando a brasileira nao existe.
 */
export interface AgeRating { rating: string; system?: 'ClassInd' | 'US' }

const cache = new Map<string, Promise<AgeRating>>()

export function fetchAgeRating(type: MetaType, imdbId: string): Promise<AgeRating> {
  const key = `${type}/${imdbId}`
  let pending = cache.get(key)
  if (!pending) {
    pending = fetch(`/api/ratings/${type}/${encodeURIComponent(imdbId)}`)
      .then(async (response) => (response.ok ? await response.json() as AgeRating : { rating: '' }))
      .catch(() => ({ rating: '' }))
    cache.set(key, pending)
  }
  return pending
}

export function useAgeRating(type: MetaType, imdbId: string | null | undefined): AgeRating | null {
  const [state, setState] = useState<{ key: string; value: AgeRating } | null>(null)
  const key = imdbId && /^tt\d+$/.test(imdbId) ? `${type}/${imdbId}` : ''
  useEffect(() => {
    if (!key || !imdbId) return
    let live = true
    void fetchAgeRating(type, imdbId).then((value) => { if (live) setState({ key, value }) })
    return () => { live = false }
  }, [key, type, imdbId])
  return state && state.key === key && state.value.rating ? state.value : null
}

/** A cor de cada faixa da ClassInd (as do selo oficial); americanas ficam neutras. */
export function ratingTone(rating: AgeRating): string {
  if (rating.system !== 'ClassInd') return 'other'
  return rating.rating === 'L' ? 'l' : rating.rating
}
