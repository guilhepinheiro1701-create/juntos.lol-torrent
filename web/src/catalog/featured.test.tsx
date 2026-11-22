import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FeaturedHero } from './FeaturedHero'
import { parseCatalogMetas, type CatalogMeta } from './tmdb'

const metas: CatalogMeta[] = [
  { id: 'tt1', type: 'movie', name: 'Primeiro', poster: 'p1.jpg', releaseInfo: '2024', background: 'b1.jpg', description: 'Sinopse um' },
  { id: 'tt2', type: 'series', name: 'Segundo', poster: 'p2.jpg', releaseInfo: '2023', background: 'b2.jpg' },
]

describe('FeaturedHero', () => {
  it('opens the featured title and steps through the picks', () => {
    const onOpen = vi.fn()
    render(<FeaturedHero metas={metas} onOpen={onOpen} />)
    expect(screen.getByRole('heading', { name: 'Primeiro' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /assistir|watch/i }))
    expect(onOpen).toHaveBeenCalledWith({ meta: metas[0] })
    fireEvent.click(screen.getByRole('tab', { name: 'Segundo' }))
    expect(screen.getByRole('tab', { name: 'Segundo' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('parseCatalogMetas', () => {
  it('keeps the backdrop and synopsis the hero needs', () => {
    const [meta] = parseCatalogMetas({ metas: [{ id: 'tt9', type: 'movie', name: 'X', background: 'bg.jpg', description: 'D' }] })
    expect(meta.background).toBe('bg.jpg')
    expect(meta.description).toBe('D')
  })
})
