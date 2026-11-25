import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ratingTone, useAgeRating } from './ageRating'

function Badge({ id }: { id: string }) {
  const rating = useAgeRating('movie', id)
  return <span data-testid="badge">{rating ? `${rating.rating}:${ratingTone(rating)}` : 'none'}</span>
}

describe('age rating', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows what the server knows, once per title', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ rating: '14', system: 'ClassInd' })))
    vi.stubGlobal('fetch', fetchMock)
    render(<Badge id="tt1375666" />)
    expect(await screen.findByText('14:14')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/ratings/movie/tt1375666')
  })

  it('shows nothing when the rating is unknown or the server fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    render(<Badge id="tt0000001" />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByTestId('badge').textContent).toBe('none')
  })

  it('colors only the Brazilian ratings', () => {
    expect(ratingTone({ rating: 'L', system: 'ClassInd' })).toBe('l')
    expect(ratingTone({ rating: '18', system: 'ClassInd' })).toBe('18')
    expect(ratingTone({ rating: 'PG-13', system: 'US' })).toBe('other')
  })
})
